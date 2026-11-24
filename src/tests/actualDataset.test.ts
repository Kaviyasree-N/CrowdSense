import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { normalizeToAsiaKolkata, processEtmCsvText } from '../engine/etmPipeline.ts';
import { processGTFSFileContents } from '../engine/gtfsProcessor.ts';
import { crowdingService } from '../services/crowdingService.ts';
import { journeyService } from '../services/journeyService.ts';
import { dataService } from '../services/dataService.ts';

function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(
    () => console.log(`PASS: ${name}`),
    (err) => {
      console.error(`FAIL: ${name}`);
      throw err;
    }
  );
}

const SAMPLE_GTFS_FILES = {
  'stops.txt': [
    'stop_id,stop_name,stop_lat,stop_lon,zone_id',
    'G_S1,Anand Vihar ISBT,28.6469,77.3160,East',
    'G_S2,Preet Vihar Metro,28.6416,77.2952,East',
    'G_S3,ITO Crossing,28.6285,77.2414,Central',
    'G_S4,Connaught Place,28.6315,77.2167,Central',
    'G_S5,Karol Bagh Terminal,28.6512,77.1905,Central',
    'G_S6,Karol Bagh Metro,28.6440,77.1885,Central',
  ].join('\n'),
  'routes.txt': [
    'route_id,route_short_name,route_long_name',
    'R39,39,Anand Vihar to Connaught Place',
  ].join('\n'),
  'trips.txt': [
    'route_id,service_id,trip_id,direction_id,trip_headsign',
    'R39,WD,T39_UP,0,Towards Connaught Place',
    'R39,WD,T39_DN,1,Towards Anand Vihar',
  ].join('\n'),
  'stop_times.txt': [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    'T39_UP,08:00:00,08:00:00,G_S1,1',
    'T39_UP,08:12:00,08:12:00,G_S2,2',
    'T39_UP,08:28:00,08:28:00,G_S3,3',
    'T39_UP,08:40:00,08:40:00,G_S4,4',
    'T39_DN,09:00:00,09:00:00,G_S4,1',
    'T39_DN,09:14:00,09:14:00,G_S3,2',
    'T39_DN,09:30:00,09:30:00,G_S2,3',
    'T39_DN,09:42:00,09:42:00,G_S1,4',
  ].join('\n'),
  'calendar.txt': [
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    'WD,1,1,1,1,1,0,0,20261001,20261031',
  ].join('\n'),
  'calendar_dates.txt': [
    'service_id,date,exception_type',
    'WD,20261002,2',
  ].join('\n'),
};

const SAMPLE_ACTUAL_CSV = [
  'created_at,vehicle_number,route,start_stop_name,end_stop_name,passenger_count,amount,ticket_type_id,is_ac',
  // UTC timestamp 2026-10-14T12:30:00Z -> 18:00:00 IST
  '2026-10-14T12:30:00Z,DL1PB0001,39,Anand Vihar ISBT,ITO Crossing,3,45,1,false',
  // Exact duplicate of row 1 (same IST time)
  '2026-10-14 18:00:00,DL1PB0001,39,Anand Vihar ISBT,ITO Crossing,3,45,1,false',
  // Valid multi-passenger ticket
  '2026-10-14 18:08:00,DL1PB0001,39,Preet Vihar Metro,Connaught Place,2,30,1,false',
  // Weekend trip
  '2026-10-17 10:15:00,DL1PB0002,39,Anand Vihar ISBT,Connaught Place,4,80,2,true',
  // Unmatched stop test
  '2026-10-17 10:20:00,DL1PB0002,39,Unknown Outer Gate,Connaught Place,1,15,1,true',
  // Invalid record: passenger_count = 0
  '2026-10-17 10:22:00,DL1PB0002,39,Anand Vihar ISBT,ITO Crossing,0,15,1,true',
  // Invalid record: same start & end stop
  '2026-10-17 10:25:00,DL1PB0002,39,ITO Crossing,ITO Crossing,1,10,1,true',
].join('\n');

