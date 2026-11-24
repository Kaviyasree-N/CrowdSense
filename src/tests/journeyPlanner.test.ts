import assert from 'node:assert/strict';
import { processEtmCsvText } from '../engine/etmPipeline.ts';
import { processGTFSFileContents } from '../engine/gtfsProcessor.ts';
import { searchTimeDependentJourneys } from '../engine/journeyGraph.ts';
import { crowdingService } from '../services/crowdingService.ts';
import { journeyService } from '../services/journeyService.ts';
import { DEFAULT_CAPACITY_CONFIG } from '../utils/crowdClassification.ts';
import { scoreAndRankJourneys } from '../utils/routeScoring.ts';
import type { BusStop, JourneyOption } from '../types/transit.ts';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

const MULTI_TRANSFER_GTFS = {
  'stops.txt': [
    'stop_id,stop_name,stop_lat,stop_lon,zone_id',
    'S_A,Stop Alpha,28.6100,77.2000,Zone1',
    'S_B,Stop Beta,28.6150,77.2100,Zone1',
    'S_C,Stop Gamma,28.6200,77.2200,Zone2',
    'S_D,Stop Delta,28.6250,77.2300,Zone2',
    'S_E,Stop Epsilon,28.6300,77.2400,Zone3',
    // Short walking link ~180m from S_B_WALK to S_B (28.6150, 77.2100)
    'S_B_WALK,Stop Beta Annex,28.6164,77.2110,Zone1',
    // Missing coordinates stop (must never invent coords or walking links)
    'S_NO_COORD,Unmapped Coords Stop,,,Zone4',
  ].join('\n'),
  'routes.txt': [
    'route_id,route_short_name,route_long_name',
    'R1,101,Alpha to Beta Express',
    'R2,202,Beta to Gamma Link',
    'R3,303,Gamma to Epsilon Corridor',
    'R4,404,Beta Annex to Epsilon Direct',
  ].join('\n'),
  'trips.txt': [
    'route_id,service_id,trip_id,direction_id,trip_headsign',
    'R1,WKDAY,T1_EARLY,0,To Beta',
    'R1,WKDAY,T1_MORNING,0,To Beta',
    'R2,WKDAY,T2_MORNING,0,To Gamma',
    'R3,WKDAY,T3_MORNING,0,To Epsilon',
    'R4,WKEND,T4_WKEND,0,Weekend Annex to Epsilon',
  ].join('\n'),
  'stop_times.txt': [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    // T1_EARLY departs 07:00 (must NOT be caught by 07:50 search)
    'T1_EARLY,07:00:00,07:00:00,S_A,1',
    'T1_EARLY,07:12:00,07:12:00,S_B,2',
    // T1_MORNING departs 08:00, arrives S_B 08:15
    'T1_MORNING,08:00:00,08:00:00,S_A,1',
    'T1_MORNING,08:15:00,08:15:00,S_B,2',
    // T2_MORNING departs S_B 08:25 (10 min transfer wait), arrives S_C 08:40, S_D 08:50
    'T2_MORNING,08:25:00,08:25:00,S_B,1',
    'T2_MORNING,08:40:00,08:40:00,S_C,2',
    'T2_MORNING,08:50:00,08:50:00,S_D,3',
    // T3_MORNING departs S_C 08:48 (8 min transfer wait), arrives S_E 09:05
    'T3_MORNING,08:48:00,08:48:00,S_C,1',
    'T3_MORNING,09:05:00,09:05:00,S_E,2',
    // T4_WKEND runs Saturdays/Sundays only
    'T4_WKEND,08:22:00,08:22:00,S_B_WALK,1',
    'T4_WKEND,08:55:00,08:55:00,S_E,2',
  ].join('\n'),
  'calendar.txt': [
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    'WKDAY,1,1,1,1,1,0,0,20261001,20261031',
    'WKEND,0,0,0,0,0,1,1,20261001,20261031',
  ].join('\n'),
  'calendar_dates.txt': [
    'service_id,date,exception_type',
    'WKDAY,20261014,1',
    'WKDAY,20261015,2',
  ].join('\n'),
};

