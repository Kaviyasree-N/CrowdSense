import assert from 'node:assert/strict';
import { SAMPLE_HISTORICAL_RECORDS } from '../data/samplePredictions.ts';
import { SAMPLE_ROUTES } from '../data/sampleRoutes.ts';
import { STOP_MAP } from '../data/sampleStops.ts';
import { evaluateModelsChronologically } from '../engine/modelEvaluation.ts';
import { crowdingService } from '../services/crowdingService.ts';
import { journeyService } from '../services/journeyService.ts';
import { recommendationService } from '../services/recommendationService.ts';
import type { BusRoute, BusStop, ETMTicketRecord, SegmentObservation } from '../types/transit.ts';
import { computeWeeklyStabilityReport } from '../utils/analyticsEngine.ts';
import { DEFAULT_CAPACITY_CONFIG } from '../utils/crowdClassification.ts';
import { matchStopToRoute, reconstructTripsDetailed } from '../utils/passengerLoad.ts';
import { normalizeToAsiaKolkata } from '../utils/timeIst.ts';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

runTest('1. matchStopToRoute rejects empty short_name false-positive matching', () => {
  const customStops: Record<string, BusStop> = {
    S1: {
      stop_id: 'S1',
      stop_name: 'Kashmere Gate ISBT',
      short_name: '',
      lat: 28.66,
      lng: 77.22,
      zone: 'North',
      is_major_hub: true,
    },
    S2: {
      stop_id: 'S2',
      stop_name: 'ITO Crossing',
      short_name: 'ITO',
      lat: 28.62,
      lng: 77.24,
      zone: 'Central',
      is_major_hub: false,
    },
  };
  const customRoute: BusRoute = {
    route_id: 'R_TEST_UP',
    route_number: '999',
    route_name: 'Test Corridor',
    direction: 'UP',
    direction_label: 'North-Central',
    is_ac: false,
    default_capacity: 50,
    frequency_mins: 15,
    operating_hours: '06:00-22:00',
    stops: [
      { stop_id: 'S1', stop_sequence: 1, minutes_from_start: 0 },
      { stop_id: 'S2', stop_sequence: 2, minutes_from_start: 15 },
    ],
  };

  assert.equal(matchStopToRoute('Completely Unknown Stop XYZ', customRoute, customStops), null);
  const itoMatch = matchStopToRoute('ITO Crossing', customRoute, customStops);
  assert.equal(itoMatch?.stopId, 'S2');
  assert.equal(itoMatch?.sequence, 2);
});

runTest('2. Asia/Kolkata normalization converts UTC Z and DD/MM/YYYY formats consistently', () => {
  const utcStamp = normalizeToAsiaKolkata('2026-10-14T12:30:00Z');
  assert.ok(utcStamp);
  assert.equal(utcStamp.date, '2026-10-14');
  assert.equal(utcStamp.hour, 18); // +05:30 IST
  assert.equal(utcStamp.dayType, 'weekday');

  const dmyStamp = normalizeToAsiaKolkata('18/10/2026 09:15:00');
  assert.ok(dmyStamp);
  assert.equal(dmyStamp.date, '2026-10-18');
  assert.equal(dmyStamp.hour, 9);
  assert.equal(dmyStamp.dayType, 'weekend');

  assert.equal(normalizeToAsiaKolkata('2026-02-31 10:00:00'), null);
});

runTest('3. Manual Passenger Load math check: Load[s] = Prev + Board - Alight & multi-pax', () => {
  const r39Up = SAMPLE_ROUTES.find((r) => r.route_id === 'R39_UP');
  assert.ok(r39Up);

  // Stop sequence along 39_UP:
  // 1: Anand Vihar ISBT (DL_ANV)
  // 2: Preet Vihar (DL_PRV)
  // 3: Laxmi Nagar (DL_LXN)
  // 4: ITO Crossing (DL_ITO)
  // 5: Mandi House (DL_MDH)
  const tickets: ETMTicketRecord[] = [
    {
      created_at: '2026-10-14T12:32:00Z', // 18:02 IST
      vehicle_number: 'DL1PD9001',
      route: '39',
      start_stop_name: 'Anand Vihar ISBT',
      end_stop_name: 'Laxmi Nagar',
      passenger_count: 4,
      amount: 60,
      ticket_type_id: 1,
      is_ac: false,
    },
    {
      created_at: '2026-10-14 18:07:00',
      vehicle_number: 'DL1PD9001',
      route: '39',
      start_stop_name: 'Preet Vihar',
      end_stop_name: 'Mandi House',
      passenger_count: 3,
      amount: 45,
      ticket_type_id: 1,
      is_ac: false,
    },
    {
      created_at: '2026-10-14 18:11:00',
      vehicle_number: 'DL1PD9001',
      route: '39',
      start_stop_name: 'Laxmi Nagar',
      end_stop_name: 'ITO Crossing',
      passenger_count: 2,
      amount: 20,
      ticket_type_id: 1,
      is_ac: false,
    },
  ];

  const batch = reconstructTripsDetailed(tickets, [r39Up], 45, STOP_MAP);
  assert.equal(batch.trips.length, 1);
  const trip = batch.trips[0];
  assert.equal(trip.hour, 18); // Normalized IST hour from Z + naive
  assert.equal(trip.totalPassengers, 9);

  // Segment 1 (ANV -> PRV): +4 board, -0 alight => 4
  assert.equal(trip.segments[0].runningLoad, 4);
  // Segment 2 (PRV -> LXN): 4 + 3 board - 0 alight => 7
  assert.equal(trip.segments[1].runningLoad, 7);
  // Segment 3 (LXN -> ITO): 7 + 2 board - 4 alight => 5
  assert.equal(trip.segments[2].runningLoad, 5);
  // Segment 4 (ITO -> MDH): 5 + 0 board - 2 alight => 3
  assert.equal(trip.segments[3].runningLoad, 3);
  // Segment 5 (MDH -> CP): 3 + 0 board - 3 alight => 0
  assert.equal(trip.segments[4].runningLoad, 0);
});

