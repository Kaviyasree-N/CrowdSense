import type {
  HistoricalSegmentRecord,
  ModelEvaluationMetrics,
  ModelEvaluationReport,
} from '../types/transit.ts';
import {
  predictWithBaseline,
  predictWithRandomForest,
  RANDOM_FOREST_MIN_RECORDS,
  trainBaselineMedianModel,
  trainRandomForestModel,
} from './predictionEngine.ts';

function computeErrorMetrics(
  actuals: number[],
  predictions: number[]
): { mae: number; rmse: number } {
  const n = actuals.length;
  if (n === 0) return { mae: 0, rmse: 0 };

  let absSum = 0;
  let sqSum = 0;
  for (let i = 0; i < n; i++) {
    const err = predictions[i] - actuals[i];
    absSum += Math.abs(err);
    sqSum += err * err;
  }

  return {
    mae: Number((absSum / n).toFixed(2)),
    rmse: Number(Math.sqrt(sqSum / n).toFixed(2)),
  };
}

/**
 * Chronological Model Evaluation:
 *  - Sorts historical records chronologically by date.
 *  - Uses earlier weeks (first ~75% of distinct dates) for training.
 *  - Evaluates on later week(s) (remaining ~25% of distinct dates).
 *  - Computes MAE and RMSE for Baseline Median and Random Forest.
 *  - Explicitly reports insufficient_data rather than inventing evaluation metrics.
 */
export function evaluateModelsChronologically(
  records: HistoricalSegmentRecord[],
  minDistinctDates = 3,
  minTrainCount = 20,
  minTestCount = 6
): ModelEvaluationReport {
  const validRecords = records.filter(
    (r) => Boolean(r.date) && Number.isFinite(r.observed_load) && r.observed_load >= 0
  );

  const distinctDates = Array.from(new Set(validRecords.map((r) => r.date))).sort();

  if (distinctDates.length < minDistinctDates) {
    return {
      status: 'insufficient_data',
      reason: `Chronological evaluation requires at least ${minDistinctDates} distinct dates across multiple weeks; found ${distinctDates.length} date(s).`,
      trainDateRange: distinctDates[0] ?? 'N/A',
      testDateRange: 'N/A',
      trainCount: validRecords.length,
      testCount: 0,
      isSimulatedData: validRecords.every((r) => r.is_simulated),
      baselineMetrics: null,
      randomForestMetrics: null,
      winner: null,
    };
  }

  // Chronological split: earlier ~75% of dates for training, later ~25% for testing
  const splitIndex = Math.max(1, Math.floor(distinctDates.length * 0.72));
  const trainDates = new Set(distinctDates.slice(0, splitIndex));
  const testDates = new Set(distinctDates.slice(splitIndex));

  const trainRecords = validRecords.filter((r) => trainDates.has(r.date));
  const testRecords = validRecords.filter((r) => testDates.has(r.date));

  const trainDateRange = `${distinctDates[0]} to ${distinctDates[splitIndex - 1]}`;
  const testDateRange = `${distinctDates[splitIndex]} to ${distinctDates[distinctDates.length - 1]}`;

  if (trainRecords.length < minTrainCount || testRecords.length < minTestCount) {
    return {
      status: 'insufficient_data',
      reason: `Insufficient chronological split volume (train: ${trainRecords.length}/${minTrainCount} min, test: ${testRecords.length}/${minTestCount} min).`,
      trainDateRange,
      testDateRange,
      trainCount: trainRecords.length,
      testCount: testRecords.length,
      isSimulatedData: validRecords.every((r) => r.is_simulated),
      baselineMetrics: null,
      randomForestMetrics: null,
      winner: null,
    };
  }

  // Train exclusively on earlier weeks
  const baselineModel = trainBaselineMedianModel(trainRecords);
  const rfModel =
    trainRecords.length >= RANDOM_FOREST_MIN_RECORDS
      ? trainRandomForestModel(trainRecords)
      : null;

  // Evaluate on later week test records where ground-truth observed_load exists
  const baselineActuals: number[] = [];
  const baselinePreds: number[] = [];

  const rfActuals: number[] = [];
  const rfPreds: number[] = [];

  testRecords.forEach((rec) => {
    const query = {
      routeId: rec.route_id,
      routeNumber: rec.route_number,
      direction: rec.direction,
      fromStopId: rec.from_stop_id,
      toStopId: rec.to_stop_id,
      fromStopName: rec.from_stop_id,
      toStopName: rec.to_stop_id,
      segmentOrder: rec.segment_order,
      hour: rec.hour,
      dayOfWeek: rec.day_of_week,
      dayType: rec.day_type,
      isAc: rec.is_ac,
    };

    const basePred = predictWithBaseline(query, baselineModel);
    if (basePred.stats !== null) {
      baselineActuals.push(rec.observed_load);
      baselinePreds.push(basePred.stats.medianLoad);
    }

    if (rfModel) {
      const rfVal = predictWithRandomForest(query, rfModel);
      if (rfVal !== null) {
        rfActuals.push(rec.observed_load);
        rfPreds.push(rfVal);
      }
    }
  });

  if (baselineActuals.length < minTestCount) {
    return {
      status: 'insufficient_data',
      reason: `Only ${baselineActuals.length} test records matched previously observed route segments (minimum ${minTestCount} needed).`,
      trainDateRange,
      testDateRange,
      trainCount: trainRecords.length,
      testCount: testRecords.length,
      isSimulatedData: validRecords.every((r) => r.is_simulated),
      baselineMetrics: null,
      randomForestMetrics: null,
      winner: null,
    };
  }

  const baseErr = computeErrorMetrics(baselineActuals, baselinePreds);
  const baselineMetrics: ModelEvaluationMetrics = {
    modelName: 'Historical Median Baseline',
    modelKey: 'baseline-median',
    mae: baseErr.mae,
    rmse: baseErr.rmse,
    evaluatedSamples: baselineActuals.length,
  };

  let randomForestMetrics: ModelEvaluationMetrics | null = null;
  if (rfModel && rfActuals.length >= minTestCount) {
    const rfErr = computeErrorMetrics(rfActuals, rfPreds);
    randomForestMetrics = {
      modelName: 'Random Forest Regressor (12 Trees)',
      modelKey: 'random-forest',
      mae: rfErr.mae,
      rmse: rfErr.rmse,
      evaluatedSamples: rfActuals.length,
    };
  }

  const winner =
    randomForestMetrics && randomForestMetrics.rmse < baselineMetrics.rmse
      ? 'random-forest'
      : 'baseline-median';

  return {
    status: 'evaluated',
    reason: randomForestMetrics
      ? `Chronologically evaluated ${baselineActuals.length} holdout segment observations from ${testDateRange}.`
      : `Evaluated Baseline Median on ${baselineActuals.length} holdout records (Random Forest requires >= ${RANDOM_FOREST_MIN_RECORDS} training observations).`,
    trainDateRange,
    testDateRange,
    trainCount: trainRecords.length,
    testCount: baselineActuals.length,
    isSimulatedData: validRecords.every((r) => r.is_simulated),
    baselineMetrics,
    randomForestMetrics,
    winner,
  };
}
