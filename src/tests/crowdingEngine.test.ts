import assert from 'node:assert/strict';
import { SAMPLE_HISTORICAL_RECORDS } from '../data/samplePredictions';
import { SAMPLE_ROUTES } from '../data/sampleRoutes';
import { evaluateModelsChronologically } from '../engine/modelEvaluation';
import {
  predictSegmentCrowding,
  trainBaselineMedianModel,
  trainRandomForestModel,
} from '../engine/predictionEngine';
import { journeyService } from '../services/journeyService';
import { ETMTicketRecord } from '../types/transit';
import { classifyCrowding } from '../utils/crowdClassification';
import {
  evaluateConfidence,
  reconstructTripsDetailed,
} from '../utils/passengerLoad';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

// 1. Multiple passengers boarding (passenger_count > 1)
runTest('Multiple passengers boarding aggregates passenger_count > 1', () => {
  const tickets: ETMTicketRecord[] = [
    {
      created_at: '2026-10-14 18:02:00',
      vehicle_number: 'DL1PD1001',
      route: '39',
      start_stop_name: 'Anand Vihar ISBT',
      end_stop_name: 'ITO Crossing',
      passenger_count: 4,
      amount: 60,
      ticket_type_id: 1,
      is_ac: false,
    },
    {
      created_at: '2026-10-14 18:04:00',
      vehicle_number: 'DL1PD1001',
      route: '39',
      start_stop_name: 'Anand Vihar ISBT',
      end_stop_name: 'Connaught Place (Shivaji Stadium)',
      passenger_count: 3,
      amount: 45,
      ticket_type_id: 1,
      is_ac: false,
    },
  ];

  const res = reconstructTripsDetailed(tickets, SAMPLE_ROUTES);
  assert.equal(res.trips.length, 1);
  assert.equal(res.trips[0].totalPassengers, 7);
  assert.equal(res.trips[0].segments[0].boardings, 7);
  assert.equal(res.trips[0].segments[0].runningLoad, 7);
});

// 2. Passengers getting off at intermediate stops
runTest('Passengers alighting at intermediate stops reduce subsequent segment loads', () => {
  const tickets: ETMTicketRecord[] = [
    {
      created_at: '2026-10-14 18:02:00',
      vehicle_number: 'DL1PD1002',
      route: '39',
      start_stop_name: 'Anand Vihar ISBT',
      end_stop_name: 'Preet Vihar',
      passenger_count: 5,
      amount: 50,
      ticket_type_id: 1,
      is_ac: false,
    },
    {
      created_at: '2026-10-14 18:03:00',
      vehicle_number: 'DL1PD1002',
      route: '39',
      start_stop_name: 'Anand Vihar ISBT',
      end_stop_name: 'ITO Crossing',
      passenger_count: 2,
      amount: 30,
      ticket_type_id: 1,
      is_ac: false,
    },
  ];

  const res = reconstructTripsDetailed(tickets, SAMPLE_ROUTES);
  const segs = res.trips[0].segments;
  // Seg 1: Anand Vihar -> Preet Vihar = 7 pax
  assert.equal(segs[0].runningLoad, 7);
  // At Preet Vihar, 5 alight -> Seg 2: Preet Vihar -> Laxmi Nagar = 2 pax
  assert.equal(segs[1].alightings, 5);
  assert.equal(segs[1].runningLoad, 2);
});

// 3. Multiple consecutive stops + non-negative running load protection
runTest('Multiple consecutive stops maintain running load and never go negative', () => {
  const tickets: ETMTicketRecord[] = [
    {
      created_at: '2026-10-14 18:00:00',
      vehicle_number: 'DL1PD1003',
      route: '39',
      start_stop_name: 'Anand Vihar ISBT',
      end_stop_name: 'Laxmi Nagar',
      passenger_count: 3,
      amount: 30,
      ticket_type_id: 1,
      is_ac: false,
    },
    {
      created_at: '2026-10-14 18:08:00',
      vehicle_number: 'DL1PD1003',
      route: '39',
      start_stop_name: 'Preet Vihar',
      end_stop_name: 'Mandi House',
      passenger_count: 4,
      amount: 60,
      ticket_type_id: 1,
      is_ac: false,
    },
    {
      created_at: '2026-10-14 18:15:00',
      vehicle_number: 'DL1PD1003',
      route: '39',
      start_stop_name: 'Laxmi Nagar',
      end_stop_name: 'Rajiv Chowk Metro Gate',
      passenger_count: 6,
      amount: 90,
      ticket_type_id: 1,
      is_ac: false,
    },
  ];

  const res = reconstructTripsDetailed(tickets, SAMPLE_ROUTES);
  const segs = res.trips[0].segments;
  // Seg 1 (ANV -> PRV): +3 = 3
  assert.equal(segs[0].runningLoad, 3);
  // Seg 2 (PRV -> LXN): 3 + 4 = 7
  assert.equal(segs[1].runningLoad, 7);
  // Seg 3 (LXN -> ITO): 7 + 6 - 3 = 10
  assert.equal(segs[2].runningLoad, 10);
  // Seg 4 (ITO -> MDH): 10
  assert.equal(segs[3].runningLoad, 10);
  // Seg 5 (MDH -> RJC): 10 - 4 = 6
  assert.equal(segs[4].runningLoad, 6);
  // Seg 6 (RJC -> CP): 6 - 6 = 0
  assert.equal(segs[5].runningLoad, 0);
  assert.ok(segs.every((s) => s.runningLoad >= 0));
});

