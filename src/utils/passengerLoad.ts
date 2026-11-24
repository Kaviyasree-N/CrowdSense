import type {
  BusRoute,
  BusStop,
  ConfidenceBreakdown,
  ConfidenceLevel,
  DayType,
  ETMTicketRecord,
  HistoricalSegmentRecord,
  SegmentObservation,
} from '../types/transit.ts';
import { STOP_MAP } from '../data/sampleStops.ts';

export interface ReconstructedTripSegment {
  segmentOrder: number;
  fromStopId: string;
  toStopId: string;
  fromStopName: string;
  toStopName: string;
  boardings: number;
  alightings: number;
  runningLoad: number;
  clampedFromNegative: boolean;
}

export interface InvalidTicketEntry {
  ticketIndex: number;
  reason: string;
  ticket: Partial<ETMTicketRecord>;
}

export interface TripReconstructionResult {
  tripKey: string;
  vehicleNumber: string;
  routeNumber: string;
  routeId: string | null;
  direction: 'UP' | 'DOWN' | 'AMBIGUOUS';
  isAc: boolean;
  windowStart: string;
  windowEnd: string;
  date: string;
  hour: number;
  dayOfWeek: number;
  dayType: DayType;
  ticketCount: number;
  validMappedTickets: number;
  totalPassengers: number;
  unmatchedTickets: number;
  ambiguousDirectionTickets: number;
  invalidTicketsCount: number;
  negativeClampEvents: number;
  isAmbiguousGrouping: boolean;
  isIncompleteTrip: boolean;
  groupingExplanation: string;
  tripGroupingReliability: number;
  unmatchedStopRate: number;
  segments: ReconstructedTripSegment[];
}

export interface BatchReconstructionSummary {
  trips: TripReconstructionResult[];
  invalidTickets: InvalidTicketEntry[];
  totalInputTickets: number;
  validTicketsCount: number;
}

const STOP_ALIAS_MAP: Record<string, string> = {
  'anand vihar': 'anand vihar isbt',
  'connaught place': 'connaught place (shivaji stadium)',
  'cp': 'connaught place (shivaji stadium)',
  'shivaji stadium': 'connaught place (shivaji stadium)',
  'rajiv chowk': 'rajiv chowk metro gate',
  'ndrs': 'new delhi railway station',
  'new delhi rly stn': 'new delhi railway station',
  'kashmere gate': 'kashmere gate isbt',
  'red fort': 'red fort (lal qila)',
  'lal qila': 'red fort (lal qila)',
  'india gate': 'india gate circle',
  'aiims': 'aiims trauma & metro',
  'ina': 'ina market',
  'janakpuri': 'janakpuri district centre',
  'dwarka': 'dwarka sector 21',
  'azadpur': 'azadpur terminal',
  'pitampura': 'pitampura madhuban chowk',
  'rohini': 'rohini sector 18',
  'ito': 'ito crossing',
};

function normalizeStopName(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return STOP_ALIAS_MAP[cleaned] ?? cleaned;
}

/**
 * Matches an ETM stop string to a GTFS stop_id and stop_sequence on a given route.
 */
export function matchStopToRoute(
  rawStopName: string,
  route: BusRoute,
  stopLookup: Record<string, BusStop> = STOP_MAP
): { stopId: string; sequence: number } | null {
  const normalized = normalizeStopName(rawStopName);
  if (!normalized) return null;

  // Pass 1: exact match on full name or short name
  for (const seq of route.stops) {
    const stop = stopLookup[seq.stop_id];
    if (!stop) continue;
    const full = stop.stop_name.toLowerCase();
    const short = stop.short_name.toLowerCase();
    if (full === normalized || short === normalized) {
      return { stopId: seq.stop_id, sequence: seq.stop_sequence };
    }
  }

  // Pass 2: safe substring match
  for (const seq of route.stops) {
    const stop = stopLookup[seq.stop_id];
    if (!stop) continue;
    const full = stop.stop_name.toLowerCase();
    const short = stop.short_name.toLowerCase();
    if (full.includes(normalized) || normalized.includes(short)) {
      return { stopId: seq.stop_id, sequence: seq.stop_sequence };
    }
  }

  return null;
}

