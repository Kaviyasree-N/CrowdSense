import type { NetworkMapSegment } from '../components/RouteMap';
import { crowdingService } from './crowdingService';
import type {
  BusRoute,
  BusStop,
  CapacityConfig,
  CrowdingLevel,
  DataMode,
  DayType,
  PredictionModelType,
} from '../types/transit';

export type MapCrowdingCategoryFilter =
  | 'ALL'
  | CrowdingLevel
  | 'Insufficient Data';

/**
 * Derives weekday vs weekend from an ISO YYYY-MM-DD date string.
 * Falls back to 'weekday' if invalid.
 */
export function deriveDayTypeFromDate(dateStr: string): {
  dayType: DayType;
  dayOfWeek: number;
} {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return { dayType: 'weekday', dayOfWeek: 3 };
  }
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) {
    return { dayType: 'weekday', dayOfWeek: 3 };
  }
  const dayOfWeek = dt.getUTCDay();
  return {
    dayType: dayOfWeek === 0 || dayOfWeek === 6 ? 'weekend' : 'weekday',
    dayOfWeek,
  };
}

export interface BuildMapSegmentsParams {
  routes: BusRoute[];
  stopLookup: Record<string, BusStop>;
  selectedHour: number;
  dayType: DayType;
  dayOfWeek?: number;
  routeFilter: string;
  directionFilter: 'ALL' | 'UP' | 'DOWN';
  crowdingFilter?: MapCrowdingCategoryFilter;
  capacityConfig: CapacityConfig;
  preferredModel: PredictionModelType;
  dataMode: DataMode;
  maxRoutesWhenAll?: number;
}

/**
 * Builds crowding-annotated route segments strictly from active GTFS/prototype routes
 * and the prediction engine without inventing coordinates or geometry.
 */
export function buildMapNetworkSegments({
  routes,
  stopLookup,
  selectedHour,
  dayType,
  dayOfWeek,
  routeFilter,
  directionFilter,
  crowdingFilter = 'ALL',
  capacityConfig,
  preferredModel,
  dataMode,
  maxRoutesWhenAll = 40,
}: BuildMapSegmentsParams): NetworkMapSegment[] {
  const depTimeStr = `${String(selectedHour).padStart(2, '0')}:00`;
  const effectiveDow = dayOfWeek ?? (dayType === 'weekend' ? 6 : 3);
  const segments: NetworkMapSegment[] = [];

  const filteredRoutes = routes.filter((route) => {
    if (routeFilter !== 'ALL' && route.route_number !== routeFilter) return false;
    if (directionFilter !== 'ALL' && route.direction !== directionFilter) return false;
    return true;
  });

  const routesToRender =
    routeFilter === 'ALL' ? filteredRoutes.slice(0, maxRoutesWhenAll) : filteredRoutes;

  routesToRender.forEach((route) => {
    for (let i = 0; i < route.stops.length - 1; i++) {
      const curr = route.stops[i];
      const next = route.stops[i + 1];
      const fromStop = stopLookup[curr.stop_id];
      const toStop = stopLookup[next.stop_id];
      if (!fromStop || !toStop) continue;

      const duration = Math.max(1, next.minutes_from_start - curr.minutes_from_start);
      const est = crowdingService.estimateSegment(
        route,
        curr.stop_id,
        next.stop_id,
        depTimeStr,
        duration,
        dayType,
        capacityConfig,
        i + 1,
        effectiveDow,
        preferredModel,
        dataMode,
        stopLookup
      );

      const hasHistorical = est.has_historical_data !== false;
      if (crowdingFilter !== 'ALL') {
        if (crowdingFilter === 'Insufficient Data') {
          if (hasHistorical) continue;
        } else {
          if (!hasHistorical || est.crowding_level !== crowdingFilter) continue;
        }
      }

      segments.push({
        id: `${route.route_id}-${curr.stop_id}-${next.stop_id}`,
        routeId: route.route_id,
        routeNumber: route.route_number,
        direction: route.direction,
        directionLabel: route.direction_label,
        fromStop,
        toStop,
        estimatedLoad: est.estimated_load,
        assumedCapacity: est.assumed_capacity,
        occupancyPct: est.occupancy_pct,
        crowdingLevel: est.crowding_level,
        confidence: est.confidence,
        observationsCount: est.observations_count,
        hasHistoricalData: est.has_historical_data,
        predictionExplanation: est.prediction_explanation,
      });
    }
  });

  return segments;
}

export function getCrowdingCategoryColorHex(
  crowdingLevel: CrowdingLevel,
  hasHistoricalData: boolean = true
): string {
  if (!hasHistoricalData) return '#94A3B8';
  switch (crowdingLevel) {
    case 'Seats Available':
      return '#16A34A';
    case 'Standing Room':
      return '#EAB308';
    case 'Crowded':
      return '#EA580C';
    case 'Very Crowded':
      return '#DC2626';
  }
}