// 4. Explainable trip splitting on layover gap (>45m) and direction reversal
runTest('Same vehicle_number and route splits into separate trips on layover gap or reversal', () => {
  const tickets: ETMTicketRecord[] = [
    // Morning UP trip
    {
      created_at: '2026-10-14 08:00:00',
      vehicle_number: 'DL1PD4821',
      route: '39',
      start_stop_name: 'Anand Vihar ISBT',
      end_stop_name: 'ITO Crossing',
      passenger_count: 2,
      amount: 30,
      ticket_type_id: 1,
      is_ac: false,
    },
    {
      created_at: '2026-10-14 08:12:00',
      vehicle_number: 'DL1PD4821',
      route: '39',
      start_stop_name: 'Laxmi Nagar',
      end_stop_name: 'Connaught Place (Shivaji Stadium)',
      passenger_count: 2,
      amount: 30,
      ticket_type_id: 1,
      is_ac: false,
    },
    // Return DOWN trip 70 minutes later
    {
      created_at: '2026-10-14 09:25:00',
      vehicle_number: 'DL1PD4821',
      route: '39',
      start_stop_name: 'Connaught Place (Shivaji Stadium)',
      end_stop_name: 'Anand Vihar ISBT',
      passenger_count: 3,
      amount: 45,
      ticket_type_id: 1,
      is_ac: false,
    },
  ];

  const res = reconstructTripsDetailed(tickets, SAMPLE_ROUTES);
  assert.equal(res.trips.length, 2);
  assert.equal(res.trips[0].direction, 'UP');
  assert.equal(res.trips[1].direction, 'DOWN');
});

// 5. Missing stop mappings and confidence penalty
runTest('Missing stop mappings are flagged and lower confidence', () => {
  const tickets: ETMTicketRecord[] = [
    {
      created_at: '2026-10-14 18:00:00',
      vehicle_number: 'DL1PD9999',
      route: '39',
      start_stop_name: 'Unknown Depot Stop XYZ',
      end_stop_name: 'ITO Crossing',
      passenger_count: 2,
      amount: 30,
      ticket_type_id: 1,
      is_ac: false,
    },
    {
      created_at: '2026-10-14 18:05:00',
      vehicle_number: 'DL1PD9999',
      route: '39',
      start_stop_name: 'Anand Vihar ISBT',
      end_stop_name: 'ITO Crossing',
      passenger_count: 2,
      amount: 30,
      ticket_type_id: 1,
      is_ac: false,
    },
  ];

  const res = reconstructTripsDetailed(tickets, SAMPLE_ROUTES);
  assert.equal(res.trips[0].unmatchedTickets, 1);
  assert.equal(res.trips[0].unmatchedStopRate, 0.5);
  assert.equal(res.trips[0].isAmbiguousGrouping, true);

  const conf = evaluateConfidence({
    route_id: 'R39_UP',
    route_number: '39',
    direction: 'UP',
    from_stop_id: 'DL_ANV',
    to_stop_id: 'DL_PRV',
    from_stop_name: 'Anand Vihar',
    to_stop_name: 'Preet Vihar',
    segment_order: 1,
    hour: 18,
    day_type: 'weekday',
    median_load: 30,
    p75_load: 35,
    boardings_avg: 10,
    alightings_avg: 5,
    observations_count: 40,
    weekly_cv: 0.1,
    unmatched_stop_rate: 0.5,
    trip_grouping_reliability: 0.65,
    missing_data_rate: 0.25,
    is_simulated: true,
  });
  assert.equal(conf.confidence, 'Low');
});

// 6. Invalid ticket records
runTest('Invalid ticket records are rejected cleanly with explicit reasons', () => {
  const invalidBatch: ETMTicketRecord[] = [
    {
      created_at: 'not-a-date',
      vehicle_number: 'DL1PD1111',
      route: '39',
      start_stop_name: 'Anand Vihar ISBT',
      end_stop_name: 'ITO Crossing',
      passenger_count: 1,
      amount: 15,
      ticket_type_id: 1,
      is_ac: false,
    },
    {
      created_at: '2026-10-14 18:00:00',
      vehicle_number: 'DL1PD1111',
      route: '39',
      start_stop_name: 'ITO Crossing',
      end_stop_name: 'ITO Crossing',
      passenger_count: 2,
      amount: 20,
      ticket_type_id: 1,
      is_ac: false,
    },
    {
      created_at: '2026-10-14 18:00:00',
      vehicle_number: 'DL1PD1111',
      route: '39',
      start_stop_name: 'Anand Vihar ISBT',
      end_stop_name: 'ITO Crossing',
      passenger_count: 0,
      amount: 0,
      ticket_type_id: 1,
      is_ac: false,
    },
  ];

  const res = reconstructTripsDetailed(invalidBatch, SAMPLE_ROUTES);
  assert.equal(res.validTicketsCount, 0);
  assert.equal(res.invalidTickets.length, 3);
  assert.equal(res.trips.length, 0);
});