runTest('4. ML Evaluation includes per-route, per-time-period, and ground-truth caveat', () => {
  const report = evaluateModelsChronologically(SAMPLE_HISTORICAL_RECORDS);
  assert.equal(report.status, 'evaluated');
  assert.ok(report.baselineMetrics);
  assert.ok(report.routeBreakdown && report.routeBreakdown.length > 0);
  assert.ok(report.timePeriodBreakdown && report.timePeriodBreakdown.length >= 3);
  assert.ok(report.evaluationGroundTruthNote?.includes('ticket-derived'));
});

runTest('5. Week-to-week stability identifies consistent hotspots, unstable CV, and insufficient routes', () => {
  const obs: SegmentObservation[] = [
    {
      route_id: '39_UP',
      route_number: '39',
      direction: 'UP',
      from_stop_id: 'DL_LXN',
      to_stop_id: 'DL_ITO',
      from_stop_name: 'Laxmi Nagar',
      to_stop_name: 'ITO Crossing',
      segment_order: 3,
      hour: 18,
      day_type: 'weekday',
      median_load: 64,
      p75_load: 68,
      boardings_avg: 18,
      alightings_avg: 12,
      observations_count: 42,
      weekly_cv: 0.11,
      unmatched_stop_rate: 0.02,
      trip_grouping_reliability: 0.94,
      is_simulated: true,
    },
    {
      route_id: '85A_UP',
      route_number: '85A',
      direction: 'UP',
      from_stop_id: 'DL_PRV',
      to_stop_id: 'DL_LXN',
      from_stop_name: 'Preet Vihar',
      to_stop_name: 'Laxmi Nagar',
      segment_order: 2,
      hour: 22,
      day_type: 'weekend',
      median_load: 19,
      p75_load: 29,
      boardings_avg: 6,
      alightings_avg: 4,
      observations_count: 6,
      weekly_cv: 0.42,
      unmatched_stop_rate: 0.1,
      trip_grouping_reliability: 0.78,
      is_simulated: true,
    },
  ];
  const capMap = new Map([
    ['39_UP', 50],
    ['85A_UP', 45],
  ]);

  const report = computeWeeklyStabilityReport({
    observations: obs,
    catalogedRouteNumbers: ['39', '85A', '999_EMPTY'],
    routeCapacityLookup: capMap,
    capacityConfig: DEFAULT_CAPACITY_CONFIG,
  });

  assert.equal(report.periods.length, 3);
  assert.equal(report.consistentHotspots.length, 1);
  assert.equal(report.consistentHotspots[0].routeNumber, '39');
  assert.ok(report.unstableSegments.some((u) => u.routeNumber === '85A'));
  assert.ok(report.insufficientDataRoutes.some((s) => s.includes('999_EMPTY')));
  assert.ok(report.insufficientDataRoutes.some((s) => s.includes('85A')));
});

runTest('6. recommendationService.filterByCategory returns empty array when no match exists', () => {
  crowdingService.setUploadedTrainingRecords(null);
  const res = journeyService.searchJourneysDetailed(
    {
      sourceStopId: 'DL_ANV',
      destinationStopId: 'DL_CP',
      date: '2026-10-14',
      time: '18:00',
      preferredCategory: 'balanced',
    },
    DEFAULT_CAPACITY_CONFIG,
    'baseline-median',
    { dataMode: 'demo' }
  );
  assert.ok(res.journeys.length >= 2);

  const syntheticNoMatch = res.journeys.map((j) => ({
    ...j,
    recommendation_tags: ['fastest' as const],
  }));
  const filtered = recommendationService.filterByCategory(syntheticNoMatch, 'least-crowded');
  assert.equal(filtered.length, 0);
});
