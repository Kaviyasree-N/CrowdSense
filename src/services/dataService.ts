import {
  SAMPLE_ETM_TICKETS,
  SAMPLE_HISTORICAL_RECORDS,
  SAMPLE_OBSERVATIONS,
  SAMPLE_OCTOBER_DAILY_TRENDS,
} from '../data/samplePredictions';
import { SAMPLE_ROUTES } from '../data/sampleRoutes';
import { evaluateModelsChronologically } from '../engine/modelEvaluation';
import type {
  ActualDatasetResult,
  CapacityConfig,
  CriticalHotspotRow,
  CrowdingLevel,
  DataReliabilitySummary,
  SegmentObservation,
  TransportPlanningInsight,
  WeeklyDemandPoint,
} from '../types/transit';
import {
  AnalyticsFilterState,
  buildDeterministicPlanningInsights,
  BusiestSegmentRow,
  computeCriticalHotspots,
  filterSegmentObservations,
  matchesTimePeriod,
  PaginatedSegmentsResult,
  paginateSegmentObservations,
} from '../utils/analyticsEngine';
import { classifyCrowding, DEFAULT_CAPACITY_CONFIG } from '../utils/crowdClassification';

export type { AnalyticsFilterState, BusiestSegmentRow, PaginatedSegmentsResult };

export interface CrowdingDistributionItem {
  name: CrowdingLevel;
  count: number;
  pct: number;
}

export interface OperatorAnalyticsSummary {
  kpis: {
    totalTicketsAnalyzed: number;
    totalRecordedPassengers: number;
    routeCount: number;
    uniqueVehicles: number;
    identifiedSegmentsCount: number;
    estimatedJourneys: number;
    mostCrowdedRoute: string;
    peakTravelHour: string;
    avgEstimatedOccupancy: number;
    overloadedSegmentsPct: number;
  };
  hourlyDemand: {
    hour: string;
    hourNum: number;
    avgLoad: number;
    weekdayAvg: number;
    weekendAvg: number;
    tickets?: number;
    passengers?: number;
  }[];
  routeDemand: {
    route: string;
    routeNumber: string;
    avgLoad: number;
    avgOccupancyPct: number;
    tickets?: number;
    passengers?: number;
  }[];
  crowdingDistribution: CrowdingDistributionItem[];
  segmentWiseLoad: {
    segment: string;
    avgLoad: number;
    occupancyPct: number;
  }[];
  segmentChartRouteLabel: string;
  dailyTrends: {
    date: string;
    dayLabel: string;
    dayType: 'weekday' | 'weekend';
    ticketsAnalyzed: number;
    estimatedPassengers: number;
  }[];
  weeklyConsistency: WeeklyDemandPoint[];
  busiestSegments: BusiestSegmentRow[];
  allFilteredSegments: BusiestSegmentRow[];
  criticalHotspots: CriticalHotspotRow[];
  planningInsights: TransportPlanningInsight[];
  reliabilityIndicators: DataReliabilitySummary;
}

function computeDemoWeeklyConsistency(
  filteredDaily: {
    date: string;
    dayType: 'weekday' | 'weekend';
    ticketsAnalyzed: number;
    estimatedPassengers: number;
  }[]
): WeeklyDemandPoint[] {
  const weekBuckets = new Map<
    number,
    {
      weekNumber: number;
      tickets: number;
      passengers: number;
      weekdayPassengers: number;
      weekendPassengers: number;
      days: number;
      minDate: string;
      maxDate: string;
    }
  >();

  filteredDaily.forEach((d) => {
    const dayNum = Number(d.date.slice(8, 10)) || 1;
    const weekNumber = Math.min(5, Math.max(1, Math.ceil(dayNum / 7)));
    const entry = weekBuckets.get(weekNumber) ?? {
      weekNumber,
      tickets: 0,
      passengers: 0,
      weekdayPassengers: 0,
      weekendPassengers: 0,
      days: 0,
      minDate: d.date,
      maxDate: d.date,
    };
    entry.tickets += d.ticketsAnalyzed;
    entry.passengers += d.estimatedPassengers;
    if (d.dayType === 'weekday') entry.weekdayPassengers += d.estimatedPassengers;
    else entry.weekendPassengers += d.estimatedPassengers;
    entry.days += 1;
    if (d.date < entry.minDate) entry.minDate = d.date;
    if (d.date > entry.maxDate) entry.maxDate = d.date;
    weekBuckets.set(weekNumber, entry);
  });

  return Array.from(weekBuckets.values())
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((w) => ({
      weekNumber: w.weekNumber,
      weekLabel: `Week ${w.weekNumber}`,
      dateRange:
        w.minDate === w.maxDate
          ? w.minDate.slice(5)
          : `${w.minDate.slice(5)} to ${w.maxDate.slice(5)}`,
      tickets: w.tickets,
      passengers: w.passengers,
      weekdayPassengers: w.weekdayPassengers,
      weekendPassengers: w.weekendPassengers,
      daysObserved: w.days,
      avgDailyPassengers: Math.round(w.passengers / Math.max(1, w.days)),
    }));
}

