import type {
  CapacityConfig,
  CriticalHotspotRow,
  CrowdingLevel,
  DataReliabilitySummary,
  DayType,
  SegmentObservation,
  TransportPlanningInsight,
} from '../types/transit.ts';
import { classifyCrowding, DEFAULT_CAPACITY_CONFIG } from './crowdClassification.ts';
import { evaluateConfidence } from './passengerLoad.ts';

export interface AnalyticsFilterState {
  dateStart: string;
  dateEnd: string;
  routeNumber: string; // 'ALL' or route number
  dayType: 'all' | DayType;
  timePeriod: 'all' | 'morning' | 'midday' | 'evening' | 'night';
  direction: 'all' | 'UP' | 'DOWN';
}

export interface BusiestSegmentRow {
  routeNumber: string;
  direction: 'UP' | 'DOWN';
  fromStop: string;
  toStop: string;
  timePeriod: string;
  estimatedLoad: number;
  assumedCapacity: number;
  occupancyPct: number;
  crowdingLevel: CrowdingLevel;
  observationsCount: number;
  confidence: 'High' | 'Medium' | 'Low';
}

export interface PaginatedSegmentsResult {
  items: BusiestSegmentRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function matchesTimePeriod(
  hour: number,
  period: AnalyticsFilterState['timePeriod']
): boolean {
  switch (period) {
    case 'morning':
      return hour >= 6 && hour <= 10;
    case 'midday':
      return hour >= 11 && hour <= 15;
    case 'evening':
      return hour >= 16 && hour <= 20;
    case 'night':
      return hour >= 21 || hour <= 5;
    case 'all':
    default:
      return true;
  }
}

export function filterSegmentObservations(
  observations: SegmentObservation[],
  filters: Partial<AnalyticsFilterState>
): SegmentObservation[] {
  return observations.filter((obs) => {
    if (filters.routeNumber && filters.routeNumber !== 'ALL' && obs.route_number !== filters.routeNumber) {
      return false;
    }
    if (filters.dayType && filters.dayType !== 'all' && obs.day_type !== filters.dayType) {
      return false;
    }
    if (filters.direction && filters.direction !== 'all' && obs.direction !== filters.direction) {
      return false;
    }
    if (filters.timePeriod && !matchesTimePeriod(obs.hour, filters.timePeriod)) {
      return false;
    }
    return true;
  });
}

/**
 * Identifies Critical Crowding Hotspots while prioritizing recurring overload
 * across multiple trips/weeks over single isolated spikes.
 */
export function computeCriticalHotspots(
  observations: SegmentObservation[],
  routeCapacityLookup: Map<string, number>,
  capacityConfig: CapacityConfig = DEFAULT_CAPACITY_CONFIG
): CriticalHotspotRow[] {
  if (observations.length === 0) return [];

  const maxObsInDataset = observations.reduce(
    (max, o) => Math.max(max, o.observations_count),
    0
  );
  // Require at least 5 observations for recurring classification when rich history exists,
  // or >= 2 on smaller uploaded subsets so single-observation spikes never dominate.
  const recurringThreshold = maxObsInDataset >= 5 ? 5 : 2;

  const groupedByStretch = new Map<string, SegmentObservation[]>();
  observations.forEach((obs) => {
    const cap = routeCapacityLookup.get(obs.route_id) ?? capacityConfig.nonAcCapacity;
    const { level } = classifyCrowding(obs.median_load, cap, capacityConfig);
    if (level !== 'Crowded' && level !== 'Very Crowded') return;
    const key = `${obs.route_id}|${obs.from_stop_id}|${obs.to_stop_id}`;
    const list = groupedByStretch.get(key) ?? [];
    list.push(obs);
    groupedByStretch.set(key, list);
  });

  const rows: CriticalHotspotRow[] = [];
  groupedByStretch.forEach((group) => {
    const totalStretchObs = group.reduce((s, g) => s + g.observations_count, 0);
    // Pick peak hour for this stretch, breaking ties by observation depth
    const sortedHours = [...group].sort((a, b) => {
      if (b.median_load !== a.median_load) return b.median_load - a.median_load;
      return b.observations_count - a.observations_count;
    });
    const peak = sortedHours[0];
    const cap = routeCapacityLookup.get(peak.route_id) ?? capacityConfig.nonAcCapacity;
    const { occupancyPct, level } = classifyCrowding(peak.median_load, cap, capacityConfig);
    const conf = evaluateConfidence(peak);
    const isRecurring =
      peak.observations_count >= recurringThreshold || totalStretchObs >= recurringThreshold * 2;
    const weeklyConsistencyPct = Math.max(
      0,
      Math.min(100, Math.round((1 - peak.weekly_cv) * 100))
    );

    rows.push({
      routeId: peak.route_id,
      routeNumber: peak.route_number,
      direction: peak.direction,
      fromStop: peak.from_stop_name,
      toStop: peak.to_stop_name,
      peakHour: peak.hour,
      timePeriod: `${String(peak.hour).padStart(2, '0')}:00 (${peak.day_type})`,
      estimatedLoad: peak.median_load,
      assumedCapacity: cap,
      occupancyPct,
      crowdingLevel: level,
      observationsCount: totalStretchObs,
      weeklyConsistencyPct,
      isRecurring,
      confidence: conf.confidence,
    });
  });

  // Prioritize recurring hotspots strictly ahead of isolated low-sample spikes
  rows.sort((a, b) => {
    if (a.isRecurring !== b.isRecurring) return a.isRecurring ? -1 : 1;
    const scoreA = a.occupancyPct * (1 + Math.min(0.65, a.observationsCount / 80));
    const scoreB = b.occupancyPct * (1 + Math.min(0.65, b.observationsCount / 80));
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.observationsCount - a.observationsCount;
  });

  return rows;
}

export function paginateSegmentObservations(
  observations: SegmentObservation[],
  routeCapacityLookup: Map<string, number>,
  capacityConfig: CapacityConfig = DEFAULT_CAPACITY_CONFIG,
  page: number = 1,
  pageSize: number = 15,
  crowdingFilter: 'ALL' | CrowdingLevel = 'ALL'
): PaginatedSegmentsResult {
  const mapped: BusiestSegmentRow[] = [];

  observations.forEach((o) => {
    const cap = routeCapacityLookup.get(o.route_id) ?? capacityConfig.nonAcCapacity;
    const { occupancyPct, level } = classifyCrowding(o.median_load, cap, capacityConfig);
    if (crowdingFilter !== 'ALL' && level !== crowdingFilter) return;
    const conf = evaluateConfidence(o);
    mapped.push({
      routeNumber: o.route_number,
      direction: o.direction,
      fromStop: o.from_stop_name,
      toStop: o.to_stop_name,
      timePeriod: `${String(o.hour).padStart(2, '0')}:00 (${o.day_type})`,
      estimatedLoad: o.median_load,
      assumedCapacity: cap,
      occupancyPct,
      crowdingLevel: level,
      observationsCount: o.observations_count,
      confidence: conf.confidence,
    });
  });

  mapped.sort((a, b) => {
    if (b.occupancyPct !== a.occupancyPct) return b.occupancyPct - a.occupancyPct;
    return b.observationsCount - a.observationsCount;
  });

  const safePageSize = Math.max(1, Math.min(100, pageSize));
  const total = mapped.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.max(1, Math.min(totalPages, page));
  const start = (safePage - 1) * safePageSize;

  return {
    items: mapped.slice(start, start + safePageSize),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
  };
}

export function buildDeterministicPlanningInsights(params: {
  observations: SegmentObservation[];
  routeCapacityLookup: Map<string, number>;
  capacityConfig: CapacityConfig;
  hourlyDemand: { hour: string; hourNum: number; avgLoad: number; weekdayAvg: number; weekendAvg: number }[];
  hotspots: CriticalHotspotRow[];
  weekdayAvgDailyPassengers: number;
  weekendAvgDailyPassengers: number;
  reliability: DataReliabilitySummary;
}): TransportPlanningInsight[] {
  const insights: TransportPlanningInsight[] = [];
  const {
    observations,
    routeCapacityLookup,
    capacityConfig,
    hourlyDemand,
    hotspots,
    weekdayAvgDailyPassengers,
    weekendAvgDailyPassengers,
    reliability,
  } = params;

  // 1. High evening demand route(s) (16:00–20:00)
  const eveningObs = observations.filter((o) => o.hour >= 16 && o.hour <= 20);
  if (eveningObs.length > 0) {
    const byRoute = new Map<string, { occSum: number; count: number }>();
    eveningObs.forEach((o) => {
      const cap = routeCapacityLookup.get(o.route_id) ?? capacityConfig.nonAcCapacity;
      const { occupancyPct } = classifyCrowding(o.median_load, cap, capacityConfig);
      const entry = byRoute.get(o.route_number) ?? { occSum: 0, count: 0 };
      entry.occSum += occupancyPct;
      entry.count += 1;
      byRoute.set(o.route_number, entry);
    });
    const topEvening = Array.from(byRoute.entries())
      .map(([routeNumber, s]) => ({
        routeNumber,
        avgOcc: Math.round(s.occSum / Math.max(1, s.count)),
      }))
      .sort((a, b) => b.avgOcc - a.avgOcc)
      .slice(0, 2);

    if (topEvening.length > 0) {
      insights.push({
        id: 'insight-evening',
        category: 'evening-demand',
        title: 'Consistently High Evening Demand Corridors',
        detail: `Between 16:00 and 20:00 IST, ${topEvening
          .map((r) => `Route ${r.routeNumber} (${r.avgOcc}% avg occupancy)`)
          .join(' and ')} exhibit the highest sustained evening passenger pressure.`,
        metricLabel: `${topEvening[0].avgOcc}% evening avg`,
      });
    }
  } else {
    insights.push({
      id: 'insight-evening',
      category: 'evening-demand',
      title: 'Evening Demand Window',
      detail: 'No evening-period segment observations match the active filters.',
      metricLabel: 'No evening rows',
    });
  }

  // 2. Repeated peak-hour crowding hotspot
  const recurringHotspots = hotspots.filter((h) => h.isRecurring);
  if (recurringHotspots.length > 0) {
    const top = recurringHotspots[0];
    insights.push({
      id: 'insight-hotspot',
      category: 'peak-hotspot',
      title: 'Recurring Peak-Hour Overload Stretch',
      detail: `Route ${top.routeNumber} (${top.direction}) from ${top.fromStop} to ${top.toStop} reaches ${top.occupancyPct}% (${top.estimatedLoad}/${top.assumedCapacity} pax) around ${String(top.peakHour).padStart(2, '0')}:00 across ${top.observationsCount} historical observations.`,
      metricLabel: `${recurringHotspots.length} recurring stretch${recurringHotspots.length > 1 ? 'es' : ''}`,
    });
  } else if (hotspots.length > 0) {
    const top = hotspots[0];
    insights.push({
      id: 'insight-hotspot',
      category: 'peak-hotspot',
      title: 'Limited-Sample Overload Observation',
      detail: `Route ${top.routeNumber} (${top.fromStop} → ${top.toStop}) shows ${top.occupancyPct}% occupancy, but only ${top.observationsCount} observation(s) exist—collect additional trips before schedule reallocation.`,
      metricLabel: `${top.observationsCount} obs (low sample)`,
    });
  } else {
    insights.push({
      id: 'insight-hotspot',
      category: 'peak-hotspot',
      title: 'Peak-Hour Crowding Threshold',
      detail: 'No segments exceed 100% capacity under the active filters and vehicle capacity settings.',
      metricLabel: '0 overloaded segments',
    });
  }

  // 3. Weekday vs. Weekend demand delta
  if (weekdayAvgDailyPassengers > 0 && weekendAvgDailyPassengers > 0) {
    const pctDiff = Math.round(
      ((weekdayAvgDailyPassengers - weekendAvgDailyPassengers) / weekendAvgDailyPassengers) * 100
    );
    const directionText =
      pctDiff >= 0
        ? `${pctDiff}% higher daily average demand on weekdays`
        : `${Math.abs(pctDiff)}% higher daily average demand on weekends`;
    insights.push({
      id: 'insight-wkday-wkend',
      category: 'weekday-weekend',
      title: 'Weekday vs. Weekend Demand Shift',
      detail: `Active daily records show ${directionText} (${weekdayAvgDailyPassengers.toLocaleString()} weekday pax/day vs. ${weekendAvgDailyPassengers.toLocaleString()} weekend pax/day).`,
      metricLabel: `${pctDiff >= 0 ? '+' : ''}${pctDiff}% weekday delta`,
    });
  } else {
    insights.push({
      id: 'insight-wkday-wkend',
      category: 'weekday-weekend',
      title: 'Weekday vs. Weekend Comparison',
      detail: 'Both weekday and weekend date records are needed in the active filter range to quantify day-type demand variance.',
      metricLabel: 'Single day-type active',
    });
  }

  // 4. Lower-demand period
  const activeHours = hourlyDemand.filter((h) => h.avgLoad > 0);
  if (activeHours.length > 1) {
    const lowest = [...activeHours].sort((a, b) => a.avgLoad - b.avgLoad)[0];
    const highest = [...activeHours].sort((a, b) => b.avgLoad - a.avgLoad)[0];
    const reductionPct =
      highest.avgLoad > 0
        ? Math.round(((highest.avgLoad - lowest.avgLoad) / highest.avgLoad) * 100)
        : 0;
    insights.push({
      id: 'insight-low-demand',
      category: 'low-demand',
      title: 'Lower-Demand Operating Window',
      detail: `${lowest.hour} IST records the lowest active demand (${lowest.avgLoad.toLocaleString()} avg load/demand), roughly ${reductionPct}% below the ${highest.hour} peak—suitable for commuter shift advisories or maintenance turnarounds.`,
      metricLabel: `${lowest.hour} (${reductionPct}% below peak)`,
    });
  }

  // 5. Insufficient data / low-confidence coverage
  const uncovered = Math.max(0, reliability.totalSegmentsCataloged - reliability.segmentsWithPredictions);
  if (uncovered > 0 || reliability.lowConfidencePredictionsCount > 0 || reliability.unmatchedStopsCount > 0) {
    insights.push({
      id: 'insight-insufficient',
      category: 'insufficient-data',
      title: 'Coverage Gaps & Data Reliability Caveats',
      detail: `${reliability.predictionCoveragePct}% of cataloged route segments have historical ETM observations (${uncovered} uncovered), with ${reliability.lowConfidencePredictionsCount} low-confidence segment slots and ${reliability.unmatchedStopsCount} unmatched ticket stop names.`,
      metricLabel: `${reliability.predictionCoveragePct}% coverage`,
    });
  } else {
    insights.push({
      id: 'insight-insufficient',
      category: 'insufficient-data',
      title: 'Prediction Coverage & Data Quality',
      detail: `100% of cataloged segments in the active selection have historical observations with ${reliability.stopMatchingPct}% GTFS stop matching.`,
      metricLabel: `${reliability.stopMatchingPct}% stop match`,
    });
  }

  return insights;
}
