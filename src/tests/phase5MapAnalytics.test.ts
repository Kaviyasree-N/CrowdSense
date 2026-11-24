import assert from 'node:assert/strict';
import { SAMPLE_ROUTES } from '../data/sampleRoutes.ts';
import { STOP_MAP } from '../data/sampleStops.ts';
import { processEtmCsvText } from '../engine/etmPipeline.ts';
import { processGTFSFileContents } from '../engine/gtfsProcessor.ts';
import { hasRealCoordinates } from '../engine/journeyGraph.ts';
import { crowdingService } from '../services/crowdingService.ts';
import { dataService } from '../services/dataService.ts';
import { journeyService } from '../services/journeyService.ts';
import {
  buildMapNetworkSegments,
  deriveDayTypeFromDate,
  getCrowdingCategoryColorHex,
} from '../services/mapService.ts';
import type { SegmentObservation } from '../types/transit.ts';
import { computeCriticalHotspots, paginateSegmentObservations } from '../utils/analyticsEngine.ts';
import { DEFAULT_CAPACITY_CONFIG } from '../utils/crowdClassification.ts';
import {
  escapeCsvCell,
  generateDataQualityCsv,
  generateHotspotReportCsv,
  generateHourlyDemandCsv,
  generateRouteDemandCsv,
  generateSegmentCrowdingCsv,
} from '../utils/csvExport.ts';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

const SAMPLE_GTFS_FILES = {
  'stops.txt': [
    'stop_id,stop_name,stop_lat,stop_lon,zone_id',
    'ST_1,Kashmere Gate ISBT,28.6675,77.2282,North',
    'ST_2,ITO Crossing,28.6289,77.2414,Central',
    'ST_3,Connaught Place,28.6315,77.2167,Central',
    'ST_MISSING,Missing Coords Stop,,,West',
  ].join('\n'),
  'routes.txt': [
    'route_id,route_short_name,route_long_name',
    'RT_10,10A,Kashmere Gate to Connaught Place',
    'RT_20,20B,Circular Unobserved Route',
  ].join('\n'),
  'trips.txt': [
    'route_id,service_id,trip_id,direction_id,trip_headsign',
    'RT_10,WK,TR_10_1,0,To Connaught Place',
    'RT_20,WK,TR_20_1,0,To Missing Stop',
  ].join('\n'),
  'stop_times.txt': [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    'TR_10_1,08:00:00,08:00:00,ST_1,1',
    'TR_10_1,08:12:00,08:12:00,ST_2,2',
    'TR_10_1,08:25:00,08:25:00,ST_3,3',
    'TR_20_1,09:00:00,09:00:00,ST_2,1',
    'TR_20_1,09:15:00,09:15:00,ST_MISSING,2',
  ].join('\n'),
  'calendar.txt': [
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    'WK,1,1,1,1,1,1,1,20261001,20261031',
  ].join('\n'),
};

runTest('1. Crowding map segment generation uses real GTFS coordinates and never invents missing coords', () => {
  const gtfs = processGTFSFileContents(SAMPLE_GTFS_FILES);
  const stopLookup = Object.fromEntries(gtfs.stops.map((s) => [s.stop_id, s]));

  assert.equal(hasRealCoordinates(stopLookup['ST_1']), true);
  assert.equal(stopLookup['ST_1'].lat, 28.6675);
  assert.equal(stopLookup['ST_1'].lng, 77.2282);
  assert.equal(hasRealCoordinates(stopLookup['ST_MISSING']), false);

  crowdingService.setUploadedTrainingRecords([], [], gtfs.stops);
  const segments = buildMapNetworkSegments({
    routes: gtfs.routes,
    stopLookup,
    selectedHour: 8,
    dayType: 'weekday',
    routeFilter: 'ALL',
    directionFilter: 'ALL',
    crowdingFilter: 'ALL',
    capacityConfig: DEFAULT_CAPACITY_CONFIG,
    preferredModel: 'baseline-median',
    dataMode: 'actual',
  });

  assert.ok(segments.length >= 3);
  const seg10 = segments.find((s) => s.routeNumber === '10A');
  assert.ok(seg10);
  assert.equal(seg10.fromStop.lat, 28.6675);
  // With empty ETM observations in actual mode, all segments mark Insufficient Data
  assert.equal(seg10.hasHistoricalData, false);
  assert.equal(
    getCrowdingCategoryColorHex(seg10.crowdingLevel, seg10.hasHistoricalData),
    '#94A3B8'
  );
  crowdingService.setUploadedTrainingRecords(null);
});