function buildCrowdingDistribution(
  counts: Record<CrowdingLevel, number>
): CrowdingDistributionItem[] {
  const levels: CrowdingLevel[] = [
    'Seats Available',
    'Standing Room',
    'Crowded',
    'Very Crowded',
  ];
  const total = levels.reduce((s, lvl) => s + counts[lvl], 0);
  return levels.map((level) => ({
    name: level,
    count: counts[level],
    pct: total > 0 ? Math.round((counts[level] / total) * 100) : 0,
  }));
}

export const dataService = {
  getFilteredObservations(filters: AnalyticsFilterState): SegmentObservation[] {
    return filterSegmentObservations(SAMPLE_OBSERVATIONS, filters);
  },

  paginateDemoSegments(
    filters: AnalyticsFilterState,
    capacityConfig: CapacityConfig,
    page: number,
    pageSize: number,
    crowdingFilter: 'ALL' | CrowdingLevel = 'ALL'
  ): PaginatedSegmentsResult {
    const obs = this.getFilteredObservations(filters);
    const routeCapacityLookup = new Map<string, number>();
    SAMPLE_ROUTES.forEach((r) => {
      routeCapacityLookup.set(
        r.route_id,
        r.is_ac ? capacityConfig.acCapacity : capacityConfig.nonAcCapacity
      );
    });
    return paginateSegmentObservations(
      obs,
      routeCapacityLookup,
      capacityConfig,
      page,
      pageSize,
      crowdingFilter
    );
  },

  paginateActualSegmentsLocal(
    actual: ActualDatasetResult,
    filters: AnalyticsFilterState,
    capacityConfig: CapacityConfig,
    page: number,
    pageSize: number,
    crowdingFilter: 'ALL' | CrowdingLevel = 'ALL'
  ): PaginatedSegmentsResult {
    const obs = filterSegmentObservations(actual.aggregatedObservations, filters);
    const routeCapacityLookup = new Map<string, number>();
    actual.activeRoutes.forEach((r) => {
      routeCapacityLookup.set(
        r.route_id,
        r.is_ac ? capacityConfig.acCapacity : capacityConfig.nonAcCapacity
      );
    });
    return paginateSegmentObservations(
      obs,
      routeCapacityLookup,
      capacityConfig,
      page,
      pageSize,
      crowdingFilter
    );
  },

  getAnalyticsSummary(
    filters: AnalyticsFilterState,
    capacityConfig: CapacityConfig = DEFAULT_CAPACITY_CONFIG
  ): OperatorAnalyticsSummary {
    const obs = this.getFilteredObservations(filters);
    const filteredDaily = SAMPLE_OCTOBER_DAILY_TRENDS.filter((d) => {
      if (d.date < filters.dateStart || d.date > filters.dateEnd) return false;
      if (filters.dayType !== 'all' && d.dayType !== filters.dayType) return false;
      return true;
    });

    const filteredRoutes = SAMPLE_ROUTES.filter((r) => {
      if (filters.routeNumber !== 'ALL' && r.route_number !== filters.routeNumber) return false;
      if (filters.direction !== 'all' && r.direction !== filters.direction) return false;
      return true;
    });

    const uniqueRouteNums = new Set(filteredRoutes.map((r) => r.route_number));
    const routeCount = uniqueRouteNums.size;
    const allRouteCount = new Set(SAMPLE_ROUTES.map((r) => r.route_number)).size;

    const identifiedSegmentsCount = filteredRoutes.reduce(
      (sum, r) => sum + Math.max(0, r.stops.length - 1),
      0
    );

    // Scale simulated daily totals proportionally when filtering to a single route or time period
    const routeScale =
      filters.routeNumber === 'ALL' ? 1 : 1 / Math.max(1, allRouteCount);
    const periodScale =
      filters.timePeriod === 'all'
        ? 1
        : filters.timePeriod === 'evening'
        ? 0.36
        : filters.timePeriod === 'morning'
        ? 0.31
        : filters.timePeriod === 'midday'
        ? 0.22
        : 0.11;

    const rawTicketsSum = filteredDaily.reduce((sum, d) => sum + d.ticketsAnalyzed, 0);
    const rawPaxSum = filteredDaily.reduce((sum, d) => sum + d.estimatedPassengers, 0);

    const totalTicketsAnalyzed = Math.round(rawTicketsSum * routeScale * periodScale);
    const totalRecordedPassengers = Math.round(rawPaxSum * routeScale * periodScale);

    // Demo fleet vehicles matched to filter
    const sampleVehiclesAll = new Set(
      SAMPLE_ETM_TICKETS.filter(
        (t) => filters.routeNumber === 'ALL' || t.route === filters.routeNumber
      ).map((t) => t.vehicle_number)
    ).size;
    const uniqueVehicles =
      filters.routeNumber === 'ALL'
        ? 142
        : Math.max(sampleVehiclesAll * 6, 14);

    const routeCapacityLookup = new Map<string, number>();
    SAMPLE_ROUTES.forEach((r) => {
      routeCapacityLookup.set(
        r.route_id,
        r.is_ac ? capacityConfig.acCapacity : capacityConfig.nonAcCapacity
      );
    });

    const routeDemandMap = new Map<string, { loadSum: number; count: number; occSum: number }>();
    const hourDemandMap = new Map<
      number,
      { weekdaySum: number; weekdayCount: number; weekendSum: number; weekendCount: number; totalLoad: number; totalCount: number }
    >();
    const crowdingCounts: Record<CrowdingLevel, number> = {
      'Seats Available': 0,
      'Standing Room': 0,
      Crowded: 0,
      'Very Crowded': 0,
    };

    let lowConfCount = 0;

    obs.forEach((o) => {
      const cap = routeCapacityLookup.get(o.route_id) ?? capacityConfig.nonAcCapacity;
      const { occupancyPct, level } = classifyCrowding(o.median_load, cap, capacityConfig);
      crowdingCounts[level] += 1;
      if (o.observations_count < 15 || o.weekly_cv > 0.3) {
        lowConfCount += 1;
      }

      const rEntry = routeDemandMap.get(o.route_number) ?? { loadSum: 0, count: 0, occSum: 0 };
      rEntry.loadSum += o.median_load;
      rEntry.occSum += occupancyPct;
      rEntry.count += 1;
      routeDemandMap.set(o.route_number, rEntry);

      const hEntry = hourDemandMap.get(o.hour) ?? {
        weekdaySum: 0,
        weekdayCount: 0,
        weekendSum: 0,
        weekendCount: 0,
        totalLoad: 0,
        totalCount: 0,
      };
      hEntry.totalLoad += o.median_load;
      hEntry.totalCount += 1;
      if (o.day_type === 'weekday') {
        hEntry.weekdaySum += o.median_load;
        hEntry.weekdayCount += 1;
      } else {
        hEntry.weekendSum += o.median_load;
        hEntry.weekendCount += 1;
      }
      hourDemandMap.set(o.hour, hEntry);
    });

    const routeDemand = Array.from(routeDemandMap.entries())
      .map(([route, stats]) => ({
        route: `Route ${route}`,
        routeNumber: route,
        avgLoad: Math.round(stats.loadSum / Math.max(1, stats.count)),
        avgOccupancyPct: Math.round(stats.occSum / Math.max(1, stats.count)),
      }))
      .sort((a, b) => b.avgOccupancyPct - a.avgOccupancyPct);

    const hourlyDemand = Array.from({ length: 19 }, (_, idx) => idx + 5).map((hr) => {
      const entry = hourDemandMap.get(hr);
      return {
        hour: `${String(hr).padStart(2, '0')}:00`,
        hourNum: hr,
        avgLoad: entry ? Math.round(entry.totalLoad / Math.max(1, entry.totalCount)) : 0,
        weekdayAvg:
          entry && entry.weekdayCount > 0 ? Math.round(entry.weekdaySum / entry.weekdayCount) : 0,
        weekendAvg:
          entry && entry.weekendCount > 0 ? Math.round(entry.weekendSum / entry.weekendCount) : 0,
      };
    });

    const peakHourEntry = [...hourlyDemand].sort((a, b) => b.avgLoad - a.avgLoad)[0];
    const mostCrowdedRoute = routeDemand[0]?.routeNumber ?? '39';
    const avgEstimatedOccupancy =
      obs.length > 0
        ? Math.round(
            obs.reduce((sum, o) => {
              const cap = routeCapacityLookup.get(o.route_id) ?? capacityConfig.nonAcCapacity;
              return sum + (o.median_load / cap) * 100;
            }, 0) / obs.length
          )
        : 0;

    const overloadedCount = crowdingCounts.Crowded + crowdingCounts['Very Crowded'];
    const overloadedSegmentsPct =
      obs.length > 0 ? Math.round((overloadedCount / obs.length) * 100) : 0;

    const targetRouteForSegmentChart =
      filters.routeNumber === 'ALL' ? routeDemand[0]?.routeNumber ?? '39' : filters.routeNumber;
    const targetDirection = filters.direction === 'all' ? 'UP' : filters.direction;
    const segmentProfileMap = new Map<
      number,
      { label: string; loadSum: number; occSum: number; count: number }
    >();
    obs
      .filter(
        (o) =>
          o.route_number === targetRouteForSegmentChart &&
          o.direction === targetDirection
      )
      .forEach((o) => {
        const cap = routeCapacityLookup.get(o.route_id) ?? capacityConfig.nonAcCapacity;
        const { occupancyPct } = classifyCrowding(o.median_load, cap, capacityConfig);
        const entry = segmentProfileMap.get(o.segment_order) ?? {
          label: `${o.from_stop_name.split(' ')[0]}–${o.to_stop_name.split(' ')[0]}`,
          loadSum: 0,
          occSum: 0,
          count: 0,
        };
        entry.loadSum += o.median_load;
        entry.occSum += occupancyPct;
        entry.count += 1;
        segmentProfileMap.set(o.segment_order, entry);
      });

    const segmentWiseLoad = Array.from(segmentProfileMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, val]) => ({
        segment: val.label,
        avgLoad: Math.round(val.loadSum / Math.max(1, val.count)),
        occupancyPct: Math.round(val.occSum / Math.max(1, val.count)),
      }));

    const crowdingDistribution = buildCrowdingDistribution(crowdingCounts);
    const allFiltered = paginateSegmentObservations(
      obs,
      routeCapacityLookup,
      capacityConfig,
      1,
      5000,
      'ALL'
    ).items;

    const criticalHotspots = computeCriticalHotspots(obs, routeCapacityLookup, capacityConfig);

    const dailyTrends = filteredDaily.map((d) => ({
      date: d.date,
      dayLabel: d.dayLabel,
      dayType: d.dayType,
      ticketsAnalyzed: Math.round(d.ticketsAnalyzed * routeScale * periodScale),
      estimatedPassengers: Math.round(d.estimatedPassengers * routeScale * periodScale),
    }));

    const weeklyConsistency = computeDemoWeeklyConsistency(dailyTrends);

    const weekdayDays = dailyTrends.filter((d) => d.dayType === 'weekday');
    const weekendDays = dailyTrends.filter((d) => d.dayType === 'weekend');
    const weekdayAvgDailyPassengers =
      weekdayDays.length > 0
        ? Math.round(weekdayDays.reduce((s, d) => s + d.estimatedPassengers, 0) / weekdayDays.length)
        : 0;
    const weekendAvgDailyPassengers =
      weekendDays.length > 0
        ? Math.round(weekendDays.reduce((s, d) => s + d.estimatedPassengers, 0) / weekendDays.length)
        : 0;

    const uniqueSegWithPreds = new Set(
      obs.map((o) => `${o.route_id}|${o.from_stop_id}|${o.to_stop_id}`)
    ).size;

    const reliabilityIndicators: DataReliabilitySummary = {
      dataMode: 'demo',
      datasetCoverageLabel: `${dailyTrends.length} simulated October 2026 days`,
      dateRangeLabel: `${filters.dateStart} to ${filters.dateEnd}`,
      totalRecords: totalTicketsAnalyzed,
      validRecords: totalTicketsAnalyzed,
      invalidAndDuplicateCount: 0,
      stopMatchingPct: 97,
      matchedStopsCount: 28,
      totalUniqueStopsCount: 29,
      unmatchedStopsCount: 1,
      unmatchedStopsSample: ['IGI Terminal Link (Demo)'],
      identifiedTrips: 1440,
      ambiguousTrips: 48,
      predictionCoveragePct:
        identifiedSegmentsCount > 0
          ? Math.min(100, Math.round((uniqueSegWithPreds / identifiedSegmentsCount) * 100))
          : 0,
      segmentsWithPredictions: uniqueSegWithPreds,
      totalSegmentsCataloged: identifiedSegmentsCount,
      lowConfidencePredictionsCount: lowConfCount,
      lowConfidenceSharePct:
        obs.length > 0 ? Math.round((lowConfCount / obs.length) * 100) : 0,
      recordedDemandNote:
        'Recorded passenger demand sums raw ETM ticket passenger_count fields across active routes/dates.',
      estimatedOccupancyNote:
        'Estimated segment occupancy models net on-board bus load (Load[s] = Prev + Boarding - Alighting) per directed stop-to-stop stretch.',
    };

    const planningInsights = buildDeterministicPlanningInsights({
      observations: obs,
      routeCapacityLookup,
      capacityConfig,
      hourlyDemand,
      hotspots: criticalHotspots,
      weekdayAvgDailyPassengers,
      weekendAvgDailyPassengers,
      reliability: reliabilityIndicators,
    });

    return {
      kpis: {
        totalTicketsAnalyzed,
        totalRecordedPassengers,
        routeCount,
        uniqueVehicles,
        identifiedSegmentsCount,
        estimatedJourneys: totalRecordedPassengers,
        mostCrowdedRoute: `Route ${mostCrowdedRoute}`,
        peakTravelHour: peakHourEntry?.hour ?? '18:00',
        avgEstimatedOccupancy,
        overloadedSegmentsPct,
      },
      hourlyDemand,
      routeDemand,
      crowdingDistribution,
      segmentWiseLoad,
      segmentChartRouteLabel: `Route ${targetRouteForSegmentChart} (${targetDirection})`,
      dailyTrends,
      weeklyConsistency,
      busiestSegments: allFiltered.slice(0, 12),
      allFilteredSegments: allFiltered,
      criticalHotspots,
      planningInsights,
      reliabilityIndicators,
    };
  },

  getActualAnalyticsSummary(
    actual: ActualDatasetResult,
    filters: AnalyticsFilterState,
    capacityConfig: CapacityConfig = DEFAULT_CAPACITY_CONFIG
  ): OperatorAnalyticsSummary {
    const obs = filterSegmentObservations(actual.aggregatedObservations, filters);

    const filteredDailyRaw = actual.dailyDistribution.filter((d) => {
      if (filters.dateStart && d.date < filters.dateStart) return false;
      if (filters.dateEnd && d.date > filters.dateEnd) return false;
      if (filters.dayType !== 'all' && d.dayType !== filters.dayType) return false;
      return true;
    });

    // Compute exact date-filtered ticket/pax counts, then scale proportionally only when
    // narrowing by specific route or time period (so unfiltered state shows exact totals).
    const allDailyTickets = actual.dailyDistribution.reduce((s, d) => s + d.tickets, 0);
    const filteredDailyTickets = filteredDailyRaw.reduce((s, d) => s + d.tickets, 0);
    const filteredDailyPax = filteredDailyRaw.reduce((s, d) => s + d.passengers, 0);

    const selectedRouteVol =
      filters.routeNumber !== 'ALL'
        ? actual.routeVolume.find((r) => r.routeNumber === filters.routeNumber)
        : undefined;

    const routeRatio =
      filters.routeNumber === 'ALL'
        ? 1
        : selectedRouteVol && actual.validRecords > 0
        ? selectedRouteVol.tickets / actual.validRecords
        : 0;

    const filteredHourlyTicketBuckets = actual.hourlyDistribution.filter((h) =>
      matchesTimePeriod(h.hourNum, filters.timePeriod)
    );
    const periodTicketsTotal = filteredHourlyTicketBuckets.reduce((s, h) => s + h.tickets, 0);
    const periodRatio =
      filters.timePeriod === 'all'
        ? 1
        : actual.validRecords > 0
        ? periodTicketsTotal / actual.validRecords
        : 0;

    const isUnfilteredDaily =
      filteredDailyRaw.length === actual.dailyDistribution.length &&
      filters.dayType === 'all';

    const baseTickets = isUnfilteredDaily ? actual.validRecords : filteredDailyTickets;
    const basePax = isUnfilteredDaily ? actual.totalPassengers : filteredDailyPax;

    const totalTicketsAnalyzed = Math.round(baseTickets * routeRatio * periodRatio);
    const totalRecordedPassengers = Math.round(basePax * routeRatio * periodRatio);

    const dailyTrends = filteredDailyRaw.map((d) => ({
      date: d.date,
      dayLabel: d.dayLabel,
      dayType: d.dayType,
      ticketsAnalyzed: Math.round(d.tickets * routeRatio * periodRatio),
      estimatedPassengers: Math.round(d.passengers * routeRatio * periodRatio),
    }));

    const filteredRoutes = actual.activeRoutes.filter((r) => {
      if (filters.routeNumber !== 'ALL' && r.route_number !== filters.routeNumber) return false;
      if (filters.direction !== 'all' && r.direction !== filters.direction) return false;
      return true;
    });

    const identifiedSegmentsCount =
      filteredRoutes.length > 0
        ? filteredRoutes.reduce((sum, r) => sum + Math.max(0, r.stops.length - 1), 0)
        : actual.totalIdentifiedSegments ?? 0;

    const routeCount =
      filters.routeNumber === 'ALL'
        ? actual.uniqueRoutes
        : selectedRouteVol || filteredRoutes.length > 0
        ? 1
        : 0;

    const uniqueVehicles =
      filters.routeNumber === 'ALL'
        ? actual.uniqueVehicles
        : selectedRouteVol?.vehicles ?? 0;

    const routeCapacityLookup = new Map<string, number>();
    actual.activeRoutes.forEach((r) => {
      routeCapacityLookup.set(
        r.route_id,
        r.is_ac ? capacityConfig.acCapacity : capacityConfig.nonAcCapacity
      );
    });

    const crowdingCounts: Record<CrowdingLevel, number> = {
      'Seats Available': 0,
      'Standing Room': 0,
      Crowded: 0,
      'Very Crowded': 0,
    };

    const routeObsMap = new Map<string, { loadSum: number; count: number; occSum: number }>();
    const hourObsMap = new Map<
      number,
      { weekdaySum: number; weekdayCount: number; weekendSum: number; weekendCount: number; totalLoad: number; totalCount: number }
    >();

    let lowConfCount = 0;

    obs.forEach((o) => {
      const cap = routeCapacityLookup.get(o.route_id) ?? capacityConfig.nonAcCapacity;
      const { occupancyPct, level } = classifyCrowding(o.median_load, cap, capacityConfig);
      crowdingCounts[level] += 1;
      if (o.observations_count < 5 || o.weekly_cv > 0.3) {
        lowConfCount += 1;
      }

      const rEntry = routeObsMap.get(o.route_number) ?? { loadSum: 0, count: 0, occSum: 0 };
      rEntry.loadSum += o.median_load;
      rEntry.occSum += occupancyPct;
      rEntry.count += 1;
      routeObsMap.set(o.route_number, rEntry);

      const hEntry = hourObsMap.get(o.hour) ?? {
        weekdaySum: 0,
        weekdayCount: 0,
        weekendSum: 0,
        weekendCount: 0,
        totalLoad: 0,
        totalCount: 0,
      };
      hEntry.totalLoad += o.median_load;
      hEntry.totalCount += 1;
      if (o.day_type === 'weekday') {
        hEntry.weekdaySum += o.median_load;
        hEntry.weekdayCount += 1;
      } else {
        hEntry.weekendSum += o.median_load;
        hEntry.weekendCount += 1;
      }
      hourObsMap.set(o.hour, hEntry);
    });

    const hourlyDayTypeMap = new Map(
      (actual.hourlyDayTypeDistribution ?? []).map((h) => [h.hourNum, h])
    );

    const hourlyDemand =
      obs.length > 0
        ? Array.from({ length: 19 }, (_, idx) => idx + 5).map((hr) => {
            const entry = hourObsMap.get(hr);
            const rawHr = actual.hourlyDistribution.find((h) => h.hourNum === hr);
            return {
              hour: `${String(hr).padStart(2, '0')}:00`,
              hourNum: hr,
              avgLoad: entry ? Math.round(entry.totalLoad / Math.max(1, entry.totalCount)) : 0,
              weekdayAvg:
                entry && entry.weekdayCount > 0
                  ? Math.round(entry.weekdaySum / entry.weekdayCount)
                  : 0,
              weekendAvg:
                entry && entry.weekendCount > 0
                  ? Math.round(entry.weekendSum / entry.weekendCount)
                  : 0,
              tickets: rawHr?.tickets ?? 0,
              passengers: rawHr?.passengers ?? 0,
            };
          })
        : actual.hourlyDistribution
            .filter((h) => h.hourNum >= 5 && h.hourNum <= 23 && matchesTimePeriod(h.hourNum, filters.timePeriod))
            .map((h) => {
              const dt = hourlyDayTypeMap.get(h.hourNum);
              const activeVal =
                filters.dayType === 'weekday'
                  ? dt?.weekdayPassengers ?? h.passengers
                  : filters.dayType === 'weekend'
                  ? dt?.weekendPassengers ?? 0
                  : h.passengers;
              return {
                hour: h.hour,
                hourNum: h.hourNum,
                avgLoad: Math.round(activeVal * routeRatio),
                weekdayAvg: Math.round((dt?.weekdayPassengers ?? h.passengers) * routeRatio),
                weekendAvg: Math.round((dt?.weekendPassengers ?? 0) * routeRatio),
                tickets: Math.round(h.tickets * routeRatio),
                passengers: Math.round(activeVal * routeRatio),
              };
            });

    const routeVolumeLookup = new Map(actual.routeVolume.map((r) => [r.routeNumber, r]));

    const routeDemand =
      routeObsMap.size > 0
        ? Array.from(routeObsMap.entries())
            .map(([route, stats]) => {
              const rv = routeVolumeLookup.get(route);
              return {
                route: `Route ${route}`,
                routeNumber: route,
                avgLoad: Math.round(stats.loadSum / Math.max(1, stats.count)),
                avgOccupancyPct: Math.round(stats.occSum / Math.max(1, stats.count)),
                tickets: rv?.tickets,
                passengers: rv?.passengers,
              };
            })
            .sort((a, b) => b.avgOccupancyPct - a.avgOccupancyPct)
            .slice(0, 15)
        : actual.routeVolume
            .filter((rv) => filters.routeNumber === 'ALL' || rv.routeNumber === filters.routeNumber)
            .slice(0, 15)
            .map((rv) => ({
              route: rv.route,
              routeNumber: rv.routeNumber,
              avgLoad: rv.passengers,
              avgOccupancyPct: Math.min(
                180,
                Math.round((rv.passengers / Math.max(1, rv.vehicles * capacityConfig.nonAcCapacity)) * 100)
              ),
              tickets: rv.tickets,
              passengers: rv.passengers,
            }));

    const peakObsHour =
      obs.length > 0 ? [...hourlyDemand].sort((a, b) => b.avgLoad - a.avgLoad)[0] : undefined;
    const peakTicketHour = [...hourlyDemand].sort((a, b) => (b.passengers ?? b.avgLoad) - (a.passengers ?? a.avgLoad))[0];
    const peakTravelHour =
      peakObsHour && peakObsHour.avgLoad > 0
        ? peakObsHour.hour
        : peakTicketHour?.hour ?? 'N/A';

    const mostCrowdedRoute =
      routeDemand[0]?.routeNumber ?? actual.routeVolume[0]?.routeNumber ?? 'N/A';

    const avgEstimatedOccupancy =
      obs.length > 0
        ? Math.round(
            obs.reduce((sum, o) => {
              const cap = routeCapacityLookup.get(o.route_id) ?? capacityConfig.nonAcCapacity;
              return sum + (o.median_load / cap) * 100;
            }, 0) / obs.length
          )
        : 0;

    const overloadedCount = crowdingCounts.Crowded + crowdingCounts['Very Crowded'];
    const overloadedSegmentsPct =
      obs.length > 0 ? Math.round((overloadedCount / obs.length) * 100) : 0;

    const targetRoute =
      filters.routeNumber === 'ALL'
        ? routeDemand[0]?.routeNumber ?? actual.routeVolume[0]?.routeNumber ?? ''
        : filters.routeNumber;
    const targetDirection = filters.direction === 'all' ? 'UP' : filters.direction;
    const segMap = new Map<
      number,
      { label: string; loadSum: number; occSum: number; count: number }
    >();
    obs
      .filter((o) => o.route_number === targetRoute && o.direction === targetDirection)
      .forEach((o) => {
        const cap = routeCapacityLookup.get(o.route_id) ?? capacityConfig.nonAcCapacity;
        const { occupancyPct } = classifyCrowding(o.median_load, cap, capacityConfig);
        const entry = segMap.get(o.segment_order) ?? {
          label: `${o.from_stop_name.split(' ')[0]}–${o.to_stop_name.split(' ')[0]}`,
          loadSum: 0,
          occSum: 0,
          count: 0,
        };
        entry.loadSum += o.median_load;
        entry.occSum += occupancyPct;
        entry.count += 1;
        segMap.set(o.segment_order, entry);
      });

    const segmentWiseLoad = Array.from(segMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => ({
        segment: v.label,
        avgLoad: Math.round(v.loadSum / Math.max(1, v.count)),
        occupancyPct: Math.round(v.occSum / Math.max(1, v.count)),
      }));

    const allFiltered = paginateSegmentObservations(
      obs,
      routeCapacityLookup,
      capacityConfig,
      1,
      5000,
      'ALL'
    ).items;

    const criticalHotspots = computeCriticalHotspots(obs, routeCapacityLookup, capacityConfig);

    // Weekly consistency: use full streaming weeklyDistribution if unfiltered,
    // or derive from filtered dailyTrends so date/dayType/route filters apply consistently.
    const weeklyConsistency: WeeklyDemandPoint[] =
      actual.weeklyDistribution &&
      actual.weeklyDistribution.length > 0 &&
      isUnfilteredDaily &&
      filters.routeNumber === 'ALL' &&
      filters.timePeriod === 'all'
        ? actual.weeklyDistribution
        : computeDemoWeeklyConsistency(dailyTrends);

    const weekdayDays = dailyTrends.filter((d) => d.dayType === 'weekday');
    const weekendDays = dailyTrends.filter((d) => d.dayType === 'weekend');
    const weekdayAvgDailyPassengers =
      weekdayDays.length > 0
        ? Math.round(weekdayDays.reduce((s, d) => s + d.estimatedPassengers, 0) / weekdayDays.length)
        : 0;
    const weekendAvgDailyPassengers =
      weekendDays.length > 0
        ? Math.round(weekendDays.reduce((s, d) => s + d.estimatedPassengers, 0) / weekendDays.length)
        : 0;

    const uniqueSegWithPreds = new Set(
      obs.map((o) => `${o.route_id}|${o.from_stop_id}|${o.to_stop_id}`)
    ).size;

    const totalCatalogedSegments =
      identifiedSegmentsCount > 0 ? identifiedSegmentsCount : uniqueSegWithPreds;

    const dateCoverageDays = allDailyTickets > 0 ? actual.dailyDistribution.length : 0;

    const reliabilityIndicators: DataReliabilitySummary = {
      dataMode: 'actual',
      datasetCoverageLabel: `${dateCoverageDays} calendar day(s) in ${actual.sourceName}`,
      dateRangeLabel:
        actual.dateRangeIST.start !== 'N/A'
          ? `${actual.dateRangeIST.start} to ${actual.dateRangeIST.end} (IST)`
          : 'No valid IST dates',
      totalRecords: actual.totalRecords,
      validRecords: actual.validRecords,
      invalidAndDuplicateCount: actual.invalidRecords + actual.duplicateRecords,
      stopMatchingPct: actual.stopMatchingReport.matchingConfidencePct,
      matchedStopsCount: actual.stopMatchingReport.matchedCount,
      totalUniqueStopsCount: actual.stopMatchingReport.totalUniqueTicketStops,
      unmatchedStopsCount: actual.stopMatchingReport.unmatchedCount,
      unmatchedStopsSample: actual.stopMatchingReport.unmatchedSamples.map((s) => s.rawStopName),
      identifiedTrips: actual.reconstructedTripsCount,
      ambiguousTrips: actual.ambiguousTripsCount,
      predictionCoveragePct:
        totalCatalogedSegments > 0
          ? Math.min(100, Math.round((uniqueSegWithPreds / totalCatalogedSegments) * 100))
          : 0,
      segmentsWithPredictions: uniqueSegWithPreds,
      totalSegmentsCataloged: totalCatalogedSegments,
      lowConfidencePredictionsCount: lowConfCount,
      lowConfidenceSharePct:
        obs.length > 0 ? Math.round((lowConfCount / obs.length) * 100) : 0,
      recordedDemandNote:
        'Recorded passenger demand sums actual ticket passenger_count entries parsed from the uploaded ETM CSV.',
      estimatedOccupancyNote:
        'Estimated segment occupancy models bus load between GTFS stops via Load[s] = max(0, Prev + Boarding - Alighting) from reconstructed trips.',
    };

    const planningInsights = buildDeterministicPlanningInsights({
      observations: obs,
      routeCapacityLookup,
      capacityConfig,
      hourlyDemand,
      hotspots: criticalHotspots,
      weekdayAvgDailyPassengers,
      weekendAvgDailyPassengers,
      reliability: reliabilityIndicators,
    });

    return {
      kpis: {
        totalTicketsAnalyzed,
        totalRecordedPassengers,
        routeCount,
        uniqueVehicles,
        identifiedSegmentsCount: totalCatalogedSegments,
        estimatedJourneys: totalRecordedPassengers,
        mostCrowdedRoute: mostCrowdedRoute !== 'N/A' ? `Route ${mostCrowdedRoute}` : 'N/A',
        peakTravelHour,
        avgEstimatedOccupancy,
        overloadedSegmentsPct,
      },
      hourlyDemand,
      routeDemand,
      crowdingDistribution: buildCrowdingDistribution(crowdingCounts),
      segmentWiseLoad,
      segmentChartRouteLabel: targetRoute ? `Route ${targetRoute} (${targetDirection})` : 'Awaiting GTFS Mapping',
      dailyTrends,
      weeklyConsistency,
      busiestSegments: allFiltered.slice(0, 12),
      allFilteredSegments: allFiltered,
      criticalHotspots,
      planningInsights,
      reliabilityIndicators,
    };
  },

  getDemoModelEvaluation() {
    return evaluateModelsChronologically(SAMPLE_HISTORICAL_RECORDS);
  },

  generateSampleCsvString(): string {
    const headers =
      'created_at,vehicle_number,route,start_stop_name,end_stop_name,passenger_count,amount,ticket_type_id,is_ac';
    const rows = [
      '2026-10-14 18:02:14,DL1PD4821,39,Anand Vihar ISBT,ITO Crossing,2,30,1,false',
      '2026-10-14 18:03:09,DL1PD4821,39,Anand Vihar ISBT,Connaught Place (Shivaji Stadium),1,15,1,false',
      '2026-10-14 18:10:42,DL1PD4821,39,Preet Vihar,Mandi House,3,45,2,false',
      '2026-10-14 18:16:51,DL1PD4821,39,Laxmi Nagar,Rajiv Chowk Metro Gate,4,60,1,false',
      '2026-10-14 18:05:19,DL1PC9104,85A,Anand Vihar ISBT,Connaught Place (Shivaji Stadium),2,50,1,true',
      '2026-10-14 18:12:33,DL1PC9104,85A,Preet Vihar,India Gate Circle,1,25,3,true',
      '2026-10-14 18:08:47,DL1PC7712,410,Anand Vihar ISBT,Kashmere Gate ISBT,2,30,1,true',
      '2026-10-14 09:14:02,DL1PC3309,761,Dwarka Sector 21,Karol Bagh,2,50,1,true',
      '2026-10-15 17:45:11,DL1PD6192,534,Laxmi Nagar,Lajpat Nagar,2,30,1,false',
      '2026-10-17 13:20:44,DL1PC5288,623,AIIMS Trauma & Metro,Connaught Place (Shivaji Stadium),2,40,1,true',
    ];
    return [headers, ...rows].join('\n');
  },
};
