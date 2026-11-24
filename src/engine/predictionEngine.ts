import type {
  CapacityConfig,
  ConfidenceLevel,
  DayType,
  HistoricalSegmentRecord,
  PredictionExplanation,
  PredictionModelType,
  SegmentObservation,
} from '../types/transit.ts';
import { classifyCrowding, DEFAULT_CAPACITY_CONFIG } from '../utils/crowdClassification.ts';
import { evaluateConfidence } from '../utils/passengerLoad.ts';

export interface PredictionQuery {
  routeId: string;
  routeNumber: string;
  direction: 'UP' | 'DOWN';
  fromStopId: string;
  toStopId: string;
  fromStopName: string;
  toStopName: string;
  segmentOrder: number;
  hour: number;
  dayOfWeek: number;
  dayType: DayType;
  isAc: boolean;
}

interface AggregatedSlotStats {
  medianLoad: number;
  observationsCount: number;
  weeklyCv: number;
  unmatchedStopRate: number;
  tripGroupingReliability: number;
  missingDataRate: number;
}

export interface TrainedBaselineModel {
  exactMap: Map<string, AggregatedSlotStats>;
  dayTypeMap: Map<string, AggregatedSlotStats>;
  segmentMap: Map<string, AggregatedSlotStats>;
  trainingRecordCount: number;
  dateRangeLabel: string;
  isSimulated: boolean;
}

interface RegressionTreeNode {
  isLeaf: boolean;
  prediction?: number;
  featureIndex?: number;
  threshold?: number;
  left?: RegressionTreeNode;
  right?: RegressionTreeNode;
}

export interface TrainedRandomForestModel {
  trees: RegressionTreeNode[];
  routeIndexMap: Map<string, number>;
  trainingRecordCount: number;
  featureNames: string[];
  isSimulated: boolean;
}

export const RANDOM_FOREST_MIN_RECORDS = 40;

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function computeStatsFromRecords(records: HistoricalSegmentRecord[]): AggregatedSlotStats {
  const loads = records.map((r) => r.observed_load);
  const medianLoad = Math.max(0, Math.round(computeMedian(loads)));

  // Weekly consistency: group mean load per week and compute CV
  const weekTotals = new Map<number, { sum: number; count: number }>();
  records.forEach((r) => {
    const entry = weekTotals.get(r.week_number) ?? { sum: 0, count: 0 };
    entry.sum += r.observed_load;
    entry.count += 1;
    weekTotals.set(r.week_number, entry);
  });

  let weeklyCv = 0.28;
  if (weekTotals.size >= 2) {
    const weekMeans = Array.from(weekTotals.values()).map((w) => w.sum / w.count);
    const meanOfMeans = weekMeans.reduce((a, b) => a + b, 0) / weekMeans.length;
    if (meanOfMeans > 0) {
      const variance =
        weekMeans.reduce((sum, val) => sum + Math.pow(val - meanOfMeans, 2), 0) /
        weekMeans.length;
      weeklyCv = Math.min(0.8, Math.sqrt(variance) / meanOfMeans);
    }
  }

  const avgUnmatched =
    records.reduce((s, r) => s + r.unmatched_stop_rate, 0) / Math.max(1, records.length);
  const avgReliability =
    records.reduce((s, r) => s + r.trip_grouping_reliability, 0) / Math.max(1, records.length);
  const avgMissing =
    records.reduce((s, r) => s + r.missing_data_rate, 0) / Math.max(1, records.length);

  return {
    medianLoad,
    observationsCount: records.length,
    weeklyCv: Number(weeklyCv.toFixed(2)),
    unmatchedStopRate: Number(avgUnmatched.toFixed(2)),
    tripGroupingReliability: Number(avgReliability.toFixed(2)),
    missingDataRate: Number(avgMissing.toFixed(2)),
  };
}

/**
 * TRAINING STEP 1: Baseline Historical Median Model
 * Aggregates historical trip-segment observations by route, direction, segment, hour, and day_type.
 */