runTest('2. Map crowding color classification covers Green, Yellow, Orange, Red, and Grey Insufficient Data', () => {
  assert.equal(getCrowdingCategoryColorHex('Seats Available', true), '#16A34A');
  assert.equal(getCrowdingCategoryColorHex('Standing Room', true), '#EAB308');
  assert.equal(getCrowdingCategoryColorHex('Crowded', true), '#EA580C');
  assert.equal(getCrowdingCategoryColorHex('Very Crowded', true), '#DC2626');
  assert.equal(getCrowdingCategoryColorHex('Very Crowded', false), '#94A3B8');
});

runTest('3. Map filtering by date, hour, route, direction, and crowding category updates segments accurately', () => {
  assert.equal(deriveDayTypeFromDate('2026-10-14').dayType, 'weekday');
  assert.equal(deriveDayTypeFromDate('2026-10-17').dayType, 'weekend');
  assert.equal(deriveDayTypeFromDate('2026-10-18').dayType, 'weekend');

  const allEvening = buildMapNetworkSegments({
    routes: SAMPLE_ROUTES,
    stopLookup: STOP_MAP,
    selectedHour: 18,
    dayType: 'weekday',
    routeFilter: 'ALL',
    directionFilter: 'ALL',
    crowdingFilter: 'ALL',
    capacityConfig: DEFAULT_CAPACITY_CONFIG,
    preferredModel: 'baseline-median',
    dataMode: 'demo',
  });
  assert.ok(allEvening.length > 10);

  const onlyRoute39Up = buildMapNetworkSegments({
    routes: SAMPLE_ROUTES,
    stopLookup: STOP_MAP,
    selectedHour: 18,
    dayType: 'weekday',
    routeFilter: '39',
    directionFilter: 'UP',
    crowdingFilter: 'ALL',
    capacityConfig: DEFAULT_CAPACITY_CONFIG,
    preferredModel: 'baseline-median',
    dataMode: 'demo',
  });
  assert.ok(onlyRoute39Up.length > 0);
  assert.ok(onlyRoute39Up.every((s) => s.routeNumber === '39' && s.direction === 'UP'));

  const onlyVeryCrowded = buildMapNetworkSegments({
    routes: SAMPLE_ROUTES,
    stopLookup: STOP_MAP,
    selectedHour: 18,
    dayType: 'weekday',
    routeFilter: '39',
    directionFilter: 'UP',
    crowdingFilter: 'Very Crowded',
    capacityConfig: DEFAULT_CAPACITY_CONFIG,
    preferredModel: 'baseline-median',
    dataMode: 'demo',
  });
  assert.ok(onlyVeryCrowded.length > 0);
  assert.ok(onlyVeryCrowded.every((s) => s.crowdingLevel === 'Very Crowded'));
  assert.ok(onlyVeryCrowded[0].predictionExplanation !== undefined);
  assert.ok(onlyVeryCrowded[0].observationsCount > 0);
});

runTest('4. Commuter journey details produce clickable segments with prediction explanations', () => {
  crowdingService.setUploadedTrainingRecords(null);
  const result = journeyService.searchJourneysDetailed(
    {
      sourceStopId: 'DL_ANV',
      destinationStopId: 'DL_CP',
      date: '2026-10-14',
      time: '18:00',
    },
    DEFAULT_CAPACITY_CONFIG,
    'baseline-median',
    { dataMode: 'demo' }
  );

  assert.ok(result.journeys.length > 0);
  const first = result.journeys[0];
  assert.ok(first.all_segments.length > 0);
  first.all_segments.forEach((seg) => {
    assert.ok(seg.prediction_explanation);
    assert.ok(seg.prediction_explanation.calculationMethod.length > 0);
    assert.ok(hasRealCoordinates(seg.from_stop) && hasRealCoordinates(seg.to_stop));
  });
});

