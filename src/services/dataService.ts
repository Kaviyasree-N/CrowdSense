import {
  ActualDatasetResult,
  CapacityConfig,
  CrowdingLevel,
  DayType,
  SegmentObservation,
} from '../types/transit';
import {
  SAMPLE_HISTORICAL_RECORDS,
  SAMPLE_OBSERVATIONS,
  SAMPLE_OCTOBER_DAILY_TRENDS,
} from '../data/samplePredictions';
import { SAMPLE_ROUTES } from '../data/sampleRoutes';
import { evaluateModelsChronologically } from '../engine/modelEvaluation';
import { classifyCrowding, DEFAULT_CAPACITY_CONFIG } from '../utils/crowdClassification';
import { evaluateConfidence } from '../utils/passengerLoad';

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
  confidence: 'High' | 'Medium' | 'Low';
}

function matchesTimePeriod(hour: number, period: AnalyticsFilterState['timePeriod']): boolean {
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

export const dataService = {
  getFilteredObservations(filters: AnalyticsFilterState): SegmentObservation[] {
    return SAMPLE_OBSERVATIONS.filter((obs) => {
      if (filters.routeNumber !== 'ALL' && obs.route_number !== filters.routeNumber) return false;
      if (filters.dayType !== 'all' && obs.day_type !== filters.dayType) return false;
      if (filters.direction !== 'all' && obs.direction !== filters.direction) return false;
      if (!matchesTimePeriod(obs.hour, filters.timePeriod)) return false;
      return true;
    });
  },

  getAnalyticsSummary(
    filters: AnalyticsFilterState,
    capacityConfig: CapacityConfig = DEFAULT_CAPACITY_CONFIG
  ) {
    const obs = this.getFilteredObservations(filters);
    const filteredDaily = SAMPLE_OCTOBER_DAILY_TRENDS.filter((d) => {
      if (d.date < filters.dateStart || d.date > filters.dateEnd) return false;
      if (filters.dayType !== 'all' && d.dayType !== filters.dayType) return false;
      return true;
    });

    const routeCount =
      filters.routeNumber === 'ALL'
        ? new Set(SAMPLE_ROUTES.map((r) => r.route_number)).size
        : 1;

    const totalTicketsAnalyzed = filteredDaily.reduce((sum, d) => sum + d.ticketsAnalyzed, 0);
    const estimatedJourneys = filteredDaily.reduce((sum, d) => sum + d.estimatedPassengers, 0);

    // Route-wise demand
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

    const routeCapacityLookup = new Map<string, number>();
    SAMPLE_ROUTES.forEach((r) => {
      routeCapacityLookup.set(
        r.route_id,
        r.is_ac ? capacityConfig.acCapacity : capacityConfig.nonAcCapacity
      );
    });

    obs.forEach((o) => {
      const cap = routeCapacityLookup.get(o.route_id) ?? capacityConfig.nonAcCapacity;
      const { occupancyPct, level } = classifyCrowding(o.median_load, cap, capacityConfig);
      crowdingCounts[level] += 1;

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
        weekdayAvg: entry && entry.weekdayCount > 0 ? Math.round(entry.weekdaySum / entry.weekdayCount) : 0,
        weekendAvg: entry && entry.weekendCount > 0 ? Math.round(entry.weekendSum / entry.weekendCount) : 0,
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

    // Segment-wise load for selected route (or Route 39 default)
    const targetRouteForSegmentChart =
      filters.routeNumber === 'ALL' ? '39' : filters.routeNumber;
    const targetDirection = filters.direction === 'all' ? 'UP' : filters.direction;
    const segmentProfileMap = new Map<
      number,
      { label: string; loadSum: number; count: number }
    >();
    obs
      .filter(
        (o) =>
          o.route_number === targetRouteForSegmentChart &&
          o.direction === targetDirection
      )
      .forEach((o) => {
        const entry = segmentProfileMap.get(o.segment_order) ?? {
          label: `${o.from_stop_name.split(' ')[0]}–${o.to_stop_name.split(' ')[0]}`,
          loadSum: 0,
          count: 0,
        };
        entry.loadSum += o.median_load;
        entry.count += 1;
        segmentProfileMap.set(o.segment_order, entry);
      });

    const segmentWiseLoad = Array.from(segmentProfileMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, val]) => ({
        segment: val.label,
        avgLoad: Math.round(val.loadSum / Math.max(1, val.count)),
      }));

    const crowdingDistribution = (
      ['Seats Available', 'Standing Room', 'Crowded', 'Very Crowded'] as CrowdingLevel[]
    ).map((level) => ({
      name: level,
      count: crowdingCounts[level],
    }));

    // Busiest route segments table
    const busiestSegments: BusiestSegmentRow[] = [...obs]
      .sort((a, b) => b.median_load - a.median_load)
      .slice(0, 12)
      .map((o) => {
        const cap = routeCapacityLookup.get(o.route_id) ?? capacityConfig.nonAcCapacity;
        const { occupancyPct, level } = classifyCrowding(o.median_load, cap, capacityConfig);
        const conf = evaluateConfidence(o);
        return {
          routeNumber: o.route_number,
          direction: o.direction,
          fromStop: o.from_stop_name,
          toStop: o.to_stop_name,
          timePeriod: `${String(o.hour).padStart(2, '0')}:00 (${o.day_type})`,
          estimatedLoad: o.median_load,
          assumedCapacity: cap,
          occupancyPct,
          crowdingLevel: level,
          confidence: conf.confidence,
        };
      });

    return {
      kpis: {
        totalTicketsAnalyzed,
        routeCount,
        estimatedJourneys,
        mostCrowdedRoute: `Route ${mostCrowdedRoute}`,
        peakTravelHour: peakHourEntry?.hour ?? '18:00',
        avgEstimatedOccupancy,
      },
      hourlyDemand,
      routeDemand,
      crowdingDistribution,
      segmentWiseLoad,
      segmentChartRouteLabel: `Route ${targetRouteForSegmentChart} (${targetDirection})`,
      dailyTrends: filteredDaily,
      busiestSegments,
    };
  },

  getActualAnalyticsSummary(
    actual: ActualDatasetResult,
    filters: AnalyticsFilterState,
    capacityConfig: CapacityConfig = DEFAULT_CAPACITY_CONFIG
  ) {
    const obs = actual.aggregatedObservations.filter((o) => {
      if (filters.routeNumber !== 'ALL' && o.route_number !== filters.routeNumber) return false;
      if (filters.dayType !== 'all' && o.day_type !== filters.dayType) return false;
      if (filters.direction !== 'all' && o.direction !== filters.direction) return false;
      if (!matchesTimePeriod(o.hour, filters.timePeriod)) return false;
      return true;
    });

    const filteredDaily = actual.dailyDistribution
      .filter((d) => {
        if (filters.dateStart && d.date < filters.dateStart) return false;
        if (filters.dateEnd && d.date > filters.dateEnd) return false;
        if (filters.dayType !== 'all' && d.dayType !== filters.dayType) return false;
        return true;
      })
      .map((d) => ({
        date: d.date,
        dayLabel: d.dayLabel,
        dayType: d.dayType,
        ticketsAnalyzed: d.tickets,
        estimatedPassengers: d.passengers,
      }));

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

    obs.forEach((o) => {
      const cap = routeCapacityLookup.get(o.route_id) ?? capacityConfig.nonAcCapacity;
      const { occupancyPct, level } = classifyCrowding(o.median_load, cap, capacityConfig);
      crowdingCounts[level] += 1;

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

    // If GTFS observations exist use them; otherwise use actual hourly ticket/pax counts
    const hourlyDemand =
      obs.length > 0
        ? Array.from({ length: 19 }, (_, idx) => idx + 5).map((hr) => {
            const entry = hourObsMap.get(hr);
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
            };
          })
        : actual.hourlyDistribution
            .filter((h) => h.hourNum >= 5 && h.hourNum <= 23)
            .map((h) => ({
              hour: h.hour,
              hourNum: h.hourNum,
              avgLoad: h.passengers,
              weekdayAvg: h.passengers,
              weekendAvg: 0,
            }));

    const routeDemand =
      routeObsMap.size > 0
        ? Array.from(routeObsMap.entries())
            .map(([route, stats]) => ({
              route: `Route ${route}`,
              routeNumber: route,
              avgLoad: Math.round(stats.loadSum / Math.max(1, stats.count)),
              avgOccupancyPct: Math.round(stats.occSum / Math.max(1, stats.count)),
            }))
            .sort((a, b) => b.avgOccupancyPct - a.avgOccupancyPct)
            .slice(0, 15)
        : actual.routeVolume.slice(0, 15).map((rv) => ({
            route: rv.route,
            routeNumber: rv.routeNumber,
            avgLoad: rv.passengers,
            avgOccupancyPct: Math.min(180, Math.round((rv.passengers / Math.max(1, rv.vehicles * 50)) * 100)),
          }));

    const peakHourActual = [...actual.hourlyDistribution].sort((a, b) => b.passengers - a.passengers)[0];
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

    const targetRoute =
      filters.routeNumber === 'ALL'
        ? routeDemand[0]?.routeNumber ?? actual.routeVolume[0]?.routeNumber ?? ''
        : filters.routeNumber;
    const targetDirection = filters.direction === 'all' ? 'UP' : filters.direction;
    const segMap = new Map<number, { label: string; loadSum: number; count: number }>();
    obs
      .filter((o) => o.route_number === targetRoute && o.direction === targetDirection)
      .forEach((o) => {
        const entry = segMap.get(o.segment_order) ?? {
          label: `${o.from_stop_name.split(' ')[0]}–${o.to_stop_name.split(' ')[0]}`,
          loadSum: 0,
          count: 0,
        };
        entry.loadSum += o.median_load;
        entry.count += 1;
        segMap.set(o.segment_order, entry);
      });

    const segmentWiseLoad = Array.from(segMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => ({
        segment: v.label,
        avgLoad: Math.round(v.loadSum / Math.max(1, v.count)),
      }));

    const busiestSegments: BusiestSegmentRow[] = [...obs]
      .sort((a, b) => b.median_load - a.median_load)
      .slice(0, 12)
      .map((o) => {
        const cap = routeCapacityLookup.get(o.route_id) ?? capacityConfig.nonAcCapacity;
        const { occupancyPct, level } = classifyCrowding(o.median_load, cap, capacityConfig);
        const conf = evaluateConfidence(o);
        return {
          routeNumber: o.route_number,
          direction: o.direction,
          fromStop: o.from_stop_name,
          toStop: o.to_stop_name,
          timePeriod: `${String(o.hour).padStart(2, '0')}:00 (${o.day_type})`,
          estimatedLoad: o.median_load,
          assumedCapacity: cap,
          occupancyPct,
          crowdingLevel: level,
          confidence: conf.confidence,
        };
      });

    return {
      kpis: {
        totalTicketsAnalyzed: actual.validRecords,
        routeCount: actual.uniqueRoutes,
        estimatedJourneys: actual.totalPassengers,
        mostCrowdedRoute: mostCrowdedRoute !== 'N/A' ? `Route ${mostCrowdedRoute}` : 'N/A',
        peakTravelHour: peakHourActual?.hour ?? 'N/A',
        avgEstimatedOccupancy,
      },
      hourlyDemand,
      routeDemand,
      crowdingDistribution: (
        ['Seats Available', 'Standing Room', 'Crowded', 'Very Crowded'] as CrowdingLevel[]
      ).map((level) => ({ name: level, count: crowdingCounts[level] })),
      segmentWiseLoad,
      segmentChartRouteLabel: targetRoute ? `Route ${targetRoute} (${targetDirection})` : 'Awaiting GTFS Mapping',
      dailyTrends: filteredDaily,
      busiestSegments,
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