export function trainBaselineMedianModel(
  records: HistoricalSegmentRecord[],
  supplementalObservations: SegmentObservation[] = []
): TrainedBaselineModel {
  const exactGroups = new Map<string, HistoricalSegmentRecord[]>();
  const dayTypeGroups = new Map<string, HistoricalSegmentRecord[]>();
  const segmentGroups = new Map<string, HistoricalSegmentRecord[]>();

  records.forEach((rec) => {
    const segKey = `${rec.route_id}|${rec.from_stop_id}|${rec.to_stop_id}`;
    const dtKey = `${segKey}|${rec.day_type}`;
    const exactKey = `${dtKey}|${rec.hour}`;

    const eList = exactGroups.get(exactKey) ?? [];
    eList.push(rec);
    exactGroups.set(exactKey, eList);

    const dList = dayTypeGroups.get(dtKey) ?? [];
    dList.push(rec);
    dayTypeGroups.set(dtKey, dList);

    const sList = segmentGroups.get(segKey) ?? [];
    sList.push(rec);
    segmentGroups.set(segKey, sList);
  });

  const exactMap = new Map<string, AggregatedSlotStats>();
  exactGroups.forEach((list, k) => exactMap.set(k, computeStatsFromRecords(list)));

  // If supplemental pre-aggregated hour slots exist (e.g. for hours not sampled in trip records),
  // register them only where exact historical trip slots aren't already computed.
  supplementalObservations.forEach((obs) => {
    const exactKey = `${obs.route_id}|${obs.from_stop_id}|${obs.to_stop_id}|${obs.day_type}|${obs.hour}`;
    if (!exactMap.has(exactKey)) {
      exactMap.set(exactKey, {
        medianLoad: obs.median_load,
        observationsCount: obs.observations_count,
        weeklyCv: obs.weekly_cv,
        unmatchedStopRate: obs.unmatched_stop_rate,
        tripGroupingReliability: obs.trip_grouping_reliability,
        missingDataRate: obs.missing_data_rate ?? 0.03,
      });
    }
  });

  const dayTypeMap = new Map<string, AggregatedSlotStats>();
  dayTypeGroups.forEach((list, k) => dayTypeMap.set(k, computeStatsFromRecords(list)));

  const segmentMap = new Map<string, AggregatedSlotStats>();
  segmentGroups.forEach((list, k) => segmentMap.set(k, computeStatsFromRecords(list)));

  const sortedDates = [...new Set(records.map((r) => r.date))].sort();
  const dateRangeLabel =
    sortedDates.length > 0
      ? `${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]}`
      : 'No dated historical records';

  return {
    exactMap,
    dayTypeMap,
    segmentMap,
    trainingRecordCount: records.length,
    dateRangeLabel,
    isSimulated: records.every((r) => r.is_simulated),
  };
}

/**
 * Deterministic PRNG for reproducible Random Forest bootstrap & feature subsampling.
 */
function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function encodeFeatures(
  rec: Pick<
    HistoricalSegmentRecord,
    'route_number' | 'direction' | 'segment_order' | 'hour' | 'day_of_week' | 'day_type' | 'is_ac'
  >,
  routeIndexMap: Map<string, number>
): number[] {
  const routeIdx = routeIndexMap.get(rec.route_number) ?? 0;
  const dirFlag = rec.direction === 'UP' ? 0 : 1;
  const isWeekend = rec.day_type === 'weekend' ? 1 : 0;
  const isAc = rec.is_ac ? 1 : 0;
  return [routeIdx, dirFlag, rec.segment_order, rec.hour, rec.day_of_week, isWeekend, isAc];
}