/**
 * Validates raw ETM ticket records using required fields before trip grouping.
 */
export function validateTicketRecord(
  ticket: Partial<ETMTicketRecord>
): { valid: boolean; reason?: string; parsedDate?: Date } {
  if (!ticket.vehicle_number || String(ticket.vehicle_number).trim() === '') {
    return { valid: false, reason: 'Missing vehicle_number' };
  }
  if (!ticket.route || String(ticket.route).trim() === '') {
    return { valid: false, reason: 'Missing route' };
  }
  if (!ticket.start_stop_name || String(ticket.start_stop_name).trim() === '') {
    return { valid: false, reason: 'Missing start_stop_name' };
  }
  if (!ticket.end_stop_name || String(ticket.end_stop_name).trim() === '') {
    return { valid: false, reason: 'Missing end_stop_name' };
  }
  if (
    normalizeStopName(String(ticket.start_stop_name)) ===
    normalizeStopName(String(ticket.end_stop_name))
  ) {
    return { valid: false, reason: 'start_stop_name equals end_stop_name' };
  }

  const pax = Number(ticket.passenger_count);
  if (!Number.isFinite(pax) || pax <= 0 || pax > 25) {
    return { valid: false, reason: 'Invalid passenger_count (must be 1..25)' };
  }

  const ticketType = Number(ticket.ticket_type_id);
  if (!Number.isFinite(ticketType) || ticketType < 0) {
    return { valid: false, reason: 'Invalid ticket_type_id' };
  }

  const createdStr = String(ticket.created_at ?? '').trim();
  const parsedDate = new Date(createdStr.replace(' ', 'T'));
  if (!createdStr || Number.isNaN(parsedDate.getTime())) {
    return { valid: false, reason: 'Unparseable created_at timestamp' };
  }

  return { valid: true, parsedDate };
}

function inferTicketDirection(
  ticket: ETMTicketRecord,
  candidateRoutes: BusRoute[],
  stopLookup: Record<string, BusStop> = STOP_MAP
): 'UP' | 'DOWN' | 'UNKNOWN' {
  const matchedDirs: ('UP' | 'DOWN')[] = [];
  for (const r of candidateRoutes) {
    const start = matchStopToRoute(ticket.start_stop_name, r, stopLookup);
    const end = matchStopToRoute(ticket.end_stop_name, r, stopLookup);
    if (start && end && start.sequence < end.sequence) {
      matchedDirs.push(r.direction);
    }
  }
  if (matchedDirs.length === 1) return matchedDirs[0];
  return 'UNKNOWN';
}

/**
 * Explainable Trip Identification Strategy:
 * Does NOT assume (vehicle_number, route) uniquely identifies a trip.
 * Instead:
 *  1. Sorts valid tickets chronologically per (vehicle_number, route).
 *  2. Splits trips whenever consecutive ticket gap exceeds gapThresholdMins (default 45 min).
 *  3. Splits trips on clear GTFS direction reversals (UP -> DOWN or DOWN -> UP).
 *  4. Computes segment load via Load[s] = max(0, Load[s-1] + Boarding[s] - Alighting[s]).
 *  5. Flags ambiguous trip groupings and incomplete trip segments.
 */
