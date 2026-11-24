import type {
  BusRoute,
  BusStop,
  GTFSScheduledTrip,
  GTFSServiceCalendarsMap,
  JourneySearchErrorCode,
} from '../types/transit.ts';
import { isServiceActiveOnDate, parseGtfsTimeToMinutes } from './gtfsProcessor.ts';

export interface GraphTrip {
  trip_id: string;
  route_id: string;
  route_number: string;
  route_name: string;
  direction: 'UP' | 'DOWN';
  direction_label: string;
  is_ac: boolean;
  default_capacity: number;
  is_scheduled: boolean;
  stop_times: {
    stop_id: string;
    stop_sequence: number;
    arrival_mins: number;
    departure_mins: number;
  }[];
}

export interface WalkingLink {
  toStopId: string;
  walkMeters: number;
  walkMins: number;
}

export interface TransitGraph {
  stopMap: Record<string, BusStop>;
  trips: GraphTrip[];
  stopToTrips: Map<string, { tripIndex: number; stopIndex: number }[]>;
  walkingLinks: Map<string, WalkingLink[]>;
  directedEdgesCount: number;
  walkingLinksCount: number;
  usesGtfsSchedule: boolean;
  totalTripsBeforeCalendarFilter: number;
}

export interface CandidateTransferStep {
  afterLegIndex: number;
  fromStopId: string;
  toStopId: string;
  arrivalMins: number;
  nextDepartureMins: number;
  nextRouteNumber: string;
  waitMins: number;
  isWalkingTransfer: boolean;
  walkMeters?: number;
  walkMins?: number;
}

export interface CandidateLeg {
  trip: GraphTrip;
  startIdx: number;
  endIdx: number;
  boardingMins: number;
  alightingMins: number;
}

export interface CandidatePath {
  legs: CandidateLeg[];
  transfers: CandidateTransferStep[];
  departureMins: number;
  arrivalMins: number;
  totalDurationMins: number;
  totalTransferWaitMins: number;
}

export interface GraphSearchOutput {
  paths: CandidatePath[];
  errorCode?: JourneySearchErrorCode;
  errorMessage?: string;
  graphStats: {
    stopsCount: number;
    activeTripsCount: number;
    directedEdgesCount: number;
    walkingLinksCount: number;
  };
}

const MAX_WALK_METERS = 350;
const MIN_WALK_METERS = 10;
const WALK_SPEED_MPS = 1.2;
const MIN_SAME_STOP_TRANSFER_MINS = 4;
const MAX_TRANSFER_WAIT_MINS = 45;
const MAX_BOARDING_WAIT_WINDOW_MINS = 120;

export function parseClockTimeToMinutes(timeStr: string): number | null {
  const trimmed = timeStr.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return h * 60 + m;
}