function buildRegressionTree(
  X: number[][],
  y: number[],
  indices: number[],
  depth: number,
  maxDepth: number,
  minSamplesSplit: number,
  maxFeatures: number,
  rng: () => number
): RegressionTreeNode {
  const n = indices.length;
  const meanY = indices.reduce((sum, idx) => sum + y[idx], 0) / Math.max(1, n);

  if (depth >= maxDepth || n < minSamplesSplit) {
    return { isLeaf: true, prediction: meanY };
  }

  // Check if all targets are virtually identical
  const firstY = y[indices[0]];
  if (indices.every((idx) => Math.abs(y[idx] - firstY) < 0.01)) {
    return { isLeaf: true, prediction: meanY };
  }

  const totalFeatures = X[0].length;
  const candidateFeatures: number[] = [];
  const pool = Array.from({ length: totalFeatures }, (_, i) => i);
  while (candidateFeatures.length < Math.min(maxFeatures, totalFeatures) && pool.length > 0) {
    const pickIdx = Math.floor(rng() * pool.length);
    candidateFeatures.push(pool.splice(pickIdx, 1)[0]);
  }

  let bestFeature = -1;
  let bestThreshold = 0;
  let bestScore = Infinity;
  let bestLeft: number[] = [];
  let bestRight: number[] = [];

  for (const fIdx of candidateFeatures) {
    const uniqueVals = Array.from(new Set(indices.map((i) => X[i][fIdx]))).sort((a, b) => a - b);
    if (uniqueVals.length <= 1) continue;

    // Evaluate midpoints (limit candidate thresholds for speed)
    const step = Math.max(1, Math.floor(uniqueVals.length / 8));
    for (let u = 0; u < uniqueVals.length - 1; u += step) {
      const threshold = (uniqueVals[u] + uniqueVals[u + 1]) / 2;
      const leftIdx: number[] = [];
      const rightIdx: number[] = [];
      let sumL = 0;
      let sumR = 0;

      for (const idx of indices) {
        if (X[idx][fIdx] <= threshold) {
          leftIdx.push(idx);
          sumL += y[idx];
        } else {
          rightIdx.push(idx);
          sumR += y[idx];
        }
      }

      if (leftIdx.length === 0 || rightIdx.length === 0) continue;

      const meanL = sumL / leftIdx.length;
      const meanR = sumR / rightIdx.length;
      let sse = 0;
      for (const idx of leftIdx) sse += (y[idx] - meanL) ** 2;
      for (const idx of rightIdx) sse += (y[idx] - meanR) ** 2;

      if (sse < bestScore) {
        bestScore = sse;
        bestFeature = fIdx;
        bestThreshold = threshold;
        bestLeft = leftIdx;
        bestRight = rightIdx;
      }
    }
  }

  if (bestFeature === -1) {
    return { isLeaf: true, prediction: meanY };
  }

  return {
    isLeaf: false,
    featureIndex: bestFeature,
    threshold: bestThreshold,
    left: buildRegressionTree(
      X,
      y,
      bestLeft,
      depth + 1,
      maxDepth,
      minSamplesSplit,
      maxFeatures,
      rng
    ),
    right: buildRegressionTree(
      X,
      y,
      bestRight,
      depth + 1,
      maxDepth,
      minSamplesSplit,
      maxFeatures,
      rng
    ),
  };
}

function predictSingleTree(node: RegressionTreeNode, features: number[]): number {
  if (node.isLeaf || node.featureIndex === undefined || node.threshold === undefined) {
    return node.prediction ?? 0;
  }
  if (features[node.featureIndex] <= node.threshold) {
    return node.left ? predictSingleTree(node.left, features) : 0;
  }
  return node.right ? predictSingleTree(node.right, features) : 0;
}

/**
 * TRAINING STEP 2: Optional Random Forest Regressor
 * Trained only when >= RANDOM_FOREST_MIN_RECORDS historical observations exist.
 */
export function trainRandomForestModel(
  records: HistoricalSegmentRecord[],
  numTrees = 12
): TrainedRandomForestModel | null {
  if (records.length < RANDOM_FOREST_MIN_RECORDS) {
    return null;
  }

  const routeNumbers = Array.from(new Set(records.map((r) => r.route_number))).sort();
  const routeIndexMap = new Map(routeNumbers.map((r, idx) => [r, idx]));

  const X = records.map((r) => encodeFeatures(r, routeIndexMap));
  const y = records.map((r) => r.observed_load);

  const rng = createSeededRng(20261031);
  const trees: RegressionTreeNode[] = [];

  for (let t = 0; t < numTrees; t++) {
    const bootstrapIndices: number[] = [];
    for (let i = 0; i < records.length; i++) {
      bootstrapIndices.push(Math.floor(rng() * records.length));
    }
    trees.push(buildRegressionTree(X, y, bootstrapIndices, 0, 7, 5, 3, rng));
  }

  return {
    trees,
    routeIndexMap,
    trainingRecordCount: records.length,
    featureNames: [
      'route',
      'direction',
      'segment_order',
      'hour_of_day',
      'day_of_week',
      'is_weekend',
      'is_ac',
    ],
    isSimulated: records.every((r) => r.is_simulated),
  };
}