export function reconstructTripsDetailed(
  tickets: ETMTicketRecord[],
  routes: BusRoute[],
  gapThresholdMins = 45,
  stopLookup: Record<string, BusStop> = STOP_MAP
): BatchReconstructionSummary {
  const invalidTickets: InvalidTicketEntry[] = [];
  const validEntries: { ticket: ETMTicketRecord; parsedDate: Date }[] = [];

  tickets.forEach((ticket, idx) => {
    const check = validateTicketRecord(ticket);
    if (!check.valid || !check.parsedDate) {
      invalidTickets.push({
        ticketIndex: idx,
        reason: check.reason ?? 'Invalid record',
        ticket,
      });
    } else {
      validEntries.push({ ticket, parsedDate: check.parsedDate });
    }
  });

  // Group chronologically per vehicle + route
  const vehicleRouteBuckets = new Map<string, { ticket: ETMTicketRecord; parsedDate: Date }[]>();
  validEntries.forEach((entry) => {
    const vrKey = `${entry.ticket.vehicle_number.trim().toUpperCase()}|${entry.ticket.route
      .trim()
      .toUpperCase()}`;
    const list = vehicleRouteBuckets.get(vrKey) ?? [];
    list.push(entry);
    vehicleRouteBuckets.set(vrKey, list);
  });

  const trips: TripReconstructionResult[] = [];

  vehicleRouteBuckets.forEach((entries, vrKey) => {
    entries.sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());
    const [vehicleNumber, routeNumber] = vrKey.split('|');
    const candidateRoutes = routes.filter(
      (r) => r.route_number.toUpperCase() === routeNumber
    );

    // Split into chronological trip clusters using time-gap + direction-reversal detection
    const clusters: { ticket: ETMTicketRecord; parsedDate: Date }[][] = [];
    let currentCluster: { ticket: ETMTicketRecord; parsedDate: Date }[] = [];
    let currentDominantDir: 'UP' | 'DOWN' | 'UNKNOWN' = 'UNKNOWN';

    entries.forEach((entry) => {
      if (currentCluster.length === 0) {
        currentCluster.push(entry);
        currentDominantDir = inferTicketDirection(entry.ticket, candidateRoutes, stopLookup);
        return;
      }

      const prev = currentCluster[currentCluster.length - 1];
      const gapMins = (entry.parsedDate.getTime() - prev.parsedDate.getTime()) / (1000 * 60);
      const entryDir = inferTicketDirection(entry.ticket, candidateRoutes, stopLookup);
      const directionReversed =
        currentDominantDir !== 'UNKNOWN' &&
        entryDir !== 'UNKNOWN' &&
        entryDir !== currentDominantDir;

      if (gapMins > gapThresholdMins || (directionReversed && gapMins >= 12)) {
        clusters.push(currentCluster);
        currentCluster = [entry];
        currentDominantDir = entryDir;
      } else {
        currentCluster.push(entry);
        if (currentDominantDir === 'UNKNOWN' && entryDir !== 'UNKNOWN') {
          currentDominantDir = entryDir;
        }
      }
    });

    if (currentCluster.length > 0) {
      clusters.push(currentCluster);
    }

    clusters.forEach((cluster, clusterIdx) => {
      const firstDate = cluster[0].parsedDate;
      const lastDate = cluster[cluster.length - 1].parsedDate;
      const dateStr = `${firstDate.getFullYear()}-${String(firstDate.getMonth() + 1).padStart(
        2,
        '0'
      )}-${String(firstDate.getDate()).padStart(2, '0')}`;
      const startTimeStr = `${String(firstDate.getHours()).padStart(2, '0')}:${String(
        firstDate.getMinutes()
      ).padStart(2, '0')}`;
      const endTimeStr = `${String(lastDate.getHours()).padStart(2, '0')}:${String(
        lastDate.getMinutes()
      ).padStart(2, '0')}`;
      const dow = firstDate.getDay();
      const dayType: DayType = dow === 0 || dow === 6 ? 'weekend' : 'weekday';
      const tripKey = `${vehicleNumber}|${routeNumber}|${dateStr} ${startTimeStr}#${clusterIdx + 1}`;
      const totalPassengers = cluster.reduce(
        (sum, e) => sum + Math.round(Number(e.ticket.passenger_count)),
        0
      );

      if (candidateRoutes.length === 0) {
        trips.push({
          tripKey,
          vehicleNumber,
          routeNumber,
          routeId: null,
          direction: 'AMBIGUOUS',
          isAc: Boolean(cluster[0].ticket.is_ac),
          windowStart: `${dateStr} ${startTimeStr}`,
          windowEnd: `${dateStr} ${endTimeStr}`,
          date: dateStr,
          hour: firstDate.getHours(),
          dayOfWeek: dow,
          dayType,
          ticketCount: cluster.length,
          validMappedTickets: 0,
          totalPassengers,
          unmatchedTickets: cluster.length,
          ambiguousDirectionTickets: 0,
          invalidTicketsCount: 0,
          negativeClampEvents: 0,
          isAmbiguousGrouping: true,
          isIncompleteTrip: true,
          groupingExplanation: `Route "${routeNumber}" was not found in static GTFS route definitions.`,
          tripGroupingReliability: 0.2,
          unmatchedStopRate: 1,
          segments: [],
        });
        return;
      }

      // Score candidate directions (UP vs DOWN) by passenger-weighted stop order consistency
      let bestRoute = candidateRoutes[0];
      let bestVotes = -1;
      let runnerUpVotes = 0;

      const voteCounts = candidateRoutes.map((candidate) => {
        let votes = 0;
        cluster.forEach(({ ticket }) => {
          const s = matchStopToRoute(ticket.start_stop_name, candidate, stopLookup);
          const e = matchStopToRoute(ticket.end_stop_name, candidate, stopLookup);
          if (s && e && s.sequence < e.sequence) {
            votes += Number(ticket.passenger_count) || 1;
          }
        });
        return { candidate, votes };
      });

      voteCounts.sort((a, b) => b.votes - a.votes);
      bestRoute = voteCounts[0].candidate;
      bestVotes = voteCounts[0].votes;
      runnerUpVotes = voteCounts[1]?.votes ?? 0;

      const boardingsAtSeq = new Map<number, number>();
      const alightingsAtSeq = new Map<number, number>();
      let unmatchedTickets = 0;
      let ambiguousDirectionTickets = 0;
      let validMappedTickets = 0;

      cluster.forEach(({ ticket }) => {
        const pax = Math.max(1, Math.round(Number(ticket.passenger_count)));
        const startMatch = matchStopToRoute(ticket.start_stop_name, bestRoute, stopLookup);
        const endMatch = matchStopToRoute(ticket.end_stop_name, bestRoute, stopLookup);

        if (!startMatch || !endMatch) {
          unmatchedTickets += 1;
          return;
        }
        if (startMatch.sequence >= endMatch.sequence) {
          ambiguousDirectionTickets += 1;
          return;
        }

        validMappedTickets += 1;
        boardingsAtSeq.set(
          startMatch.sequence,
          (boardingsAtSeq.get(startMatch.sequence) ?? 0) + pax
        );
        alightingsAtSeq.set(
          endMatch.sequence,
          (alightingsAtSeq.get(endMatch.sequence) ?? 0) + pax
        );
      });

      const segments: ReconstructedTripSegment[] = [];
      let runningLoad = 0;
      let negativeClampEvents = 0;

      for (let i = 0; i < bestRoute.stops.length - 1; i++) {
        const fromSeq = bestRoute.stops[i];
        const toSeq = bestRoute.stops[i + 1];
        const fromStop = stopLookup[fromSeq.stop_id];
        const toStop = stopLookup[toSeq.stop_id];

        const boardings = boardingsAtSeq.get(fromSeq.stop_sequence) ?? 0;
        const alightings = alightingsAtSeq.get(fromSeq.stop_sequence) ?? 0;
        const rawLoad = runningLoad + boardings - alightings;
        const clamped = rawLoad < 0;
        if (clamped) negativeClampEvents += 1;
        runningLoad = Math.max(0, rawLoad);

        segments.push({
          segmentOrder: i + 1,
          fromStopId: fromSeq.stop_id,
          toStopId: toSeq.stop_id,
          fromStopName: fromStop?.stop_name ?? fromSeq.stop_id,
          toStopName: toStop?.stop_name ?? toSeq.stop_id,
          boardings,
          alightings,
          runningLoad,
          clampedFromNegative: clamped,
        });
      }

      const spanMins = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60);
      const expectedDuration =
        bestRoute.stops[bestRoute.stops.length - 1]?.minutes_from_start ?? 60;
      const unmatchedStopRate =
        cluster.length > 0 ? Number((unmatchedTickets / cluster.length).toFixed(2)) : 1;

      const hasMixedDirection = runnerUpVotes > 0 && ambiguousDirectionTickets > 0;
      const excessiveSpan = spanMins > expectedDuration + 35;
      const isIncompleteTrip = validMappedTickets < 2 || negativeClampEvents > 0;
      const isAmbiguousGrouping =
        bestVotes <= 0 || hasMixedDirection || excessiveSpan || unmatchedStopRate > 0.25;

      let reliability = 0.95;
      if (hasMixedDirection) reliability -= 0.22;
      if (excessiveSpan) reliability -= 0.18;
      if (isIncompleteTrip) reliability -= 0.15;
      reliability -= Math.min(0.3, unmatchedStopRate * 0.6);
      reliability = Math.max(0.25, Number(reliability.toFixed(2)));

      const reasons: string[] = [];
      if (bestVotes <= 0) reasons.push('no forward GTFS stop pairs matched');
      if (hasMixedDirection)
        reasons.push(`${ambiguousDirectionTickets} reverse/opposing tickets inside window`);
      if (excessiveSpan)
        reasons.push(`span (${Math.round(spanMins)}m) exceeds route runtime (${expectedDuration}m)`);
      if (unmatchedTickets > 0) reasons.push(`${unmatchedTickets} unmapped stop tickets`);
      if (validMappedTickets < 2) reasons.push('fewer than 2 mapped boarding-alighting tickets');

      const groupingExplanation =
        reasons.length === 0
          ? `Clean ${bestRoute.direction} trip grouped via 45m layover & sequence check (${validMappedTickets} mapped tickets).`
          : `Flagged (${reasons.join('; ')}).`;

      trips.push({
        tripKey,
        vehicleNumber,
        routeNumber,
        routeId: bestRoute.route_id,
        direction: bestVotes > 0 ? bestRoute.direction : 'AMBIGUOUS',
        isAc: Boolean(cluster[0].ticket.is_ac),
        windowStart: `${dateStr} ${startTimeStr}`,
        windowEnd: `${dateStr} ${endTimeStr}`,
        date: dateStr,
        hour: firstDate.getHours(),
        dayOfWeek: dow,
        dayType,
        ticketCount: cluster.length,
        validMappedTickets,
        totalPassengers,
        unmatchedTickets,
        ambiguousDirectionTickets,
        invalidTicketsCount: 0,
        negativeClampEvents,
        isAmbiguousGrouping,
        isIncompleteTrip,
        groupingExplanation,
        tripGroupingReliability: reliability,
        unmatchedStopRate,
        segments,
      });
    });
  });

  return {
    trips,
    invalidTickets,
    totalInputTickets: tickets.length,
    validTicketsCount: validEntries.length,
  };
}

