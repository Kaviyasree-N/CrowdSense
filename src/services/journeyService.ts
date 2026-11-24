import {
  BusRoute,
  BusStop,
  CapacityConfig,
  DataMode,
  JourneyLeg,
  JourneyOption,
  JourneySegmentEstimate,
  PredictionModelType,
  SearchQuery,
} from '../types/transit';
import { SAMPLE_ROUTES } from '../data/sampleRoutes';
import { STOP_MAP } from '../data/sampleStops';
import { classifyCrowding, DEFAULT_CAPACITY_CONFIG } from '../utils/crowdClassification';
import { aggregateConfidence, scoreAndRankJourneys } from '../utils/routeScoring';
import {
  addMinutesToTime,
  crowdingService,
  getDayOfWeekFromDate,
  getDayTypeFromDate,
} from './crowdingService';

function buildLeg(
  legIndex: number,
  route: BusRoute,
  startIdx: number,
  endIdx: number,
  legDepartureTime: string,
  dayType: 'weekday' | 'weekend',
  dayOfWeek: number,
  capacityConfig: CapacityConfig,
  preferredModel: PredictionModelType,
  dataMode: DataMode,
  stopLookup: Record<string, BusStop>
): JourneyLeg {
  const startStopSeq = route.stops[startIdx];
  const endStopSeq = route.stops[endIdx];
  const boardingStop = stopLookup[startStopSeq.stop_id];
  const alightingStop = stopLookup[endStopSeq.stop_id];

  const baseOffset = startStopSeq.minutes_from_start;
  const totalLegMins = Math.max(2, endStopSeq.minutes_from_start - baseOffset);
  const assumedCapacity = route.is_ac ? capacityConfig.acCapacity : capacityConfig.nonAcCapacity;

  const segments: JourneySegmentEstimate[] = [];
  const intermediateStops: JourneyLeg['intermediate_stops'] = [];

  for (let i = startIdx; i < endIdx; i++) {
    const curr = route.stops[i];
    const next = route.stops[i + 1];
    const segDepTime = addMinutesToTime(legDepartureTime, curr.minutes_from_start - baseOffset);
    const segDuration = Math.max(1, next.minutes_from_start - curr.minutes_from_start);

    const segEst = crowdingService.estimateSegment(
      route,
      curr.stop_id,
      next.stop_id,
      segDepTime,
      segDuration,
      dayType,
      capacityConfig,
      i + 1,
      dayOfWeek,
      preferredModel,
      dataMode,
      stopLookup
    );
    segments.push(segEst);

    if (i > startIdx) {
      const prevSeg = segments[segments.length - 2];
      const stopObj = stopLookup[curr.stop_id];
      const { occupancyPct, level } = classifyCrowding(
        segEst.estimated_load,
        assumedCapacity,
        capacityConfig
      );
      if (stopObj) {
        intermediateStops.push({
          stop: stopObj,
          arrival_time: prevSeg?.arrival_time ?? segDepTime,
          departure_time: segDepTime,
          cumulative_load: segEst.estimated_load,
          occupancy_pct: occupancyPct,
          crowding_level: level,
        });
      }
    }
  }

  return {
    leg_index: legIndex,
    route_id: route.route_id,
    route_number: route.route_number,
    route_name: route.route_name,
    direction: route.direction,
    direction_label: route.direction_label,
    is_ac: route.is_ac,
    boarding_stop: boardingStop,
    alighting_stop: alightingStop,
    departure_time: legDepartureTime,
    arrival_time: addMinutesToTime(legDepartureTime, totalLegMins),
    duration_mins: totalLegMins,
    assumed_capacity: assumedCapacity,
    segments,
    intermediate_stops: intermediateStops,
  };
}

function summarizeOption(
  id: string,
  sourceId: string,
  destId: string,
  legs: JourneyLeg[],
  transferWaitMins: number,
  stopLookup: Record<string, BusStop>,
  isSimulated: boolean,
  transferStopId?: string
): JourneyOption {
  const allSegments = legs.flatMap((l) => l.segments);
  const totalDuration =
    legs.reduce((sum, l) => sum + l.duration_mins, 0) + transferWaitMins;
  const peakSeg = allSegments.reduce(
    (max, seg) => (seg.occupancy_pct > max.occupancy_pct ? seg : max),
    allSegments[0]
  );

  const totalSegMins = Math.max(
    1,
    allSegments.reduce((sum, s) => sum + s.duration_mins, 0)
  );
  const weightedAvg = Math.round(
    allSegments.reduce((sum, s) => sum + s.occupancy_pct * s.duration_mins, 0) / totalSegMins
  );

  return {
    id,
    source: stopLookup[sourceId],
    destination: stopLookup[destId],
    departure_time: legs[0].departure_time,
    arrival_time: legs[legs.length - 1].arrival_time,
    total_duration_mins: totalDuration,
    transfers: Math.max(0, legs.length - 1),
    transfer_wait_mins: transferWaitMins,
    transfer_stop: transferStopId ? stopLookup[transferStopId] : undefined,
    legs,
    all_segments: allSegments,
    peak_segment_occupancy_pct: peakSeg.occupancy_pct,
    peak_crowding_level: peakSeg.crowding_level,
    weighted_avg_occupancy_pct: weightedAvg,
    overall_confidence: aggregateConfidence(allSegments),
    recommendation_tags: [],
    recommendation_reason: '',
    fastest_score: 0,
    comfort_score: 0,
    balanced_score: 0,
    is_simulated: isSimulated,
  };
}