// 1. Direct journeys
runTest('1. Direct journey search returns valid non-transfer paths with positive duration', () => {
  const res = journeyService.searchJourneysDetailed({
    sourceStopId: 'DL_ANV',
    destinationStopId: 'DL_CP',
    date: '2026-10-14',
    time: '18:00',
  });
  assert.ok(res.journeys.length >= 3);
  const direct = res.journeys.filter((j) => j.transfers === 0);
  assert.ok(direct.length >= 2);
  direct.forEach((j) => {
    assert.ok(j.total_duration_mins > 0);
    assert.equal(j.source.stop_id, 'DL_ANV');
    assert.equal(j.destination.stop_id, 'DL_CP');
    assert.equal(j.legs.length, 1);
  });
});

// 2. One-transfer journeys
runTest('2. One-transfer journey respects stop sequence and positive transfer wait', () => {
  // Dwarka (DL_DWK) -> Rajouri -> Karol Bagh -> CP (Route 761) + ITO (Route 39 DN)
  const res = journeyService.searchJourneysDetailed({
    sourceStopId: 'DL_DWK',
    destinationStopId: 'DL_ITO',
    date: '2026-10-14',
    time: '18:00',
  });
  assert.ok(res.journeys.length >= 1);
  const oneXfer = res.journeys.find((j) => j.transfers === 1);
  assert.ok(oneXfer, 'Expected a 1-transfer journey from Dwarka to ITO');
  assert.equal(oneXfer!.legs.length, 2);
  assert.ok(oneXfer!.transfer_wait_mins >= 4);
  assert.equal(oneXfer!.transfers_detail?.length, 1);
});

// 3. Two-transfer journeys (both Demo & Actual GTFS)
runTest('3. Two-transfer journey planner finds 3-leg journeys when needed (Demo & GTFS)', () => {
  // In Demo: Dwarka (DL_DWK) -> Hauz Khas (DL_HZK) requires 2 transfers
  const demoRes = journeyService.searchJourneysDetailed({
    sourceStopId: 'DL_DWK',
    destinationStopId: 'DL_HZK',
    date: '2026-10-14',
    time: '18:00',
  });
  assert.ok(demoRes.journeys.length >= 1, 'Expected 2-transfer route from Dwarka to Hauz Khas');
  assert.ok(demoRes.journeys.some((j) => j.transfers === 2));
  const twoXferDemo = demoRes.journeys.find((j) => j.transfers === 2)!;
  assert.equal(twoXferDemo.legs.length, 3);
  assert.equal(twoXferDemo.transfers_detail?.length, 2);

  // In Actual GTFS: S_A -> S_B -> S_C -> S_E requires 2 transfers (101 -> 202 -> 303)
  const gtfs = processGTFSFileContents(MULTI_TRANSFER_GTFS);
  const gtfsRes = journeyService.searchJourneysDetailed(
    {
      sourceStopId: 'S_A',
      destinationStopId: 'S_E',
      date: '2026-10-14', // Wednesday
      time: '07:50',
    },
    DEFAULT_CAPACITY_CONFIG,
    'baseline-median',
    {
      dataMode: 'actual',
      actualRoutes: gtfs.routes,
      actualStops: gtfs.stops,
      scheduledTrips: gtfs.scheduledTrips,
      serviceCalendars: gtfs.serviceCalendars,
    }
  );
  assert.equal(gtfsRes.journeys.length, 1);
  const path = gtfsRes.journeys[0];
  assert.equal(path.transfers, 2);
  assert.deepEqual(
    path.legs.map((l) => l.route_number),
    ['101', '202', '303']
  );
  assert.equal(path.departure_time, '08:00');
  assert.equal(path.arrival_time, '09:05');
  assert.equal(path.total_duration_mins, 65);
  assert.equal(path.transfer_wait_mins, 10 + 8);
});

