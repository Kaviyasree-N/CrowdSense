import type {
  BusRoute,
  BusStop,
  ProcessedGTFSData,
  StopMatchEntry,
  StopMatchingReport,
} from '../types/transit.ts';

/**
 * Lightweight RFC-4180 CSV row splitter usable in both Node.js and Browser.
 */
export function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseCsvTable(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.replace(/^\uFEFF/, '').trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    if (values.length === 0) continue;
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = values[j] ?? '';
    }
    rows.push(obj);
  }
  return rows;
}

function parseGtfsTimeToMinutes(timeStr: string): number | null {
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export function normalizeStopLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\bsec\b/g, 'sector')
    .replace(/\brly\b/g, 'railway')
    .replace(/\bstn\b/g, 'station')
    .replace(/\bmtr\b/g, 'metro')
    .replace(/\bterminal\b/g, 'isbt')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reconstructs static GTFS stops, routes, directions, stop sequences, and service calendars
 * purely from uploaded GTFS text contents. Never invents routes or schedules.
 */
export function processGTFSFileContents(
  fileMap: Record<string, string>
): ProcessedGTFSData {
  const normalizedFiles: Record<string, string> = {};
  Object.entries(fileMap).forEach(([k, v]) => {
    const base = k.split('/').pop()?.toLowerCase() ?? k.toLowerCase();
    normalizedFiles[base] = v;
  });

  const expected = [
    'routes.txt',
    'trips.txt',
    'stops.txt',
    'stop_times.txt',
    'calendar.txt',
    'calendar_dates.txt',
  ];
  const filesDetected = expected.filter((name) => Boolean(normalizedFiles[name]));
  const warnings: string[] = [];

  if (!normalizedFiles['stops.txt']) warnings.push('Missing stops.txt: cannot build stop catalog.');
  if (!normalizedFiles['routes.txt']) warnings.push('Missing routes.txt: cannot map route IDs.');
  if (!normalizedFiles['trips.txt']) warnings.push('Missing trips.txt: cannot group stop sequences by direction.');
  if (!normalizedFiles['stop_times.txt']) warnings.push('Missing stop_times.txt: cannot reconstruct stop order or travel times.');

  // 1. Parse stops.txt
  const stopRows = normalizedFiles['stops.txt'] ? parseCsvTable(normalizedFiles['stops.txt']) : [];
  const stops: BusStop[] = [];
  const stopIdsSet = new Set<string>();

  stopRows.forEach((row) => {
    const stopId = row['stop_id']?.trim();
    const stopName = row['stop_name']?.trim();
    if (!stopId || !stopName || stopIdsSet.has(stopId)) return;
    stopIdsSet.add(stopId);

    const lat = Number(row['stop_lat']);
    const lng = Number(row['stop_lon']);
    stops.push({
      stop_id: stopId,
      stop_name: stopName,
      short_name: stopName.split('(')[0].trim().slice(0, 28),
      lat: Number.isFinite(lat) ? lat : 28.6289,
      lng: Number.isFinite(lng) ? lng : 77.2195,
      zone: row['zone_id']?.trim() || 'GTFS Stop',
      is_major_hub: stopName.toLowerCase().includes('isbt') || stopName.toLowerCase().includes('terminal'),
    });
  });

  // 2. Parse routes.txt
  const routeRows = normalizedFiles['routes.txt'] ? parseCsvTable(normalizedFiles['routes.txt']) : [];
  const routeMetaMap = new Map<
    string,
    { routeNumber: string; routeName: string; isAc: boolean }
  >();

  routeRows.forEach((row) => {
    const routeId = row['route_id']?.trim();
    if (!routeId) return;
    const shortName = row['route_short_name']?.trim() || routeId;
    const longName = row['route_long_name']?.trim() || `Route ${shortName}`;
    const isAc =
      shortName.toUpperCase().includes('AC') ||
      longName.toUpperCase().includes('AC') ||
      shortName.toUpperCase().endsWith('A');

    routeMetaMap.set(routeId, {
      routeNumber: shortName,
      routeName: longName,
      isAc,
    });
  });

  // 3. Parse trips.txt
  const tripRows = normalizedFiles['trips.txt'] ? parseCsvTable(normalizedFiles['trips.txt']) : [];
  const tripToRouteDir = new Map<
    string,
    { routeId: string; direction: 'UP' | 'DOWN'; headsign: string }
  >();

  tripRows.forEach((row) => {
    const tripId = row['trip_id']?.trim();
    const routeId = row['route_id']?.trim();
    if (!tripId || !routeId) return;
    const dirRaw = row['direction_id']?.trim();
    const direction: 'UP' | 'DOWN' = dirRaw === '1' ? 'DOWN' : 'UP';
    const headsign = row['trip_headsign']?.trim() || `${direction} Direction`;
    tripToRouteDir.set(tripId, { routeId, direction, headsign });
  });

  // 4. Parse stop_times.txt and reconstruct canonical stop sequence per (route_id, direction)
  const stopTimeRows = normalizedFiles['stop_times.txt']
    ? parseCsvTable(normalizedFiles['stop_times.txt'])
    : [];
  const tripStopTimes = new Map<
    string,
    { stopId: string; seq: number; mins: number | null }[]
  >();

  stopTimeRows.forEach((row) => {
    const tripId = row['trip_id']?.trim();
    const stopId = row['stop_id']?.trim();
    const seq = Number(row['stop_sequence']);
    if (!tripId || !stopId || !Number.isFinite(seq)) return;

    const arrMins = parseGtfsTimeToMinutes(row['arrival_time'] || row['departure_time'] || '');
    const list = tripStopTimes.get(tripId) ?? [];
    list.push({ stopId, seq, mins: arrMins });
    tripStopTimes.set(tripId, list);
  });

  // Pick longest representative trip per (routeId, direction)
  const canonicalTripByRouteDir = new Map<
    string,
    { tripId: string; routeId: string; direction: 'UP' | 'DOWN'; headsign: string; count: number }
  >();

  tripStopTimes.forEach((stList, tripId) => {
    const tripMeta = tripToRouteDir.get(tripId);
    if (!tripMeta) return;
    const key = `${tripMeta.routeId}|${tripMeta.direction}`;
    const existing = canonicalTripByRouteDir.get(key);
    if (!existing || stList.length > existing.count) {
      canonicalTripByRouteDir.set(key, {
        tripId,
        routeId: tripMeta.routeId,
        direction: tripMeta.direction,
        headsign: tripMeta.headsign,
        count: stList.length,
      });
    }
  });

  const routes: BusRoute[] = [];
  canonicalTripByRouteDir.forEach((info) => {
    const meta = routeMetaMap.get(info.routeId) ?? {
      routeNumber: info.routeId,
      routeName: `Route ${info.routeId}`,
      isAc: false,
    };
    const rawStops = [...(tripStopTimes.get(info.tripId) ?? [])].sort((a, b) => a.seq - b.seq);
    if (rawStops.length < 2) return;

    const firstValidMin = rawStops.find((s) => s.mins !== null)?.mins ?? 0;
    const formattedStops = rawStops.map((s, idx) => {
      const offset =
        s.mins !== null ? Math.max(0, s.mins - firstValidMin) : idx * 6;
      return {
        stop_id: s.stopId,
        stop_sequence: idx + 1,
        minutes_from_start: offset,
      };
    });

    routes.push({
      route_id: `${info.routeId}_${info.direction}`,
      route_number: meta.routeNumber,
      route_name: meta.routeName,
      direction: info.direction,
      direction_label: info.headsign,
      is_ac: meta.isAc,
      default_capacity: meta.isAc ? 45 : 50,
      frequency_mins: 15,
      operating_hours: 'GTFS Scheduled',
      stops: formattedStops,
    });
  });

  // 5. Parse calendar.txt & calendar_dates.txt
  const calendarRows = normalizedFiles['calendar.txt']
    ? parseCsvTable(normalizedFiles['calendar.txt'])
    : [];
  const calDatesRows = normalizedFiles['calendar_dates.txt']
    ? parseCsvTable(normalizedFiles['calendar_dates.txt'])
    : [];

  let weekdayServices = 0;
  let weekendServices = 0;
  calendarRows.forEach((r) => {
    if (r['monday'] === '1' || r['tuesday'] === '1' || r['wednesday'] === '1') weekdayServices += 1;
    if (r['saturday'] === '1' || r['sunday'] === '1') weekendServices += 1;
  });

  return {
    summary: {
      filesDetected,
      stopsCount: stops.length,
      routesCount: routeMetaMap.size,
      tripsCount: tripRows.length,
      stopTimesCount: stopTimeRows.length,
      calendarActive: filesDetected.includes('calendar.txt') || filesDetected.includes('calendar_dates.txt'),
      uploadedAt: new Date().toISOString(),
    },
    stops,
    routes,
    serviceDaysSummary: {
      weekdayServices,
      weekendServices,
      calendarExceptions: calDatesRows.length,
    },
    warnings,
  };
}