runTest('5. Analytics dashboard computes all 8 KPIs and 7 charts including Weekly Consistency in Demo Mode', () => {
  const fullSummary = dataService.getAnalyticsSummary(
    {
      dateStart: '2026-10-01',
      dateEnd: '2026-10-31',
      routeNumber: 'ALL',
      dayType: 'all',
      timePeriod: 'all',
      direction: 'all',
    },
    DEFAULT_CAPACITY_CONFIG
  );

  assert.ok(fullSummary.kpis.totalTicketsAnalyzed > 0);
  assert.ok(fullSummary.kpis.totalRecordedPassengers > 0);
  assert.ok(fullSummary.kpis.routeCount >= 5);
  assert.ok(fullSummary.kpis.uniqueVehicles > 0);
  assert.ok(fullSummary.kpis.identifiedSegmentsCount > 0);
  assert.ok(fullSummary.kpis.mostCrowdedRoute.startsWith('Route '));
  assert.ok(fullSummary.kpis.peakTravelHour.includes(':00'));
  assert.ok(fullSummary.kpis.overloadedSegmentsPct >= 0 && fullSummary.kpis.overloadedSegmentsPct <= 100);

  // All 7 charts populated
  assert.equal(fullSummary.hourlyDemand.length, 19);
  assert.equal(fullSummary.dailyTrends.length, 31);
  assert.ok(fullSummary.routeDemand.length >= 5);
  assert.ok(fullSummary.segmentWiseLoad.length > 0);
  assert.equal(fullSummary.crowdingDistribution.length, 4);
  const pctSum = fullSummary.crowdingDistribution.reduce((s, d) => s + d.pct, 0);
  assert.ok(pctSum >= 98 && pctSum <= 102);
  assert.ok(fullSummary.weeklyConsistency.length >= 4);

  // Filtered query reduces metrics strictly
  const filteredSummary = dataService.getAnalyticsSummary(
    {
      dateStart: '2026-10-01',
      dateEnd: '2026-10-10',
      routeNumber: '39',
      dayType: 'weekday',
      timePeriod: 'evening',
      direction: 'UP',
    },
    DEFAULT_CAPACITY_CONFIG
  );
  assert.ok(filteredSummary.kpis.totalTicketsAnalyzed < fullSummary.kpis.totalTicketsAnalyzed);
  assert.equal(filteredSummary.kpis.routeCount, 1);
  assert.ok(filteredSummary.dailyTrends.every((d) => d.dayType === 'weekday'));
});

runTest('6. Actual ETM + GTFS analytics computes weekly consistency, 8 KPIs, and reliability indicators', () => {
  const gtfs = processGTFSFileContents(SAMPLE_GTFS_FILES);
  const csvRows = [
    'created_at,vehicle_number,route,start_stop_name,end_stop_name,passenger_count,amount,ticket_type_id,is_ac',
    '2026-10-02 08:02:00,DL1PC1001,10A,Kashmere Gate ISBT,Connaught Place,4,80,1,true',
    '2026-10-02 08:05:00,DL1PC1001,10A,ITO Crossing,Connaught Place,3,60,1,true',
    '2026-10-09 08:03:00,DL1PC1002,10A,Kashmere Gate ISBT,Connaught Place,5,100,1,true',
    '2026-10-16 08:04:00,DL1PC1003,10A,Kashmere Gate ISBT,ITO Crossing,2,40,1,true',
    '2026-10-17 14:10:00,DL1PC1004,10A,Kashmere Gate ISBT,Unknown Stop X,2,40,1,true',
  ].join('\n');

  const actual = processEtmCsvText(csvRows, {
    datasetId: 'test_phase5',
    sourceName: 'test_phase5.csv',
    sourceOrigin: 'upload',
    processingEngine: 'node-streaming',
    gtfsData: gtfs,
  });

  assert.ok(actual.weeklyDistribution && actual.weeklyDistribution.length === 3);
  assert.equal(actual.weeklyDistribution![0].weekNumber, 1);
  assert.equal(actual.weeklyDistribution![1].weekNumber, 2);
  assert.equal(actual.weeklyDistribution![2].weekNumber, 3);

  const actualSummary = dataService.getActualAnalyticsSummary(
    actual,
    {
      dateStart: '2026-10-01',
      dateEnd: '2026-10-31',
      routeNumber: 'ALL',
      dayType: 'all',
      timePeriod: 'all',
      direction: 'all',
    },
    DEFAULT_CAPACITY_CONFIG
  );

  assert.equal(actualSummary.kpis.totalTicketsAnalyzed, 5);
  assert.equal(actualSummary.kpis.totalRecordedPassengers, 16);
  assert.equal(actualSummary.kpis.uniqueVehicles, 4);
  assert.ok(actualSummary.reliabilityIndicators.unmatchedStopsCount >= 1);
  assert.ok(actualSummary.planningInsights.length >= 4);
  assert.ok(actualSummary.reliabilityIndicators.recordedDemandNote.includes('passenger_count'));
  assert.ok(actualSummary.reliabilityIndicators.estimatedOccupancyNote.includes('Load[s]'));
});

