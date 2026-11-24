import type {
  BalancedWeightsConfig,
  BusRoute,
  BusStop,
  CapacityConfig,
  DataMode,
  GTFSScheduledTrip,
  GTFSServiceCalendarsMap,
  JourneyLeg,
  JourneyOption,
  JourneySearchResult,
  JourneySegmentEstimate,
  JourneyTransferDetail,
  PredictionModelType,
  SearchQuery,
} from '../types/transit';
import { SAMPLE_ROUTES } from '../data/sampleRoutes';
import { STOP_MAP } from '../data/sampleStops';
import {
  CandidateLeg,
  CandidatePath,
  minutesToClockString,
  searchTimeDependentJourneys,
} from '../engine/journeyGraph';
import { classifyCrowding, DEFAULT_CAPACITY_CONFIG } from '../utils/crowdClassification';
import {
  aggregateConfidence,
  DEFAULT_BALANCED_WEIGHTS,
  scoreAndRankJourneys,
} from '../utils/routeScoring';
import {
  crowdingService,
  getDayOfWeekFromDate,
  getDayTypeFromDate,
} from './crowdingService';

function buildLegFromCandidate(
  legIndex: number,
  candLeg: CandidateLeg,
  dayType: 'weekday' | 'weekend',
  dayOfWeek: number,
  capacityConfig: CapacityConfig,
  preferredModel: PredictionModelType,
  dataMode: DataMode,
  stopLookup: Record<string, BusStop>
): JourneyLeg {
  const { trip, startIdx, endIdx } = candLeg;
  const startSt = trip.stop_times[startIdx];
  const endSt = trip.stop_times[endIdx];

  const boardingStop = stopLookup[startSt.stop_id];
  const alightingStop = stopLookup[endSt.stop_id];

  const assumedCapacity = trip.is_ac ? capacityConfig.acCapacity : capacityConfig.nonAcCapacity;
  const routeProxy: BusRoute = {
    route_id: trip.route_id,
    route_number: trip.route_number,
    route_name: trip.route_name,
    direction: trip.direction,
    direction_label: trip.direction_label,
    is_ac: trip.is_ac,
    default_capacity: assumedCapacity,
    frequency_mins: 15,
    operating_hours: trip.is_scheduled ? 'GTFS Scheduled' : '06:00 – 23:00',
    stops: trip.stop_times.map((s) => ({
      stop_id: s.stop_id,
      stop_sequence: s.stop_sequence,
      minutes_from_start: Math.max(0, s.arrival_mins - trip.stop_times[0].departure_mins),
    })),
  };

  const segments: JourneySegmentEstimate[] = [];
  const intermediateStops: JourneyLeg['intermediate_stops'] = [];

  for (let i = startIdx; i < endIdx; i++) {
    const curr = trip.stop_times[i];
    const next = trip.stop_times[i + 1];
    const segDepStr = minutesToClockString(curr.departure_mins);
    const segDuration = Math.max(1, next.arrival_mins - curr.departure_mins);

    const segEst = crowdingService.estimateSegment(
      routeProxy,
      curr.stop_id,
      next.stop_id,
      segDepStr,
      segDuration,
      dayType,
      capacityConfig,
      i + 1,
      dayOfWeek,
      preferredModel,
      dataMode,
      stopLookup,
      trip.is_scheduled
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
          arrival_time: prevSeg?.arrival_time ?? minutesToClockString(curr.arrival_mins),
          departure_time: segDepStr,
          cumulative_load: segEst.estimated_load,
          occupancy_pct: occupancyPct,
          crowding_level: level,
          has_historical_data: segEst.has_historical_data,
        });
      }
    }
  }

  const totalLegMins = Math.max(1, candLeg.alightingMins - candLeg.boardingMins);

  return {
    leg_index: legIndex,
    trip_id: trip.trip_id,
    route_id: trip.route_id,
    route_number: trip.route_number,
    route_name: trip.route_name,
    direction: trip.direction,
    direction_label: trip.direction_label,
    is_ac: trip.is_ac,
    is_scheduled: trip.is_scheduled,
    boarding_stop: boardingStop,
    alighting_stop: alightingStop,
    departure_time: minutesToClockString(candLeg.boardingMins),
    arrival_time: minutesToClockString(candLeg.alightingMins),
    duration_mins: totalLegMins,
    assumed_capacity: assumedCapacity,
    segments,
    intermediate_stops: intermediateStops,
  };
}