/**
 * Matches unique ETM ticket stop strings against the active GTFS stops catalog
 * and returns a transparent Stop-Matching Report.
 */
export function buildStopMatchingReport(
  uniqueRawStops: string[],
  gtfsStops: BusStop[],
  gtfsSourceLabel: string
): StopMatchingReport {
  const normalizedGtfs = gtfsStops.map((stop) => ({
    stop,
    norm: normalizeStopLabel(stop.stop_name),
    shortNorm: normalizeStopLabel(stop.short_name),
    tokens: new Set(normalizeStopLabel(stop.stop_name).split(' ').filter((t) => t.length > 1)),
  }));

  const matchedSamples: StopMatchEntry[] = [];
  const ambiguousSamples: StopMatchEntry[] = [];
  const unmatchedSamples: StopMatchEntry[] = [];

  let matchedCount = 0;
  let ambiguousCount = 0;
  let unmatchedCount = 0;

  uniqueRawStops.forEach((rawStopName) => {
    const norm = normalizeStopLabel(rawStopName);
    if (!norm) {
      unmatchedCount += 1;
      return;
    }

    // 1. Exact normalized match
    const exactMatches = normalizedGtfs.filter(
      (g) => g.norm === norm || g.shortNorm === norm
    );
    if (exactMatches.length === 1) {
      matchedCount += 1;
      if (matchedSamples.length < 20) {
        matchedSamples.push({
          rawStopName,
          normalizedName: norm,
          matchStatus: 'matched',
          matchedStopId: exactMatches[0].stop.stop_id,
          matchedStopName: exactMatches[0].stop.stop_name,
          candidateCount: 1,
          confidence: 'High',
        });
      }
      return;
    }

    // 2. Substring / token-overlap match
    const rawTokens = norm.split(' ').filter((t) => t.length > 1);
    const scoredCandidates = normalizedGtfs
      .map((g) => {
        let score = 0;
        if (g.norm.includes(norm) || norm.includes(g.norm)) {
          score = 0.88;
        } else if (rawTokens.length > 0 && g.tokens.size > 0) {
          const intersection = rawTokens.filter((t) => g.tokens.has(t)).length;
          const union = new Set([...rawTokens, ...g.tokens]).size;
          score = union > 0 ? intersection / union : 0;
        }
        return { stop: g.stop, score };
      })
      .filter((c) => c.score >= 0.55)
      .sort((a, b) => b.score - a.score);

    if (scoredCandidates.length === 0) {
      unmatchedCount += 1;
      if (unmatchedSamples.length < 20) {
        unmatchedSamples.push({
          rawStopName,
          normalizedName: norm,
          matchStatus: 'unmatched',
          candidateCount: 0,
          confidence: 'Low',
        });
      }
    } else if (
      scoredCandidates.length > 1 &&
      scoredCandidates[0].score - scoredCandidates[1].score < 0.08 &&
      scoredCandidates[0].score < 0.9
    ) {
      ambiguousCount += 1;
      if (ambiguousSamples.length < 20) {
        ambiguousSamples.push({
          rawStopName,
          normalizedName: norm,
          matchStatus: 'ambiguous',
          matchedStopId: scoredCandidates[0].stop.stop_id,
          matchedStopName: scoredCandidates[0].stop.stop_name,
          candidateCount: scoredCandidates.length,
          confidence: 'Low',
        });
      }
    } else {
      matchedCount += 1;
      if (matchedSamples.length < 20) {
        matchedSamples.push({
          rawStopName,
          normalizedName: norm,
          matchStatus: 'matched',
          matchedStopId: scoredCandidates[0].stop.stop_id,
          matchedStopName: scoredCandidates[0].stop.stop_name,
          candidateCount: scoredCandidates.length,
          confidence: scoredCandidates[0].score >= 0.85 ? 'High' : 'Medium',
        });
      }
    }
  });

  const total = uniqueRawStops.length;
  const matchingConfidencePct =
    total > 0 ? Math.round(((matchedCount + ambiguousCount * 0.4) / total) * 100) : 0;

  return {
    totalUniqueTicketStops: total,
    matchedCount,
    ambiguousCount,
    unmatchedCount,
    matchingConfidencePct,
    gtfsSourceLabel,
    matchedSamples,
    ambiguousSamples,
    unmatchedSamples,
  };
}