runTest('7. Critical Crowding Hotspots prioritize recurring overload over single isolated spikes', () => {
  const capLookup = new Map<string, number>([
    ['R_SPIKE', 50],
    ['R_RECUR', 50],
  ]);

  const obs: SegmentObservation[] = [
    {
      route_id: 'R_SPIKE',
      route_number: '999',
      direction: 'UP',
      from_stop_id: 'S1',
      to_stop_id: 'S2',
      from_stop_name: 'One-Off Stop A',
      to_stop_name: 'One-Off Stop B',
      segment_order: 1,
      hour: 18,
      day_type: 'weekday',
      median_load: 75, // 150% occupancy, but only 1 observation!
      p75_load: 75,
      boardings_avg: 20,
      alightings_avg: 5,
      observations_count: 1,
      weekly_cv: 0.45,
      unmatched_stop_rate: 0.05,
      trip_grouping_reliability: 0.85,
      is_simulated: false,
    },
    {
      route_id: 'R_RECUR',
      route_number: '39',
      direction: 'UP',
      from_stop_id: 'S3',
      to_stop_id: 'S4',
      from_stop_name: 'Laxmi Nagar',
      to_stop_name: 'ITO Crossing',
      segment_order: 3,
      hour: 18,
      day_type: 'weekday',
      median_load: 64, // 128% occupancy across 35 observations!
      p75_load: 70,
      boardings_avg: 18,
      alightings_avg: 8,
      observations_count: 35,
      weekly_cv: 0.09,
      unmatched_stop_rate: 0.02,
      trip_grouping_reliability: 0.94,
      is_simulated: false,
    },
  ];

  const hotspots = computeCriticalHotspots(obs, capLookup, DEFAULT_CAPACITY_CONFIG);
  assert.equal(hotspots.length, 2);
  assert.equal(hotspots[0].routeNumber, '39');
  assert.equal(hotspots[0].isRecurring, true);
  assert.equal(hotspots[1].routeNumber, '999');
  assert.equal(hotspots[1].isRecurring, false);
});

runTest('8. CSV export generators reflect active filters and neutralize formula injection', () => {
  assert.equal(escapeCsvCell('=CMD("calc")'), `"'=CMD(""calc"")"`);
  assert.equal(escapeCsvCell('+SUM(A1:A2)'), `'+SUM(A1:A2)`);

  const filters = {
    dateStart: '2026-10-10',
    dateEnd: '2026-10-20',
    routeNumber: '39',
    dayType: 'weekday' as const,
    timePeriod: 'evening' as const,
    direction: 'UP' as const,
  };
  const summary = dataService.getAnalyticsSummary(filters, DEFAULT_CAPACITY_CONFIG);

  const routeCsv = generateRouteDemandCsv(summary.routeDemand, filters, 'DEMO');
  const segCsv = generateSegmentCrowdingCsv(summary.allFilteredSegments, filters, 'DEMO');
  const hourCsv = generateHourlyDemandCsv(summary.hourlyDemand, filters, 'DEMO');
  const hotspotCsv = generateHotspotReportCsv(summary.criticalHotspots, filters, 'DEMO');
  const qualityCsv = generateDataQualityCsv(
    summary.reliabilityIndicators,
    null,
    filters,
    'DEMO'
  );

  assert.ok(routeCsv.includes('Route: 39'));
  assert.ok(segCsv.includes('estimated_passenger_load'));
  assert.ok(hourCsv.includes('hour_ist'));
  assert.ok(hotspotCsv.includes('recurring_overload'));
  assert.ok(qualityCsv.includes('stop_matching_pct'));
});

runTest('9. Paginated segment queries bound row slices and filter by crowding category', () => {
  const page1 = dataService.paginateDemoSegments(
    {
      dateStart: '2026-10-01',
      dateEnd: '2026-10-31',
      routeNumber: 'ALL',
      dayType: 'all',
      timePeriod: 'all',
      direction: 'all',
    },
    DEFAULT_CAPACITY_CONFIG,
    1,
    10,
    'Very Crowded'
  );
  assert.ok(page1.items.length <= 10);
  assert.ok(page1.items.every((r) => r.crowdingLevel === 'Very Crowded'));
  assert.equal(page1.page, 1);

  const emptyPaginated = paginateSegmentObservations([], new Map(), DEFAULT_CAPACITY_CONFIG, 1, 10, 'ALL');
  assert.equal(emptyPaginated.items.length, 0);
  assert.equal(emptyPaginated.totalPages, 1);
});