// 4. Invalid stop combinations, identical stops, invalid dates & times
runTest('4. Invalid stops, same stop, invalid dates, and invalid times return explicit diagnostics', () => {
  const sameStop = journeyService.searchJourneysDetailed({
    sourceStopId: 'DL_ANV',
    destinationStopId: 'DL_ANV',
    date: '2026-10-14',
    time: '18:00',
  });
  assert.equal(sameStop.journeys.length, 0);
  assert.equal(sameStop.errorCode, 'SAME_STOP');

  const unknownStop = journeyService.searchJourneysDetailed({
    sourceStopId: 'NON_EXISTENT',
    destinationStopId: 'DL_CP',
    date: '2026-10-14',
    time: '18:00',
  });
  assert.equal(unknownStop.journeys.length, 0);
  assert.equal(unknownStop.errorCode, 'INVALID_STOPS');

  const invalidTime = journeyService.searchJourneysDetailed({
    sourceStopId: 'DL_ANV',
    destinationStopId: 'DL_CP',
    date: '2026-10-14',
    time: '25:99',
  });
  assert.equal(invalidTime.journeys.length, 0);
  assert.equal(invalidTime.errorCode, 'INVALID_TIME');

  const invalidDate = journeyService.searchJourneysDetailed({
    sourceStopId: 'DL_ANV',
    destinationStopId: 'DL_CP',
    date: '2026-02-31',
    time: '18:00',
  });
  assert.equal(invalidDate.journeys.length, 0);
  assert.equal(invalidDate.errorCode, 'INVALID_DATE');
});

// 5. Scheduled departure filtering & calendar.txt / calendar_dates.txt enforcement
runTest('5. GTFS schedule respects departure time >= query and calendar service exceptions', () => {
  const gtfs = processGTFSFileContents(MULTI_TRANSFER_GTFS);

  // At 07:50, must catch 08:00 T1_MORNING (NOT 07:00 T1_EARLY!)
  const morningRes = journeyService.searchJourneysDetailed(
    {
      sourceStopId: 'S_A',
      destinationStopId: 'S_B',
      date: '2026-10-14',
      time: '07:50',
    },
    DEFAULT_CAPACITY_CONFIG,
    'baseline-median',
    {
      dataMode: 'actual',
      actualRoutes: gtfs.routes,
      actualStops: gtfs.stops,
      scheduledTrips: gtfs.scheduledTrips,
      serviceCalendars: gtfs.serviceCalendars,
    }
  );
  assert.equal(morningRes.journeys.length, 1);
  assert.equal(morningRes.journeys[0].departure_time, '08:00');
  assert.equal(morningRes.journeys[0].uses_gtfs_schedule, true);

  // On 2026-10-15 (exception_type = 2 removed WKDAY), no weekday trip runs
  const removedDayRes = journeyService.searchJourneysDetailed(
    {
      sourceStopId: 'S_A',
      destinationStopId: 'S_B',
      date: '2026-10-15',
      time: '07:50',
    },
    DEFAULT_CAPACITY_CONFIG,
    'baseline-median',
    {
      dataMode: 'actual',
      actualRoutes: gtfs.routes,
      actualStops: gtfs.stops,
      scheduledTrips: gtfs.scheduledTrips,
      serviceCalendars: gtfs.serviceCalendars,
    }
  );
  assert.equal(removedDayRes.journeys.length, 0);
  assert.equal(removedDayRes.errorCode, 'NO_SERVICE_ON_DATE');
});