/**
 * Backward-compatible helper returning reconstructed trips directly.
 */
export function reconstructTripsFromTickets(
  tickets: ETMTicketRecord[],
  routes: BusRoute[]
): TripReconstructionResult[] {
  return reconstructTripsDetailed(tickets, routes).trips;
}

/**
 * Converts reconstructed bus trips into segment-level HistoricalSegmentRecord rows
 * ready for baseline median / Random Forest training and chronological evaluation.
 */
export function tripsToHistoricalSegmentRecords(
  trips: TripReconstructionResult[],
  isSimulated: boolean
): HistoricalSegmentRecord[] {
  const records: HistoricalSegmentRecord[] = [];

  trips.forEach((trip) => {
    if (!trip.routeId || trip.direction === 'AMBIGUOUS' || trip.segments.length === 0) {
      return;
    }

    const dayNum = Number(trip.date.split('-')[2]) || 1;
    const weekNumber = Math.min(4, Math.max(1, Math.ceil(dayNum / 7)));
    const missingDataRate =
      trip.ticketCount > 0
        ? Number(((trip.unmatchedTickets + trip.ambiguousDirectionTickets) / trip.ticketCount).toFixed(2))
        : 0;

    trip.segments.forEach((seg) => {
      records.push({
        route_id: trip.routeId!,
        route_number: trip.routeNumber,
        direction: trip.direction as 'UP' | 'DOWN',
        from_stop_id: seg.fromStopId,
        to_stop_id: seg.toStopId,
        segment_order: seg.segmentOrder,
        date: trip.date,
        week_number: weekNumber,
        hour: trip.hour,
        day_of_week: trip.dayOfWeek,
        day_type: trip.dayType,
        is_ac: trip.isAc,
        observed_load: seg.runningLoad,
        unmatched_stop_rate: trip.unmatchedStopRate,
        trip_grouping_reliability: trip.tripGroupingReliability,
        missing_data_rate: missingDataRate,
        is_simulated: isSimulated,
      });
    });
  });

  return records;
}