export function isValidIsoDate(dateStr: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function minutesToClockString(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(normalized / 60)).padStart(2, '0');
  const mm = String(normalized % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function hasRealCoordinates(stop: BusStop | undefined): boolean {
  if (!stop) return false;
  if (stop.hasValidCoordinates === false) return false;
  if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return false;
  if (stop.lat === 0 && stop.lng === 0) return false;
  return stop.lat >= -90 && stop.lat <= 90 && stop.lng >= -180 && stop.lng <= 180;
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseOperatingWindow(operatingHours: string): [number, number] {
  const parts = operatingHours.split(/[–-]/).map((p) => p.trim());
  if (parts.length === 2) {
    const start = parseGtfsTimeToMinutes(parts[0]);
    const end = parseGtfsTimeToMinutes(parts[1]);
    if (start !== null && end !== null && end > start) {
      return [start, end];
    }
  }
  return [5 * 60 + 30, 23 * 60];
}

function synthesizeFrequencyTrips(
  routes: BusRoute[],
  searchMins: number
): GraphTrip[] {
  const trips: GraphTrip[] = [];
  const windowEnd = searchMins + MAX_BOARDING_WAIT_WINDOW_MINS;

  routes.forEach((route, rIdx) => {
    if (route.stops.length < 2) return;
    const [opStart, opEnd] = parseOperatingWindow(route.operating_hours);
    const freq = Math.max(5, route.frequency_mins || 15);
    const phase = (rIdx % 3) * 3 + 2;

    // Generate departures around the search window within operating hours
    for (let firstStopDep = opStart + phase; firstStopDep <= opEnd; firstStopDep += freq) {
      const lastStopOffset = route.stops[route.stops.length - 1].minutes_from_start;
      const tripEndMins = firstStopDep + lastStopOffset;
      // Keep trips that could serve initial boarding or downstream transfers within 3 hours
      if (tripEndMins < searchMins || firstStopDep > windowEnd + 90) continue;

      trips.push({
        trip_id: `${route.route_id}_dep_${firstStopDep}`,
        route_id: route.route_id,
        route_number: route.route_number,
        route_name: route.route_name,
        direction: route.direction,
        direction_label: route.direction_label,
        is_ac: route.is_ac,
        default_capacity: route.default_capacity,
        is_scheduled: false,
        stop_times: route.stops.map((s) => ({
          stop_id: s.stop_id,
          stop_sequence: s.stop_sequence,
          arrival_mins: firstStopDep + s.minutes_from_start,
          departure_mins: firstStopDep + s.minutes_from_start,
        })),
      });
    }
  });

  return trips;
}

export function buildTransitGraph(options: {
  stops: BusStop[];
  routes: BusRoute[];
  scheduledTrips?: GTFSScheduledTrip[];
  serviceCalendars?: GTFSServiceCalendarsMap;
  date: string;
  searchMins: number;
}): TransitGraph {
  const stopMap: Record<string, BusStop> = {};
  options.stops.forEach((s) => {
    stopMap[s.stop_id] = s;
  });

  const hasGtfsTrips =
    Array.isArray(options.scheduledTrips) && options.scheduledTrips.length > 0;
  let activeTrips: GraphTrip[] = [];
  let totalTripsBeforeCalendarFilter = 0;

  if (hasGtfsTrips) {
    totalTripsBeforeCalendarFilter = options.scheduledTrips!.length;
    activeTrips = options.scheduledTrips!
      .filter((t) =>
        isServiceActiveOnDate(t.service_id, options.date, options.serviceCalendars)
      )
      .map((t) => ({
        trip_id: t.trip_id,
        route_id: t.route_id,
        route_number: t.route_number,
        route_name: t.route_name,
        direction: t.direction,
        direction_label: t.direction_label,
        is_ac: t.is_ac,
        default_capacity: t.default_capacity,
        is_scheduled: true,
        stop_times: t.stop_times,
      }));
  } else {
    activeTrips = synthesizeFrequencyTrips(options.routes, options.searchMins);
    totalTripsBeforeCalendarFilter = activeTrips.length;
  }

  const stopToTrips = new Map<string, { tripIndex: number; stopIndex: number }[]>();
  let directedEdgesCount = 0;

  activeTrips.forEach((trip, tripIndex) => {
    directedEdgesCount += Math.max(0, trip.stop_times.length - 1);
    trip.stop_times.forEach((st, stopIndex) => {
      const list = stopToTrips.get(st.stop_id) ?? [];
      list.push({ tripIndex, stopIndex });
      stopToTrips.set(st.stop_id, list);
    });
  });

  // Sort trip arrivals per stop chronologically for fast time-dependent pruning
  stopToTrips.forEach((entries) => {
    entries.sort(
      (a, b) =>
        activeTrips[a.tripIndex].stop_times[a.stopIndex].departure_mins -
        activeTrips[b.tripIndex].stop_times[b.stopIndex].departure_mins
    );
  });

  // Build short walking links ONLY between stops with valid coordinates within <= 350m
  const walkingLinks = new Map<string, WalkingLink[]>();
  let walkingLinksCount = 0;
  const stopsWithCoords = options.stops.filter((s) => hasRealCoordinates(s));

  // Avoid O(N^2) blowup if GTFS has thousands of stops by bounding lat/lng deltas first (~0.004 deg ≈ 440m)
  for (let i = 0; i < stopsWithCoords.length; i++) {
    const a = stopsWithCoords[i];
    for (let j = i + 1; j < stopsWithCoords.length; j++) {
      const b = stopsWithCoords[j];
      if (Math.abs(a.lat - b.lat) > 0.004 || Math.abs(a.lng - b.lng) > 0.0045) continue;
      const dist = haversineMeters(a.lat, a.lng, b.lat, b.lng);
      if (dist >= MIN_WALK_METERS && dist <= MAX_WALK_METERS) {
        const walkMeters = Math.round(dist);
        const walkMins = Math.max(2, Math.ceil(walkMeters / (WALK_SPEED_MPS * 60)));

        const listA = walkingLinks.get(a.stop_id) ?? [];
        listA.push({ toStopId: b.stop_id, walkMeters, walkMins });
        walkingLinks.set(a.stop_id, listA);

        const listB = walkingLinks.get(b.stop_id) ?? [];
        listB.push({ toStopId: a.stop_id, walkMeters, walkMins });
        walkingLinks.set(b.stop_id, listB);
        walkingLinksCount += 2;
      }
    }
  }

  return {
    stopMap,
    trips: activeTrips,
    stopToTrips,
    walkingLinks,
    directedEdgesCount,
    walkingLinksCount,
    usesGtfsSchedule: hasGtfsTrips,
    totalTripsBeforeCalendarFilter,
  };
}

function getNextBoardableEntries(
  graph: TransitGraph,
  stopId: string,
  earliestDepMins: number,
  latestDepMins: number
): { tripIndex: number; stopIndex: number }[] {
  const entries = graph.stopToTrips.get(stopId) ?? [];
  const chosenByRouteDir = new Map<string, { tripIndex: number; stopIndex: number }>();

  for (const entry of entries) {
    const trip = graph.trips[entry.tripIndex];
    const dep = trip.stop_times[entry.stopIndex].departure_mins;
    if (dep < earliestDepMins) continue;
    if (dep > latestDepMins) break; // sorted chronologically

    // Take the earliest boardable trip per (route_id, direction) at this stop
    if (!chosenByRouteDir.has(trip.route_id)) {
      chosenByRouteDir.set(trip.route_id, entry);
    }
  }

  return Array.from(chosenByRouteDir.values());
}

export function searchTimeDependentJourneys(options: {
  sourceStopId: string;
  destinationStopId: string;
  date: string;
  time: string;
  stops: BusStop[];
  routes: BusRoute[];
  scheduledTrips?: GTFSScheduledTrip[];
  serviceCalendars?: GTFSServiceCalendarsMap;
  maxTransfers?: number;
}): GraphSearchOutput {
  const emptyStats = {
    stopsCount: options.stops.length,
    activeTripsCount: 0,
    directedEdgesCount: 0,
    walkingLinksCount: 0,
  };

  if (!isValidIsoDate(options.date)) {
    return {
      paths: [],
      errorCode: 'INVALID_DATE',
      errorMessage: `Invalid departure date "${options.date}". Please pick a valid YYYY-MM-DD calendar date.`,
      graphStats: emptyStats,
    };
  }

  const searchMins = parseClockTimeToMinutes(options.time);
  if (searchMins === null) {
    return {
      paths: [],
      errorCode: 'INVALID_TIME',
      errorMessage: `Invalid departure time "${options.time}". Please enter a valid 24-hour time (HH:mm).`,
      graphStats: emptyStats,
    };
  }

  if (options.stops.length === 0 || (options.routes.length === 0 && !(options.scheduledTrips?.length))) {
    return {
      paths: [],
      errorCode: 'MISSING_GTFS',
      errorMessage: 'No active bus routes or stops are loaded in the transit graph.',
      graphStats: emptyStats,
    };
  }

  const stopLookup = new Set(options.stops.map((s) => s.stop_id));
  if (!options.sourceStopId || !options.destinationStopId || !stopLookup.has(options.sourceStopId) || !stopLookup.has(options.destinationStopId)) {
    return {
      paths: [],
      errorCode: 'INVALID_STOPS',
      errorMessage: 'Selected source or destination stop could not be identified in the active stop catalog.',
      graphStats: emptyStats,
    };
  }

  if (options.sourceStopId === options.destinationStopId) {
    return {
      paths: [],
      errorCode: 'SAME_STOP',
      errorMessage: 'Source and destination bus stops must be different.',
      graphStats: emptyStats,
    };
  }

  const graph = buildTransitGraph({
    stops: options.stops,
    routes: options.routes,
    scheduledTrips: options.scheduledTrips,
    serviceCalendars: options.serviceCalendars,
    date: options.date,
    searchMins,
  });

  const graphStats = {
    stopsCount: options.stops.length,
    activeTripsCount: graph.trips.length,
    directedEdgesCount: graph.directedEdgesCount,
    walkingLinksCount: graph.walkingLinksCount,
  };

  if (graph.usesGtfsSchedule && graph.totalTripsBeforeCalendarFilter > 0 && graph.trips.length === 0) {
    return {
      paths: [],
      errorCode: 'NO_SERVICE_ON_DATE',
      errorMessage: `No GTFS bus trips are scheduled to operate on ${options.date} per calendar.txt / calendar_dates.txt.`,
      graphStats,
    };
  }

  const maxTransfers = Math.max(0, Math.min(2, options.maxTransfers ?? 2));
  const candidates: CandidatePath[] = [];
  const seenSignatures = new Set<string>();

  const registerPath = (path: CandidatePath) => {
    if (path.totalDurationMins <= 0 || path.arrivalMins <= path.departureMins) return;
    const sig =
      path.legs.map((l) => l.trip.route_number).join('>') +
      '|' +
      path.transfers.map((t) => `${t.fromStopId}->${t.toStopId}`).join(',');
    if (seenSignatures.has(sig)) return;
    seenSignatures.add(sig);
    candidates.push(path);
  };

  // Round 1: Direct journeys (0 transfers)
  const leg1Starts = getNextBoardableEntries(
    graph,
    options.sourceStopId,
    searchMins,
    searchMins + MAX_BOARDING_WAIT_WINDOW_MINS
  );

  interface PartialLeg1State {
    leg1: CandidateLeg;
    transferStopId: string;
    alightingMins: number;
    visitedStops: Set<string>;
  }

  const leg1States: PartialLeg1State[] = [];

  for (const { tripIndex, stopIndex } of leg1Starts) {
    const trip1 = graph.trips[tripIndex];
    const board1 = trip1.stop_times[stopIndex];

    for (let j = stopIndex + 1; j < trip1.stop_times.length; j++) {
      const alight1 = trip1.stop_times[j];
      if (alight1.arrival_mins <= board1.departure_mins) continue;

      const leg1: CandidateLeg = {
        trip: trip1,
        startIdx: stopIndex,
        endIdx: j,
        boardingMins: board1.departure_mins,
        alightingMins: alight1.arrival_mins,
      };

      if (alight1.stop_id === options.destinationStopId) {
        registerPath({
          legs: [leg1],
          transfers: [],
          departureMins: leg1.boardingMins,
          arrivalMins: leg1.alightingMins,
          totalDurationMins: leg1.alightingMins - leg1.boardingMins,
          totalTransferWaitMins: 0,
        });
      } else if (maxTransfers >= 1) {
        const visited = new Set<string>();
        for (let v = stopIndex; v <= j; v++) visited.add(trip1.stop_times[v].stop_id);
        leg1States.push({
          leg1,
          transferStopId: alight1.stop_id,
          alightingMins: alight1.arrival_mins,
          visitedStops: visited,
        });
      }
    }
  }

  // Round 2: 1-transfer journeys (and collect partial states for 2-transfer search)
  interface PartialLeg2State {
    leg1: CandidateLeg;
    transfer1: CandidateTransferStep;
    leg2: CandidateLeg;
    transferStopId: string;
    alightingMins: number;
    visitedStops: Set<string>;
  }

  const leg2States: PartialLeg2State[] = [];

  if (maxTransfers >= 1) {
    for (const s1 of leg1States) {
      // Candidate boarding points for leg 2: same stop OR valid short walking link (<= 350m)
      const boardPoints: {
        stopId: string;
        isWalk: boolean;
        walkMeters?: number;
        walkMins?: number;
      }[] = [{ stopId: s1.transferStopId, isWalk: false }];

      const walks = graph.walkingLinks.get(s1.transferStopId) ?? [];
      walks.forEach((w) => {
        if (!s1.visitedStops.has(w.toStopId) && w.toStopId !== options.destinationStopId) {
          boardPoints.push({
            stopId: w.toStopId,
            isWalk: true,
            walkMeters: w.walkMeters,
            walkMins: w.walkMins,
          });
        }
      });

      for (const bp of boardPoints) {
        const minWait = bp.isWalk ? (bp.walkMins ?? 3) + 3 : MIN_SAME_STOP_TRANSFER_MINS;
        const earliestBoard2 = s1.alightingMins + minWait;
        const latestBoard2 = s1.alightingMins + MAX_TRANSFER_WAIT_MINS;

        const leg2Starts = getNextBoardableEntries(
          graph,
          bp.stopId,
          earliestBoard2,
          latestBoard2
        );

        for (const { tripIndex, stopIndex } of leg2Starts) {
          const trip2 = graph.trips[tripIndex];
          if (trip2.route_number === s1.leg1.trip.route_number) continue;

          const board2 = trip2.stop_times[stopIndex];
          if (board2.departure_mins < earliestBoard2) continue;

          for (let k = stopIndex + 1; k < trip2.stop_times.length; k++) {
            const alight2 = trip2.stop_times[k];
            if (alight2.arrival_mins <= board2.departure_mins) continue;
            if (s1.visitedStops.has(alight2.stop_id)) continue;

            const leg2: CandidateLeg = {
              trip: trip2,
              startIdx: stopIndex,
              endIdx: k,
              boardingMins: board2.departure_mins,
              alightingMins: alight2.arrival_mins,
            };

            const transfer1: CandidateTransferStep = {
              afterLegIndex: 1,
              fromStopId: s1.transferStopId,
              toStopId: bp.stopId,
              arrivalMins: s1.alightingMins,
              nextDepartureMins: board2.departure_mins,
              nextRouteNumber: trip2.route_number,
              waitMins: board2.departure_mins - s1.alightingMins,
              isWalkingTransfer: bp.isWalk,
              walkMeters: bp.walkMeters,
              walkMins: bp.walkMins,
            };

            if (alight2.stop_id === options.destinationStopId) {
              registerPath({
                legs: [s1.leg1, leg2],
                transfers: [transfer1],
                departureMins: s1.leg1.boardingMins,
                arrivalMins: leg2.alightingMins,
                totalDurationMins: leg2.alightingMins - s1.leg1.boardingMins,
                totalTransferWaitMins: transfer1.waitMins,
              });
            } else if (maxTransfers >= 2 && leg2States.length < 280) {
              const visited2 = new Set(s1.visitedStops);
              for (let v = stopIndex; v <= k; v++) visited2.add(trip2.stop_times[v].stop_id);
              leg2States.push({
                leg1: s1.leg1,
                transfer1,
                leg2,
                transferStopId: alight2.stop_id,
                alightingMins: alight2.arrival_mins,
                visitedStops: visited2,
              });
            }
          }
        }
      }
    }
  }

  // Round 3: 2-transfer journeys (explore when direct/1-transfer options are absent or sparse, or faster/comfort alternatives exist)
  const directOrOneCount = candidates.length;
  if (maxTransfers >= 2 && (directOrOneCount < 4 || candidates.every((c) => c.transfers.length > 0))) {
    // Keep fastest states per transfer stop to keep search fast and clean
    const bestStatePerStop = new Map<string, PartialLeg2State>();
    leg2States.forEach((st) => {
      const existing = bestStatePerStop.get(st.transferStopId);
      if (!existing || st.alightingMins < existing.alightingMins) {
        bestStatePerStop.set(st.transferStopId, st);
      }
    });

    for (const s2 of bestStatePerStop.values()) {
      const minWait = MIN_SAME_STOP_TRANSFER_MINS;
      const earliestBoard3 = s2.alightingMins + minWait;
      const latestBoard3 = s2.alightingMins + MAX_TRANSFER_WAIT_MINS;

      const leg3Starts = getNextBoardableEntries(
        graph,
        s2.transferStopId,
        earliestBoard3,
        latestBoard3
      );

      for (const { tripIndex, stopIndex } of leg3Starts) {
        const trip3 = graph.trips[tripIndex];
        if (
          trip3.route_number === s2.leg1.trip.route_number ||
          trip3.route_number === s2.leg2.trip.route_number
        ) {
          continue;
        }

        const board3 = trip3.stop_times[stopIndex];
        if (board3.departure_mins < earliestBoard3) continue;

        const destIdx = trip3.stop_times.findIndex(
          (st, idx) => idx > stopIndex && st.stop_id === options.destinationStopId
        );
        if (destIdx === -1) continue;

        const alight3 = trip3.stop_times[destIdx];
        if (alight3.arrival_mins <= board3.departure_mins) continue;

        const leg3: CandidateLeg = {
          trip: trip3,
          startIdx: stopIndex,
          endIdx: destIdx,
          boardingMins: board3.departure_mins,
          alightingMins: alight3.arrival_mins,
        };

        const transfer2: CandidateTransferStep = {
          afterLegIndex: 2,
          fromStopId: s2.transferStopId,
          toStopId: s2.transferStopId,
          arrivalMins: s2.alightingMins,
          nextDepartureMins: board3.departure_mins,
          nextRouteNumber: trip3.route_number,
          waitMins: board3.departure_mins - s2.alightingMins,
          isWalkingTransfer: false,
        };

        registerPath({
          legs: [s2.leg1, s2.leg2, leg3],
          transfers: [s2.transfer1, transfer2],
          departureMins: s2.leg1.boardingMins,
          arrivalMins: leg3.alightingMins,
          totalDurationMins: leg3.alightingMins - s2.leg1.boardingMins,
          totalTransferWaitMins: s2.transfer1.waitMins + transfer2.waitMins,
        });

        if (candidates.length >= 24) break;
      }
      if (candidates.length >= 24) break;
    }
  }

  if (candidates.length === 0) {
    return {
      paths: [],
      errorCode: 'NO_ROUTE_FOUND',
      errorMessage:
        'No valid bus journey (direct, 1-transfer, or 2-transfer) was found within the departure window and schedule constraints.',
      graphStats,
    };
  }

  // Sort deterministically: fewer transfers then shortest duration, keeping diverse route options
  candidates.sort((a, b) =>
    a.totalDurationMins !== b.totalDurationMins
      ? a.totalDurationMins - b.totalDurationMins
      : a.transfers.length - b.transfers.length
  );

  // Cap at up to 8 diverse options (preserving all direct, best 1-transfer, and needed 2-transfer options)
  const direct = candidates.filter((c) => c.transfers.length === 0);
  const oneXfer = candidates.filter((c) => c.transfers.length === 1);
  const twoXfer = candidates.filter((c) => c.transfers.length === 2);

  const selected: CandidatePath[] = [...direct];
  for (const opt of oneXfer) {
    if (selected.length >= 6) break;
    selected.push(opt);
  }
  for (const opt of twoXfer) {
    if (selected.length >= 8) break;
    if (direct.length + oneXfer.length < 3 || selected.length < 5) {
      selected.push(opt);
    }
  }

  return {
    paths: selected,
    graphStats,
  };
}