/**
 * PREDICTION STEP: Predict passenger load using Baseline Median or Random Forest.
 */
export function predictWithBaseline(
  query: PredictionQuery,
  model: TrainedBaselineModel
): {
  stats: AggregatedSlotStats | null;
  fallbackTier: PredictionExplanation['fallbackTier'];
} {
  const segKey = `${query.routeId}|${query.fromStopId}|${query.toStopId}`;
  const dtKey = `${segKey}|${query.dayType}`;
  const exactKey = `${dtKey}|${query.hour}`;

  const exact = model.exactMap.get(exactKey);
  if (exact) return { stats: exact, fallbackTier: 'exact_slot' };

  const dayTypeOnly = model.dayTypeMap.get(dtKey);
  if (dayTypeOnly) return { stats: dayTypeOnly, fallbackTier: 'day_type_only' };

  const segOverall = model.segmentMap.get(segKey);
  if (segOverall) return { stats: segOverall, fallbackTier: 'segment_overall' };

  return { stats: null, fallbackTier: 'no_historical_data' };
}

export function predictWithRandomForest(
  query: PredictionQuery,
  model: TrainedRandomForestModel | null
): number | null {
  if (!model || model.trees.length === 0) return null;

  const features = encodeFeatures(
    {
      route_number: query.routeNumber,
      direction: query.direction,
      segment_order: query.segmentOrder,
      hour: query.hour,
      day_of_week: query.dayOfWeek,
      day_type: query.dayType,
      is_ac: query.isAc,
    },
    model.routeIndexMap
  );

  const total = model.trees.reduce((sum, tree) => sum + predictSingleTree(tree, features), 0);
  return Math.max(0, Math.round(total / model.trees.length));
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function predictSegmentCrowding(
  query: PredictionQuery,
  baselineModel: TrainedBaselineModel,
  rfModel: TrainedRandomForestModel | null,
  preferredModel: PredictionModelType = 'baseline-median',
  capacityConfig: CapacityConfig = DEFAULT_CAPACITY_CONFIG
) {
  const { stats, fallbackTier } = predictWithBaseline(query, baselineModel);
  const rfLoad = predictWithRandomForest(query, rfModel);
  const baselineLoad = stats?.medianLoad ?? null;

  const assumedCapacity = query.isAc ? capacityConfig.acCapacity : capacityConfig.nonAcCapacity;
  const hasHistoricalData = stats !== null || rfLoad !== null;

  let predictedLoad: number;
  let modelUsed: PredictionExplanation['modelUsed'];

  if (preferredModel === 'random-forest' && rfLoad !== null && stats !== null) {
    predictedLoad = rfLoad;
    modelUsed = 'random-forest';
  } else if (baselineLoad !== null) {
    predictedLoad = baselineLoad;
    modelUsed = 'baseline-median';
  } else if (rfLoad !== null) {
    predictedLoad = rfLoad;
    modelUsed = 'random-forest';
  } else {
    // Missing historical data: keep non-fabricated internal baseline numeric value for API compatibility,
    // while flagging hasHistoricalData = false so UI & scorer show "Insufficient historical data".
    predictedLoad = Math.round(assumedCapacity * 0.5);
    modelUsed = 'fallback-missing';
  }

  const { occupancyPct, level } = classifyCrowding(predictedLoad, assumedCapacity, capacityConfig);

  let confidence: ConfidenceLevel;
  let confidenceReason: string;
  let confidenceBreakdown;

  if (stats && fallbackTier === 'exact_slot') {
    const evalRes = evaluateConfidence({
      route_id: query.routeId,
      route_number: query.routeNumber,
      direction: query.direction,
      from_stop_id: query.fromStopId,
      to_stop_id: query.toStopId,
      from_stop_name: query.fromStopName,
      to_stop_name: query.toStopName,
      segment_order: query.segmentOrder,
      hour: query.hour,
      day_type: query.dayType,
      median_load: stats.medianLoad,
      p75_load: stats.medianLoad,
      boardings_avg: 0,
      alightings_avg: 0,
      observations_count: stats.observationsCount,
      weekly_cv: stats.weeklyCv,
      unmatched_stop_rate: stats.unmatchedStopRate,
      trip_grouping_reliability: stats.tripGroupingReliability,
      missing_data_rate: stats.missingDataRate,
      is_simulated: baselineModel.isSimulated,
    });
    confidence = evalRes.confidence;
    confidenceReason = evalRes.reason;
    confidenceBreakdown = evalRes.breakdown;
  } else if (stats) {
    // Fallback across hours/day-types reduces confidence to at most Medium
    confidence = stats.observationsCount >= 15 ? 'Medium' : 'Low';
    confidenceReason =
      fallbackTier === 'day_type_only'
        ? `No exact ${String(query.hour).padStart(2, '0')}:00 slice; generalized from ${stats.observationsCount} ${query.dayType} trips on this segment.`
        : `Sparse hourly history; generalized from ${stats.observationsCount} total trips on this segment.`;
    confidenceBreakdown = {
      observationsCount: stats.observationsCount,
      weeklyConsistencyPct: Math.max(0, Math.round((1 - stats.weeklyCv) * 100)),
      missingDataRatePct: Math.round(stats.missingDataRate * 100),
      stopMatchQualityPct: Math.round((1 - stats.unmatchedStopRate) * 100),
      tripGroupingReliabilityPct: Math.round(stats.tripGroupingReliability * 100),
    };
  } else {
    confidence = 'Low';
    confidenceReason =
      'Insufficient historical data: no historical ticket observations found for this route segment and time window.';
    confidenceBreakdown = {
      observationsCount: 0,
      weeklyConsistencyPct: 0,
      missingDataRatePct: 100,
      stopMatchQualityPct: 0,
      tripGroupingReliabilityPct: 0,
    };
  }

  const dayLabel = DAY_NAMES[query.dayOfWeek] ?? 'Weekday';
  const hourStr = `${String(query.hour).padStart(2, '0')}:00–${String(query.hour).padStart(2, '0')}:59 IST`;

  const explanation: PredictionExplanation = {
    modelUsed,
    fallbackTier,
    observationsUsed:
      stats !== null
        ? `${stats.observationsCount} historical trip observations (${baselineModel.dateRangeLabel})`
        : '0 matching historical observations (Insufficient historical data)',
    timePeriodConsidered: `${hourStr} · ${dayLabel} (${query.dayType})`,
    calculationMethod:
      modelUsed === 'random-forest'
        ? `Random Forest (12 trees trained on route, direction, segment, hour, day-of-week, and AC flag) predicted ${predictedLoad} pax / ${assumedCapacity} assumed capacity = ${occupancyPct}%.`
        : modelUsed === 'baseline-median'
        ? `Historical median segment load (${predictedLoad} pax) from Load[s] = Prev + Boarding - Alighting, divided by ${assumedCapacity} assumed capacity = ${occupancyPct}%.`
        : 'Insufficient historical data for this segment; crowding level is not fabricated.',
    assumptions: [
      `Assumed ${query.isAc ? 'AC' : 'Non-AC'} vehicle capacity: ${assumedCapacity} passengers (prototype threshold).`,
      'Ticket destination reflects planned alighting at purchase, not verified physical exit.',
      'Monthly pass holders and concession riders without ETM tickets are not captured in ticket counts.',
    ],
    confidenceReason,
    confidenceBreakdown,
    baselineLoad,
    randomForestLoad: rfLoad,
  };

  return {
    predictedLoad,
    assumedCapacity,
    occupancyPct,
    crowdingLevel: level,
    confidence,
    confidenceReason,
    observationsCount: stats?.observationsCount ?? 0,
    hasHistoricalData,
    explanation,
  };
}