// 6. Transfer wait times & walking links only when valid close coordinates exist
runTest('6. Walking transfers connect close stops with valid coords and never invent unmapped coords', () => {
  const gtfs = processGTFSFileContents(MULTI_TRANSFER_GTFS);
  const unmappedStop = gtfs.stops.find((s) => s.stop_id === 'S_NO_COORD')!;
  assert.equal(unmappedStop.hasValidCoordinates, false);

  // Add a weekday service on R4 so S_A -> S_B (08:15) -> walk 180m -> S_B_WALK -> S_E (08:22) can be tested
  const modifiedTrips = (gtfs.scheduledTrips ?? []).map((t) =>
    t.trip_id === 'T4_WKEND' ? { ...t, service_id: 'WKDAY' } : t
  );
  const graphRes = searchTimeDependentJourneys({
    sourceStopId: 'S_A',
    destinationStopId: 'S_E',
    date: '2026-10-14',
    time: '07:50',
    stops: gtfs.stops,
    routes: gtfs.routes,
    scheduledTrips: modifiedTrips,
    serviceCalendars: gtfs.serviceCalendars,
  });

  const walkOption = graphRes.paths.find((p) =>
    p.transfers.some((t) => t.isWalkingTransfer)
  );
  assert.ok(walkOption, 'Expected walking transfer option between S_B and S_B_WALK (~180m)');
  const walkStep = walkOption!.transfers.find((t) => t.isWalkingTransfer)!;
  assert.ok((walkStep.walkMeters ?? 0) > 100 && (walkStep.walkMeters ?? 0) <= 350);
  assert.ok(walkStep.waitMins >= (walkStep.walkMins ?? 0) + 3);

  // Verify stops without coordinates generate 0 walking links
  const noCoordStops: BusStop[] = [
    {
      stop_id: 'X1',
      stop_name: 'Stop X1',
      short_name: 'X1',
      lat: 0,
      lng: 0,
      zone: 'Z',
      is_major_hub: false,
      hasValidCoordinates: false,
    },
    {
      stop_id: 'X2',
      stop_name: 'Stop X2',
      short_name: 'X2',
      lat: 0,
      lng: 0,
      zone: 'Z',
      is_major_hub: false,
      hasValidCoordinates: false,
    },
  ];
  const noCoordSearch = searchTimeDependentJourneys({
    sourceStopId: 'X1',
    destinationStopId: 'X2',
    date: '2026-10-14',
    time: '08:00',
    stops: noCoordStops,
    routes: [],
  });
  assert.equal(noCoordSearch.graphStats.walkingLinksCount, 0);
});

// 7. Segment-wise crowding reflects passenger's travelled segments only (not whole-route average)
runTest('7. Segment-wise crowding strictly evaluates passenger travelled segments', () => {
  // Route 39 UP: DL_ANV -> DL_PRV -> DL_LXN -> DL_ITO -> DL_MDH -> DL_RJC -> DL_CP -> DL_KRB
  // Short sub-trip DL_ANV -> DL_PRV (1 segment) vs DL_ANV -> DL_CP (6 segments including congested ITO)
  const shortTrip = journeyService.searchJourneysDetailed({
    sourceStopId: 'DL_ANV',
    destinationStopId: 'DL_PRV',
    date: '2026-10-14',
    time: '18:00',
  });
  const longTrip = journeyService.searchJourneysDetailed({
    sourceStopId: 'DL_ANV',
    destinationStopId: 'DL_CP',
    date: '2026-10-14',
    time: '18:00',
  });

  const shortR39 = shortTrip.journeys.find((j) => j.legs[0].route_number === '39')!;
  const longR39 = longTrip.journeys.find((j) => j.legs[0].route_number === '39')!;

  assert.equal(shortR39.all_segments.length, 1);
  assert.equal(longR39.all_segments.length, 6);
  assert.notEqual(
    shortR39.peak_segment_occupancy_pct,
    longR39.peak_segment_occupancy_pct
  );
  assert.ok(longR39.peak_segment_occupancy_pct > shortR39.peak_segment_occupancy_pct);
});

