import Papa from 'papaparse';
import { DataQualityReport, ETMTicketRecord, GTFSUploadSummary } from '../types/transit';
import { SAMPLE_STOPS } from '../data/sampleStops';

export const REQUIRED_ETM_COLUMNS = [
  'created_at',
  'vehicle_number',
  'route',
  'start_stop_name',
  'end_stop_name',
  'passenger_count',
  'amount',
  'ticket_type_id',
  'is_ac',
] as const;

const KNOWN_STOP_NAMES = SAMPLE_STOPS.flatMap((s) => [
  s.stop_name.toLowerCase(),
  s.short_name.toLowerCase(),
]);

const MAX_BROWSER_ROWS = 25000;

export function parseAndValidateETMCsv(file: File): Promise<DataQualityReport> {
  return new Promise((resolve, reject) => {
    const missingFieldCounts: Record<string, number> = {};
    REQUIRED_ETM_COLUMNS.forEach((col) => {
      missingFieldCounts[col] = 0;
    });

    const routeAgg = new Map<string, { tickets: number; passengers: number }>();
    const hourAgg = new Map<number, { tickets: number; passengers: number }>();
    const unmatchedStopsSet = new Set<string>();
    const invalidReasonsSet = new Set<string>();
    const samplePreview: ETMTicketRecord[] = [];
    const parsedValidTickets: ETMTicketRecord[] = [];

    let totalRows = 0;
    let validRows = 0;
    let invalidRecordsCount = 0;
    let acCount = 0;
    let detectedColumns: string[] = [];
    let browserTruncated = false;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      worker: false,
      step: (results, parser) => {
        if (detectedColumns.length === 0 && results.meta.fields) {
          detectedColumns = results.meta.fields.map((f) => f.trim());
        }

        totalRows += 1;
        if (totalRows > MAX_BROWSER_ROWS) {
          browserTruncated = true;
          parser.abort();
          return;
        }

        const row = results.data;
        let rowHasMissing = false;
        let rowInvalid = false;

        REQUIRED_ETM_COLUMNS.forEach((col) => {
          const val = row[col];
          if (val === undefined || val === null || String(val).trim() === '') {
            missingFieldCounts[col] += 1;
            rowHasMissing = true;
          }
        });

        const paxRaw = Number(row['passenger_count']);
        const amtRaw = Number(row['amount']);
        const ticketTypeRaw = Number(row['ticket_type_id']);
        const isAcRaw = String(row['is_ac'] ?? '').trim().toLowerCase();
        const isAc = isAcRaw === 'true' || isAcRaw === '1' || isAcRaw === 'yes' || isAcRaw === 'ac';

        if (Number.isNaN(paxRaw) || paxRaw <= 0 || paxRaw > 25) {
          rowInvalid = true;
          invalidReasonsSet.add('Invalid passenger_count (<= 0, non-numeric, or > 25)');
        }
        if (Number.isNaN(amtRaw) || amtRaw < 0) {
          rowInvalid = true;
          invalidReasonsSet.add('Invalid fare amount (negative or non-numeric)');
        }

        const createdAtStr = String(row['created_at'] ?? '').trim();
        const parsedDate = new Date(createdAtStr.replace(' ', 'T'));
        if (!createdAtStr || Number.isNaN(parsedDate.getTime())) {
          rowInvalid = true;
          invalidReasonsSet.add('Unparseable created_at timestamp');
        }

        const routeStr = String(row['route'] ?? '').trim();
        const startStop = String(row['start_stop_name'] ?? '').trim();
        const endStop = String(row['end_stop_name'] ?? '').trim();

        if (startStop && endStop && startStop.toLowerCase() === endStop.toLowerCase()) {
          rowInvalid = true;
          invalidReasonsSet.add('start_stop_name matches end_stop_name');
        }

        if (rowHasMissing || rowInvalid) {
          invalidRecordsCount += 1;
        } else {
          validRows += 1;
          if (isAc) acCount += 1;

          const rEntry = routeAgg.get(routeStr) ?? { tickets: 0, passengers: 0 };
          rEntry.tickets += 1;
          rEntry.passengers += paxRaw;
          routeAgg.set(routeStr, rEntry);

          const hr = parsedDate.getHours();
          const hEntry = hourAgg.get(hr) ?? { tickets: 0, passengers: 0 };
          hEntry.tickets += 1;
          hEntry.passengers += paxRaw;
          hourAgg.set(hr, hEntry);

          if (
            unmatchedStopsSet.size < 12 &&
            startStop &&
            !KNOWN_STOP_NAMES.some(
              (known) => known.includes(startStop.toLowerCase()) || startStop.toLowerCase().includes(known)
            )
          ) {
            unmatchedStopsSet.add(startStop);
          }

          const parsedRecord: ETMTicketRecord = {
            created_at: createdAtStr,
            vehicle_number: String(row['vehicle_number'] ?? '').trim(),
            route: routeStr,
            start_stop_name: startStop,
            end_stop_name: endStop,
            passenger_count: paxRaw,
            amount: amtRaw,
            ticket_type_id: Number.isNaN(ticketTypeRaw) ? 1 : ticketTypeRaw,
            is_ac: isAc,
          };

          if (samplePreview.length < 10) {
            samplePreview.push(parsedRecord);
          }
          if (parsedValidTickets.length < 5000) {
            parsedValidTickets.push(parsedRecord);
          }
        }
      },
      complete: () => {
        const requiredColumnsPresent = REQUIRED_ETM_COLUMNS.filter((col) =>
          detectedColumns.includes(col)
        );
        const missingRequiredColumns = REQUIRED_ETM_COLUMNS.filter(
          (col) => !detectedColumns.includes(col)
        );

        const routeDistribution = Array.from(routeAgg.entries())
          .map(([route, stats]) => ({ route, ...stats }))
          .sort((a, b) => b.passengers - a.passengers)
          .slice(0, 12);

        const hourlyDistribution = Array.from({ length: 24 }, (_, hr) => {
          const entry = hourAgg.get(hr) ?? { tickets: 0, passengers: 0 };
          return {
            hour: `${String(hr).padStart(2, '0')}:00`,
            tickets: entry.tickets,
            passengers: entry.passengers,
          };
        });

        resolve({
          fileName: file.name,
          uploadedAt: new Date().toISOString(),
          totalRows: browserTruncated ? MAX_BROWSER_ROWS : totalRows,
          validRows,
          missingFieldCounts,
          invalidRecordsCount,
          invalidReasons: Array.from(invalidReasonsSet),
          requiredColumnsPresent: [...requiredColumnsPresent],
          missingRequiredColumns: [...missingRequiredColumns],
          routeDistribution,
          hourlyDistribution,
          acSharePct: validRows > 0 ? Math.round((acCount / validRows) * 100) : 0,
          unmatchedStopsSample: Array.from(unmatchedStopsSet),
          browserTruncated,
          totalFileBytes: file.size,
          samplePreview,
          parsedValidTickets,
        });
      },
      error: (err) => {
        reject(new Error(`CSV parsing failed: ${err.message}`));
      },
    });
  });
}

export async function validateGTFSFiles(files: FileList): Promise<GTFSUploadSummary> {
  const fileNames = Array.from(files).map((f) => f.name.toLowerCase());
  const expected = ['routes.txt', 'trips.txt', 'stops.txt', 'stop_times.txt', 'calendar.txt', 'calendar_dates.txt'];
  const filesDetected = expected.filter((name) => fileNames.some((f) => f.endsWith(name)));

  const countLines = async (target: string): Promise<number> => {
    const match = Array.from(files).find((f) => f.name.toLowerCase().endsWith(target));
    if (!match) return 0;
    const text = await match.slice(0, 1024 * 1024).text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return Math.max(0, lines.length - 1);
  };

  return {
    filesDetected,
    stopsCount: await countLines('stops.txt'),
    routesCount: await countLines('routes.txt'),
    tripsCount: await countLines('trips.txt'),
    stopTimesCount: await countLines('stop_times.txt'),
    calendarActive: filesDetected.includes('calendar.txt') || filesDetected.includes('calendar_dates.txt'),
    uploadedAt: new Date().toISOString(),
  };
}