async function main() {
  await runTest('1. Asia/Kolkata timestamp normalization handles UTC Z and naive IST', () => {
    const fromUtc = normalizeToAsiaKolkata('2026-10-14T12:30:00Z');
    assert.ok(fromUtc);
    assert.equal(fromUtc.isoIst, '2026-10-14 18:00:00');
    assert.equal(fromUtc.hour, 18);
    assert.equal(fromUtc.dayType, 'weekday');

    const weekend = normalizeToAsiaKolkata('2026-10-17 10:15:00');
    assert.ok(weekend);
    assert.equal(weekend.dayType, 'weekend');
  });

  await runTest('2. Static GTFS processor parses routes, trips, directions, stops, and calendar', () => {
    const gtfs = processGTFSFileContents(SAMPLE_GTFS_FILES);
    assert.equal(gtfs.summary.filesDetected.length, 6);
    assert.equal(gtfs.stops.length, 6);
    assert.equal(gtfs.routes.length, 2); // UP and DOWN
    assert.equal(gtfs.routes[0].stops.length, 4);
    assert.equal(gtfs.serviceDaysSummary.weekdayServices, 1);
    assert.equal(gtfs.serviceDaysSummary.calendarExceptions, 1);
  });

  await runTest('3. ZIP archive extraction + 10-stage ETM pipeline + Stop-Matching Report', async () => {
    const zip = new JSZip();
    zip.file('October-Sample.csv', SAMPLE_ACTUAL_CSV);
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const loadedZip = await JSZip.loadAsync(zipBytes);
    const extractedCsv = await loadedZip.file('October-Sample.csv')!.async('string');

    const gtfs = processGTFSFileContents(SAMPLE_GTFS_FILES);
    const result = processEtmCsvText(extractedCsv, {
      datasetId: 'test_zip',
      sourceName: 'October-Sample.zip',
      sourceOrigin: 'upload',
      processingEngine: 'node-streaming',
      gtfsData: gtfs,
    });

    assert.equal(result.totalRecords, 7);
    assert.equal(result.duplicateRecords, 1);
    assert.equal(result.invalidRecords, 2);
    assert.equal(result.validRecords, 4); // 7 - 1 dup - 2 invalid
    assert.equal(result.totalPassengers, 3 + 2 + 4 + 1); // 10 passengers
    assert.equal(result.uniqueVehicles, 2);
    assert.equal(result.uniqueRoutes, 1);
    assert.equal(result.pipelineLogs.length, 10);
    assert.equal(result.stopMatchingReport.unmatchedCount >= 1, true);
    assert.equal(result.stopMatchingReport.matchedCount >= 4, true);
    assert.equal(result.weekdayVsWeekend.weekdayTickets, 2);
    assert.equal(result.weekdayVsWeekend.weekendTickets, 2);
    assert.equal(result.reconstructedTripsCount, 2);
    assert.ok(result.historicalSegmentRecords.length > 0);
  });

  await runTest('4. Missing required columns are flagged honestly', () => {
    const badCsv = 'created_at,vehicle_number,route\n2026-10-14 18:00:00,DL1PB0001,39';
    const result = processEtmCsvText(badCsv, {
      datasetId: 'bad_cols',
      sourceName: 'bad.csv',
      sourceOrigin: 'upload',
      processingEngine: 'browser-streaming',
      gtfsData: null,
    });
    assert.equal(result.status, 'failed');
    assert.ok(result.missingRequiredColumns.includes('passenger_count'));
    assert.ok(result.missingRequiredColumns.includes('start_stop_name'));
    assert.equal(result.validRecords, 0);
  });

  await runTest('5. Strict Demo vs Actual Data Mode isolation in crowding, journey, and analytics services', () => {
    const gtfs = processGTFSFileContents(SAMPLE_GTFS_FILES);
    const actual = processEtmCsvText(SAMPLE_ACTUAL_CSV, {
      datasetId: 'test_mode_iso',
      sourceName: 'actual_oct.csv',
      sourceOrigin: 'upload',
      processingEngine: 'node-streaming',
      gtfsData: gtfs,
    });

    crowdingService.setUploadedTrainingRecords(
      actual.historicalSegmentRecords,
      actual.aggregatedObservations,
      actual.activeStops
    );

    const actualJourneys = journeyService.searchJourneys(
      {
        sourceStopId: 'G_S1',
        destinationStopId: 'G_S4',
        date: '2026-10-14',
        time: '18:00',
      },
      undefined,
      'baseline-median',
      {
        dataMode: 'actual',
        actualRoutes: actual.activeRoutes,
        actualStops: actual.activeStops,
      }
    );

    assert.equal(actualJourneys.length, 1);
    assert.equal(actualJourneys[0].is_simulated, false);
    assert.equal(actualJourneys[0].source.stop_id, 'G_S1');

    // Demo mode must still work strictly on SAMPLE_ROUTES without using G_S1
    const demoJourneys = journeyService.searchJourneys(
      {
        sourceStopId: 'DL_ANV',
        destinationStopId: 'DL_CP',
        date: '2026-10-14',
        time: '18:00',
      },
      undefined,
      'baseline-median',
      { dataMode: 'demo' }
    );
    assert.ok(demoJourneys.length >= 2);
    assert.equal(demoJourneys[0].is_simulated, true);

    const analytics = dataService.getActualAnalyticsSummary(actual, {
      dateStart: '2026-10-01',
      dateEnd: '2026-10-31',
      routeNumber: 'ALL',
      dayType: 'all',
      timePeriod: 'all',
      direction: 'all',
    });
    assert.equal(analytics.kpis.totalTicketsAnalyzed, 4);
    assert.equal(analytics.kpis.estimatedJourneys, 10);
  });

  console.log('\nAll 5 actual dataset integration tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