// 7. Different bus capacities & classification thresholds
runTest('Different bus capacities produce correct Crowding Ratios and labels', () => {
  // 48 pax on 45-capacity AC bus -> 107% (Crowded)
  const ac45 = classifyCrowding(48, 45);
  assert.equal(ac45.occupancyPct, 107);
  assert.equal(ac45.level, 'Crowded');

  // 48 pax on 50-capacity Non-AC bus -> 96% (Standing Room)
  const std50 = classifyCrowding(48, 50);
  assert.equal(std50.occupancyPct, 96);
  assert.equal(std50.level, 'Standing Room');

  // 48 pax on 70-capacity bus -> 69% (Seats Available)
  const large70 = classifyCrowding(48, 70);
  assert.equal(large70.occupancyPct, 69);
  assert.equal(large70.level, 'Seats Available');

  // 60 pax on 50-capacity bus -> 120% (Very Crowded)
  const over120 = classifyCrowding(60, 50);
  assert.equal(over120.occupancyPct, 120);
  assert.equal(over120.level, 'Very Crowded');
});

// 8. Missing historical observations fallback
runTest('Missing historical observations fall back safely with Low confidence', () => {
  const baseline = trainBaselineMedianModel(SAMPLE_HISTORICAL_RECORDS);
  const rf = trainRandomForestModel(SAMPLE_HISTORICAL_RECORDS);

  const pred = predictSegmentCrowding(
    {
      routeId: 'UNKNOWN_ROUTE',
      routeNumber: '999',
      direction: 'UP',
      fromStopId: 'STOP_A',
      toStopId: 'STOP_B',
      fromStopName: 'Stop A',
      toStopName: 'Stop B',
      segmentOrder: 1,
      hour: 18,
      dayOfWeek: 3,
      dayType: 'weekday',
      isAc: false,
    },
    baseline,
    rf,
    'baseline-median'
  );

  assert.equal(pred.confidence, 'Low');
  assert.equal(pred.explanation.fallbackTier, 'no_historical_data');
  assert.ok(Number.isFinite(pred.predictedLoad) && pred.predictedLoad > 0);
});

// 9. Weekday vs Weekend predictions + Chronological Evaluation + Insufficient Data check
runTest('Weekday vs weekend predictions differ and chronological evaluation computes MAE/RMSE', () => {
  const weekdayJourneys = journeyService.searchJourneys({
    sourceStopId: 'DL_ANV',
    destinationStopId: 'DL_CP',
    date: '2026-10-14', // Wednesday
    time: '18:00',
  });
  const weekendJourneys = journeyService.searchJourneys({
    sourceStopId: 'DL_ANV',
    destinationStopId: 'DL_CP',
    date: '2026-10-17', // Saturday
    time: '18:00',
  });

  assert.ok(weekdayJourneys.length >= 3);
  assert.ok(weekendJourneys.length >= 3);
  assert.ok(
    weekdayJourneys[0].all_segments[0].prediction_explanation !== undefined,
    'Journey segment must include transparent prediction_explanation'
  );

  const weekdayR39 = weekdayJourneys.find((j) => j.legs[0].route_number === '39')!;
  const weekendR39 = weekendJourneys.find((j) => j.legs[0].route_number === '39')!;
  assert.notEqual(
    weekdayR39.peak_segment_occupancy_pct,
    weekendR39.peak_segment_occupancy_pct
  );

  // Full chronological evaluation
  const evalReport = evaluateModelsChronologically(SAMPLE_HISTORICAL_RECORDS);
  assert.equal(evalReport.status, 'evaluated');
  assert.ok(evalReport.baselineMetrics !== null);
  assert.ok(evalReport.randomForestMetrics !== null);
  assert.ok(evalReport.baselineMetrics!.mae >= 0);
  assert.ok(evalReport.randomForestMetrics!.rmse >= 0);

  // Insufficient data handling (single-day subset)
  const singleDay = SAMPLE_HISTORICAL_RECORDS.slice(0, 10).map((r) => ({
    ...r,
    date: '2026-10-14',
  }));
  const sparseEval = evaluateModelsChronologically(singleDay);
  assert.equal(sparseEval.status, 'insufficient_data');
  assert.equal(sparseEval.baselineMetrics, null);
});

console.log('ALL 9 CROWDING ENGINE TEST SUITES PASSED');