export interface SearchJourneyContext {
  dataMode?: DataMode;
  actualRoutes?: BusRoute[];
  actualStops?: BusStop[];
}

export const journeyService = {
  searchJourneys(
    query: SearchQuery,
    capacityConfig: CapacityConfig = DEFAULT_CAPACITY_CONFIG,
    preferredModel: PredictionModelType = 'baseline-median',
    context: SearchJourneyContext = {}
  ): JourneyOption[] {
    const dataMode: DataMode = context.dataMode ?? 'demo';
    const routesToUse = dataMode === 'actual' ? context.actualRoutes ?? [] : SAMPLE_ROUTES;
    const stopLookup: Record<string, BusStop> =
      dataMode === 'actual'
        ? Object.fromEntries((context.actualStops ?? []).map((s) => [s.stop_id, s]))
        : STOP_MAP;

    const { sourceStopId, destinationStopId, date, time } = query;
    if (
      !sourceStopId ||
      !destinationStopId ||
      sourceStopId === destinationStopId ||
      routesToUse.length === 0 ||
      !stopLookup[sourceStopId] ||
      !stopLookup[destinationStopId]
    ) {
      return [];
    }

    const dayType = getDayTypeFromDate(date);
    const dayOfWeek = getDayOfWeekFromDate(date);
    const options: JourneyOption[] = [];
    const seenKeys = new Set<string>();
    const isSimulated = dataMode === 'demo';

    // 1. Direct routes
    routesToUse.forEach((route, idx) => {
      const startIdx = route.stops.findIndex((s) => s.stop_id === sourceStopId);
      const endIdx = route.stops.findIndex((s) => s.stop_id === destinationStopId);

      if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
        const waitOffset = (idx % 3) * 3 + 2;
        const depTime = addMinutesToTime(time, waitOffset);
        const leg = buildLeg(
          1,
          route,
          startIdx,
          endIdx,
          depTime,
          dayType,
          dayOfWeek,
          capacityConfig,
          preferredModel,
          dataMode,
          stopLookup
        );
        const opt = summarizeOption(
          `direct-${route.route_id}`,
          sourceStopId,
          destinationStopId,
          [leg],
          0,
          stopLookup,
          isSimulated
        );
        seenKeys.add(route.route_number);
        options.push(opt);
      }
    });

    // 2. Single-transfer journeys (cap search budget for huge GTFS graphs)
    const routesWithSource = routesToUse.filter((r) =>
      r.stops.some((s) => s.stop_id === sourceStopId)
    );
    const routesWithDest = routesToUse.filter((r) =>
      r.stops.some((s) => s.stop_id === destinationStopId)
    );

    for (const routeA of routesWithSource) {
      const startA = routeA.stops.findIndex((s) => s.stop_id === sourceStopId);
      if (startA === -1) continue;

      for (let tIdxA = startA + 1; tIdxA < routeA.stops.length; tIdxA++) {
        const transferStopId = routeA.stops[tIdxA].stop_id;
        if (transferStopId === destinationStopId) continue;

        for (const routeB of routesWithDest) {
          if (routeB.route_number === routeA.route_number) continue;
          const startB = routeB.stops.findIndex((s) => s.stop_id === transferStopId);
          const endB = routeB.stops.findIndex((s) => s.stop_id === destinationStopId);

          if (startB !== -1 && endB !== -1 && startB < endB) {
            const pairKey = `${routeA.route_number}->${routeB.route_number}@${transferStopId}`;
            if (seenKeys.has(pairKey)) continue;

            const leg1Dep = addMinutesToTime(time, 4);
            const leg1 = buildLeg(
              1,
              routeA,
              startA,
              tIdxA,
              leg1Dep,
              dayType,
              dayOfWeek,
              capacityConfig,
              preferredModel,
              dataMode,
              stopLookup
            );
            const transferWait = 6;
            const leg2Dep = addMinutesToTime(leg1.arrival_time, transferWait);
            const leg2 = buildLeg(
              2,
              routeB,
              startB,
              endB,
              leg2Dep,
              dayType,
              dayOfWeek,
              capacityConfig,
              preferredModel,
              dataMode,
              stopLookup
            );

            const opt = summarizeOption(
              `xfer-${routeA.route_id}-${routeB.route_id}-${transferStopId}`,
              sourceStopId,
              destinationStopId,
              [leg1, leg2],
              transferWait,
              stopLookup,
              isSimulated,
              transferStopId
            );

            seenKeys.add(pairKey);
            options.push(opt);
            if (options.length >= 16) break;
          }
        }
        if (options.length >= 16) break;
      }
      if (options.length >= 16) break;
    }

    const directOpts = options.filter((o) => o.transfers === 0);
    const transferOpts = options
      .filter((o) => o.transfers === 1)
      .sort((a, b) => a.total_duration_mins - b.total_duration_mins);

    const combined = [...directOpts];
    for (const tOpt of transferOpts) {
      if (combined.length >= 5) break;
      const dominated = combined.some(
        (existing) =>
          existing.total_duration_mins <= tOpt.total_duration_mins &&
          existing.peak_segment_occupancy_pct <= tOpt.peak_segment_occupancy_pct &&
          existing.transfers <= tOpt.transfers
      );
      if (!dominated || combined.length < 3) {
        combined.push(tOpt);
      }
    }

    return scoreAndRankJourneys(combined);
  },
};