function summarizeCandidatePath(
  cand: CandidatePath,
  sourceId: string,
  destId: string,
  dayType: 'weekday' | 'weekend',
  dayOfWeek: number,
  capacityConfig: CapacityConfig,
  preferredModel: PredictionModelType,
  dataMode: DataMode,
  stopLookup: Record<string, BusStop>,
  isSimulated: boolean,
  usesGtfsSchedule: boolean
): JourneyOption {
  const legs: JourneyLeg[] = cand.legs.map((cLeg, idx) =>
    buildLegFromCandidate(
      idx + 1,
      cLeg,
      dayType,
      dayOfWeek,
      capacityConfig,
      preferredModel,
      dataMode,
      stopLookup
    )
  );

  const transfersDetail: JourneyTransferDetail[] = cand.transfers.map((t) => ({
    after_leg_index: t.afterLegIndex,
    from_stop: stopLookup[t.fromStopId],
    to_stop: stopLookup[t.toStopId],
    arrival_time: minutesToClockString(t.arrivalMins),
    next_departure_time: minutesToClockString(t.nextDepartureMins),
    next_route_number: t.nextRouteNumber,
    wait_mins: t.waitMins,
    is_walking_transfer: t.isWalkingTransfer,
    walk_meters: t.walkMeters,
    walk_mins: t.walkMins,
  }));

  const allSegments = legs.flatMap((l) => l.segments);
  const observedSegments = allSegments.filter((s) => s.has_historical_data !== false);
  const missingCount = allSegments.length - observedSegments.length;
  const hasMissingPredictions = missingCount > 0;

  const peakSeg =
    observedSegments.length > 0
      ? observedSegments.reduce(
          (max, seg) => (seg.occupancy_pct > max.occupancy_pct ? seg : max),
          observedSegments[0]
        )
      : allSegments[0];

  const totalObservedMins = Math.max(
    1,
    observedSegments.reduce((sum, s) => sum + s.duration_mins, 0)
  );
  const weightedAvg =
    observedSegments.length > 0
      ? Math.round(
          observedSegments.reduce((sum, s) => sum + s.occupancy_pct * s.duration_mins, 0) /
            totalObservedMins
        )
      : 0;

  const overallConfidence = aggregateConfidence(allSegments);
  let lowConfidenceWarning: string | undefined;
  if (hasMissingPredictions) {
    lowConfidenceWarning = `${missingCount} of ${allSegments.length} travelled segment${
      allSegments.length > 1 ? 's' : ''
    } lack historical ticket observations (marked "Insufficient historical data").`;
  } else if (overallConfidence === 'Low') {
    lowConfidenceWarning =
      'Low prediction confidence due to sparse historical observations or stop-mapping ambiguity.';
  }

  const idSuffix =
    cand.legs.map((l) => l.trip.route_id).join('-') +
    (cand.transfers.length > 0
      ? `-${cand.transfers.map((t) => t.fromStopId).join('-')}`
      : '');

  return {
    id: `${cand.transfers.length === 0 ? 'direct' : `xfer${cand.transfers.length}`}-${idSuffix}-${cand.departureMins}`,
    source: stopLookup[sourceId],
    destination: stopLookup[destId],
    departure_time: minutesToClockString(cand.departureMins),
    arrival_time: minutesToClockString(cand.arrivalMins),
    total_duration_mins: cand.totalDurationMins,
    transfers: cand.transfers.length,
    transfer_wait_mins: cand.totalTransferWaitMins,
    transfer_stop: transfersDetail[0]?.from_stop,
    transfers_detail: transfersDetail,
    legs,
    all_segments: allSegments,
    peak_segment_occupancy_pct: observedSegments.length > 0 ? peakSeg.occupancy_pct : 0,
    peak_crowding_level: peakSeg.crowding_level,
    weighted_avg_occupancy_pct: weightedAvg,
    overall_confidence: overallConfidence,
    has_missing_predictions: hasMissingPredictions,
    missing_prediction_segments_count: missingCount,
    low_confidence_warning: lowConfidenceWarning,
    uses_gtfs_schedule: usesGtfsSchedule,
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
  scheduledTrips?: GTFSScheduledTrip[];
  serviceCalendars?: GTFSServiceCalendarsMap;
  balancedWeights?: BalancedWeightsConfig;
  maxTransfers?: number;
}

export const journeyService = {
  searchJourneysDetailed(
    query: SearchQuery,
    capacityConfig: CapacityConfig = DEFAULT_CAPACITY_CONFIG,
    preferredModel: PredictionModelType = 'baseline-median',
    context: SearchJourneyContext = {}
  ): JourneySearchResult {
    const dataMode: DataMode = context.dataMode ?? 'demo';
    const routesToUse = dataMode === 'actual' ? context.actualRoutes ?? [] : SAMPLE_ROUTES;
    const stopsToUse =
      dataMode === 'actual'
        ? context.actualStops ?? []
        : Object.values(STOP_MAP);
    const stopLookup: Record<string, BusStop> =
      dataMode === 'actual'
        ? Object.fromEntries(stopsToUse.map((s) => [s.stop_id, s]))
        : STOP_MAP;

    const scheduledTrips =
      dataMode === 'actual' ? context.scheduledTrips : undefined;
    const serviceCalendars =
      dataMode === 'actual' ? context.serviceCalendars : undefined;

    const graphResult = searchTimeDependentJourneys({
      sourceStopId: query.sourceStopId,
      destinationStopId: query.destinationStopId,
      date: query.date,
      time: query.time,
      stops: stopsToUse,
      routes: routesToUse,
      scheduledTrips,
      serviceCalendars,
      maxTransfers: context.maxTransfers ?? 2,
    });

    if (graphResult.errorCode || graphResult.paths.length === 0) {
      return {
        journeys: [],
        errorCode: graphResult.errorCode ?? 'NO_ROUTE_FOUND',
        errorMessage:
          graphResult.errorMessage ??
          'No matching direct, 1-transfer, or 2-transfer bus journeys were found.',
        graphStats: graphResult.graphStats,
      };
    }

    const dayType = getDayTypeFromDate(query.date);
    const dayOfWeek = getDayOfWeekFromDate(query.date);
    const isSimulated = dataMode === 'demo';
    const usesGtfsSchedule = Boolean(scheduledTrips && scheduledTrips.length > 0);

    const options = graphResult.paths.map((cand) =>
      summarizeCandidatePath(
        cand,
        query.sourceStopId,
        query.destinationStopId,
        dayType,
        dayOfWeek,
        capacityConfig,
        preferredModel,
        dataMode,
        stopLookup,
        isSimulated,
        usesGtfsSchedule
      )
    );

    const ranked = scoreAndRankJourneys(
      options,
      context.balancedWeights ?? DEFAULT_BALANCED_WEIGHTS
    );

    return {
      journeys: ranked,
      graphStats: graphResult.graphStats,
    };
  },

  searchJourneys(
    query: SearchQuery,
    capacityConfig: CapacityConfig = DEFAULT_CAPACITY_CONFIG,
    preferredModel: PredictionModelType = 'baseline-median',
    context: SearchJourneyContext = {}
  ): JourneyOption[] {
    return this.searchJourneysDetailed(
      query,
      capacityConfig,
      preferredModel,
      context
    ).journeys;
  },
};