// 8, 9, 10. Fastest, Comfort, and Configurable Balanced Weights (0.6/0.4 vs custom)
runTest('8-10. Fastest, Comfort, and Configurable Balanced weights rank candidates properly', () => {
  const res = journeyService.searchJourneysDetailed({
    sourceStopId: 'DL_ANV',
    destinationStopId: 'DL_CP',
    date: '2026-10-14',
    time: '18:00',
  });
  const journeys = res.journeys;

  const fastest = journeys.find((j) => j.recommendation_tags.includes('fastest'))!;
  const comfort = journeys.find((j) => j.recommendation_tags.includes('least-crowded'))!;
  const balanced = journeys.find((j) => j.recommendation_tags.includes('balanced'))!;

  assert.ok(fastest && comfort && balanced);
  assert.ok(
    fastest.total_duration_mins <= comfort.total_duration_mins,
    'Fastest should have duration <= comfort route'
  );
  assert.ok(
    comfort.peak_segment_occupancy_pct <= fastest.peak_segment_occupancy_pct,
    'Comfort should have <= peak occupancy than fastest route'
  );

  // Verify configurable Balanced weights shift score sensitivity
  const timeHeavy = scoreAndRankJourneys(journeys, { timeWeight: 0.95, crowdingWeight: 0.05 });
  const crowdHeavy = scoreAndRankJourneys(journeys, { timeWeight: 0.05, crowdingWeight: 0.95 });

  const bestTimeHeavy = [...timeHeavy].sort((a, b) => a.balanced_score - b.balanced_score)[0];
  const bestCrowdHeavy = [...crowdHeavy].sort((a, b) => a.balanced_score - b.balanced_score)[0];

  assert.equal(bestTimeHeavy.total_duration_mins, fastest.total_duration_mins);
  assert.ok(bestCrowdHeavy.comfort_score <= bestTimeHeavy.comfort_score);
});

// 11. Missing crowding prediction handling (Insufficient historical data)
runTest('11. Unobserved GTFS segments report Insufficient historical data without fabricating crowd level', () => {
  const gtfs = processGTFSFileContents(MULTI_TRANSFER_GTFS);
  // Empty ETM CSV -> actual mode with 0 historical records
  const emptyActual = processEtmCsvText(
    'created_at,vehicle_number,route,start_stop_name,end_stop_name,passenger_count,amount,ticket_type_id,is_ac\n',
    {
      datasetId: 'empty_etm',
      sourceName: 'empty.csv',
      sourceOrigin: 'upload',
      processingEngine: 'node-streaming',
      gtfsData: gtfs,
    }
  );
  crowdingService.setUploadedTrainingRecords(
    emptyActual.historicalSegmentRecords,
    emptyActual.aggregatedObservations,
    gtfs.stops
  );

  const res = journeyService.searchJourneysDetailed(
    {
      sourceStopId: 'S_A',
      destinationStopId: 'S_B',
      date: '2026-10-14',
      time: '07:50',
    },
    DEFAULT_CAPACITY_CONFIG,
    'baseline-median',
    {
      dataMode: 'actual',
      actualRoutes: gtfs.routes,
      actualStops: gtfs.stops,
      scheduledTrips: gtfs.scheduledTrips,
      serviceCalendars: gtfs.serviceCalendars,
    }
  );

  assert.equal(res.journeys.length, 1);
  const j: JourneyOption = res.journeys[0];
  assert.equal(j.has_missing_predictions, true);
  assert.equal(j.overall_confidence, 'Low');
  assert.equal(j.all_segments[0].has_historical_data, false);
  assert.ok(j.recommendation_reason.toLowerCase().includes('insufficient historical'));
  assert.ok(j.low_confidence_warning?.includes('Insufficient historical data'));

  // Clean up crowdingService uploaded state
  crowdingService.setUploadedTrainingRecords(null);
});

console.log('\nALL 11 INTELLIGENT JOURNEY PLANNER TESTS PASSED.');
