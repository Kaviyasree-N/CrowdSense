import type { AnalyticsFilterState, BusiestSegmentRow } from '../services/dataService';
import type {
  ActualDatasetResult,
  CriticalHotspotRow,
  DataReliabilitySummary,
} from '../types/transit';

/**
 * Escapes CSV cell values and neutralizes spreadsheet formula injection (=, +, -, @, tab, CR).
 */
export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvString(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][]
): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const bodyLines = rows.map((r) => r.map(escapeCsvCell).join(','));
  return [headerLine, ...bodyLines].join('\n');
}

export function downloadCsvFile(filename: string, csvContent: string): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filterContextTag(filters: AnalyticsFilterState, dataModeLabel: string): string {
  return `${dataModeLabel} | ${filters.dateStart} to ${filters.dateEnd} | Route: ${filters.routeNumber} | Day: ${filters.dayType} | Period: ${filters.timePeriod} | Dir: ${filters.direction}`;
}

export function generateRouteDemandCsv(
  routeDemand: {
    route: string;
    routeNumber: string;
    avgLoad: number;
    avgOccupancyPct: number;
    tickets?: number;
    passengers?: number;
  }[],
  filters: AnalyticsFilterState,
  dataModeLabel: string
): string {
  const ctx = filterContextTag(filters, dataModeLabel);
  return buildCsvString(
    [
      'data_context',
      'route_number',
      'route_label',
      'recorded_tickets',
      'recorded_passengers',
      'avg_estimated_segment_load',
      'avg_estimated_occupancy_pct',
    ],
    routeDemand.map((r) => [
      ctx,
      r.routeNumber,
      r.route,
      r.tickets ?? '',
      r.passengers ?? '',
      r.avgLoad,
      r.avgOccupancyPct,
    ])
  );
}

export function generateSegmentCrowdingCsv(
  segments: BusiestSegmentRow[],
  filters: AnalyticsFilterState,
  dataModeLabel: string
): string {
  const ctx = filterContextTag(filters, dataModeLabel);
  return buildCsvString(
    [
      'data_context',
      'route_number',
      'direction',
      'from_stop',
      'to_stop',
      'time_period',
      'estimated_passenger_load',
      'assumed_capacity',
      'occupancy_pct',
      'crowding_category',
      'observations_count',
      'confidence',
    ],
    segments.map((s) => [
      ctx,
      s.routeNumber,
      s.direction,
      s.fromStop,
      s.toStop,
      s.timePeriod,
      s.estimatedLoad,
      s.assumedCapacity,
      s.occupancyPct,
      s.crowdingLevel,
      s.observationsCount ?? '',
      s.confidence,
    ])
  );
}

export function generateHourlyDemandCsv(
  hourlyDemand: {
    hour: string;
    hourNum: number;
    avgLoad: number;
    weekdayAvg: number;
    weekendAvg: number;
    tickets?: number;
    passengers?: number;
  }[],
  filters: AnalyticsFilterState,
  dataModeLabel: string
): string {
  const ctx = filterContextTag(filters, dataModeLabel);
  return buildCsvString(
    [
      'data_context',
      'hour_ist',
      'recorded_tickets',
      'recorded_passengers',
      'avg_segment_load_all',
      'weekday_avg_load',
      'weekend_avg_load',
    ],
    hourlyDemand.map((h) => [
      ctx,
      h.hour,
      h.tickets ?? '',
      h.passengers ?? '',
      h.avgLoad,
      h.weekdayAvg,
      h.weekendAvg,
    ])
  );
}

export function generateHotspotReportCsv(
  hotspots: CriticalHotspotRow[],
  filters: AnalyticsFilterState,
  dataModeLabel: string
): string {
  const ctx = filterContextTag(filters, dataModeLabel);
  return buildCsvString(
    [
      'data_context',
      'route_number',
      'direction',
      'from_stop',
      'to_stop',
      'peak_hour_ist',
      'estimated_load',
      'assumed_capacity',
      'occupancy_pct',
      'crowding_category',
      'observations_count',
      'weekly_consistency_pct',
      'recurring_overload',
      'confidence',
    ],
    hotspots.map((h) => [
      ctx,
      h.routeNumber,
      h.direction,
      h.fromStop,
      h.toStop,
      `${String(h.peakHour).padStart(2, '0')}:00`,
      h.estimatedLoad,
      h.assumedCapacity,
      h.occupancyPct,
      h.crowdingLevel,
      h.observationsCount,
      h.weeklyConsistencyPct,
      h.isRecurring ? 'YES' : 'LOW_SAMPLE',
      h.confidence,
    ])
  );
}

export function generateDataQualityCsv(
  reliability: DataReliabilitySummary,
  actualDataset: ActualDatasetResult | null,
  filters: AnalyticsFilterState,
  dataModeLabel: string
): string {
  const ctx = filterContextTag(filters, dataModeLabel);
  const rows: (string | number | boolean | null | undefined)[][] = [
    [ctx, 'dataset_coverage', reliability.datasetCoverageLabel, reliability.dateRangeLabel],
    [ctx, 'total_raw_records', reliability.totalRecords, 'All parsed input ETM lines'],
    [ctx, 'valid_ticket_records', reliability.validRecords, 'Cleaned & IST-normalized records'],
    [ctx, 'invalid_or_duplicate_records', reliability.invalidAndDuplicateCount, 'Removed during cleaning'],
    [ctx, 'stop_matching_pct', `${reliability.stopMatchingPct}%`, `${reliability.matchedStopsCount}/${reliability.totalUniqueStopsCount} ticket stops matched to GTFS`],
    [ctx, 'unmatched_stops_count', reliability.unmatchedStopsCount, reliability.unmatchedStopsSample.slice(0, 8).join('; ')],
    [ctx, 'identified_trips', reliability.identifiedTrips, 'Reconstructed vehicle-route trips'],
    [ctx, 'ambiguous_trip_groupings', reliability.ambiguousTrips, 'Flagged overlapping/uncertain trip blocks'],
    [ctx, 'prediction_coverage_pct', `${reliability.predictionCoveragePct}%`, `${reliability.segmentsWithPredictions}/${reliability.totalSegmentsCataloged} cataloged segments covered`],
    [ctx, 'low_confidence_predictions', reliability.lowConfidencePredictionsCount, `${reliability.lowConfidenceSharePct}% of evaluated segment slots`],
  ];

  if (actualDataset) {
    Object.entries(actualDataset.missingFieldCounts).forEach(([field, count]) => {
      rows.push([ctx, `missing_field_${field}`, count, 'Missing cell occurrences in ETM CSV']);
    });
  }

  return buildCsvString(['data_context', 'metric_name', 'metric_value', 'notes'], rows);
}