/**
 * Deterministic, multi-factor prediction confidence scoring using:
 *  - Number of historical observations
 *  - Consistency across weeks (1 - weekly_cv)
 *  - Missing data rate
 *  - GTFS stop matching quality (1 - unmatched_stop_rate)
 *  - Trip grouping reliability
 */
export function evaluateConfidence(obs: SegmentObservation): {
  confidence: ConfidenceLevel;
  reason: string;
  breakdown: ConfidenceBreakdown;
} {
  const missingRate = obs.missing_data_rate ?? 0.03;
  const breakdown: ConfidenceBreakdown = {
    observationsCount: obs.observations_count,
    weeklyConsistencyPct: Math.max(0, Math.round((1 - obs.weekly_cv) * 100)),
    missingDataRatePct: Math.max(0, Math.round(missingRate * 100)),
    stopMatchQualityPct: Math.max(0, Math.round((1 - obs.unmatched_stop_rate) * 100)),
    tripGroupingReliabilityPct: Math.max(0, Math.round(obs.trip_grouping_reliability * 100)),
  };

  if (
    obs.observations_count >= 35 &&
    obs.weekly_cv <= 0.2 &&
    obs.unmatched_stop_rate <= 0.06 &&
    obs.trip_grouping_reliability >= 0.85 &&
    missingRate <= 0.08
  ) {
    return {
      confidence: 'High',
      reason: `${obs.observations_count} trips observed · ${breakdown.weeklyConsistencyPct}% weekly consistency · ${breakdown.stopMatchQualityPct}% GTFS stop match`,
      breakdown,
    };
  }

  if (
    obs.observations_count >= 15 &&
    obs.weekly_cv <= 0.28 &&
    obs.trip_grouping_reliability >= 0.72 &&
    obs.unmatched_stop_rate <= 0.14 &&
    missingRate <= 0.18
  ) {
    return {
      confidence: 'Medium',
      reason: `${obs.observations_count} trips observed · ${breakdown.weeklyConsistencyPct}% weekly consistency · ${breakdown.tripGroupingReliabilityPct}% trip grouping reliability`,
      breakdown,
    };
  }

  const weakFactors: string[] = [];
  if (obs.observations_count < 15) weakFactors.push(`only ${obs.observations_count} trips observed`);
  if (obs.weekly_cv > 0.28) weakFactors.push(`high weekly variance (${Math.round(obs.weekly_cv * 100)}% CV)`);
  if (obs.unmatched_stop_rate > 0.14) weakFactors.push(`${Math.round(obs.unmatched_stop_rate * 100)}% unmapped stops`);
  if (obs.trip_grouping_reliability < 0.72) weakFactors.push(`${breakdown.tripGroupingReliabilityPct}% trip reliability`);
  if (missingRate > 0.18) weakFactors.push(`${breakdown.missingDataRatePct}% missing data`);

  return {
    confidence: 'Low',
    reason: weakFactors.length > 0 ? weakFactors.join(' · ') : 'Insufficient historical support',
    breakdown,
  };
}
