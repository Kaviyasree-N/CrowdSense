from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import pandas as pd


TARGET_GTFS_FILES = {
    "routes.txt",
    "trips.txt",
    "stops.txt",
    "stop_times.txt",
    "calendar.txt",
    "calendar_dates.txt",
}


def normalize_stop_label(raw: str) -> str:
    text = raw.lower()
    text = re.sub(r"\(.*?\)", " ", text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\bsec\b", "sector", text)
    text = re.sub(r"\brly\b", "railway", text)
    text = re.sub(r"\bstn\b", "station", text)
    text = re.sub(r"\bmtr\b", "metro", text)
    text = re.sub(r"\bterminal\b", "isbt", text)
    return re.sub(r"\s+", " ", text).strip()


def _parse_gtfs_minutes(val: str) -> Optional[int]:
    if not isinstance(val, str) or ":" not in val:
        return None
    parts = val.strip().split(":")
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        return None


@dataclass
class GTFSBundle:
    files_detected: List[str] = field(default_factory=list)
    stops: List[dict] = field(default_factory=list)
    routes: List[dict] = field(default_factory=list)
    trips_count: int = 0
    stop_times_count: int = 0
    routes_count: int = 0
    weekday_services: int = 0
    weekend_services: int = 0
    calendar_exceptions: int = 0
    warnings: List[str] = field(default_factory=list)


def load_gtfs_from_raw_files(file_map: Dict[str, bytes]) -> GTFSBundle:
    normalized: Dict[str, bytes] = {}
    for name, content in file_map.items():
        base = name.split("/")[-1].lower()
        if base in TARGET_GTFS_FILES:
            normalized[base] = content

    bundle = GTFSBundle(files_detected=sorted(normalized.keys()))

    if "stops.txt" not in normalized:
        bundle.warnings.append("Missing stops.txt: cannot build stop catalog.")
    if "routes.txt" not in normalized:
        bundle.warnings.append("Missing routes.txt: cannot map route IDs.")
    if "trips.txt" not in normalized:
        bundle.warnings.append("Missing trips.txt: cannot group stop sequences by direction.")
    if "stop_times.txt" not in normalized:
        bundle.warnings.append("Missing stop_times.txt: cannot reconstruct stop order.")

    if "stops.txt" in normalized:
        df_stops = pd.read_csv(io.BytesIO(normalized["stops.txt"]), dtype=str).fillna("")
        seen_ids = set()
        for row in df_stops.to_dict(orient="records"):
            sid = str(row.get("stop_id", "")).strip()
            sname = str(row.get("stop_name", "")).strip()
            if not sid or not sname or sid in seen_ids:
                continue
            seen_ids.add(sid)
            try:
                lat = float(row.get("stop_lat", "") or 28.6289)
                lng = float(row.get("stop_lon", "") or 77.2195)
            except ValueError:
                lat, lng = 28.6289, 77.2195
            bundle.stops.append(
                {
                    "stop_id": sid,
                    "stop_name": sname,
                    "short_name": sname.split("(")[0].strip()[:28],
                    "lat": lat,
                    "lng": lng,
                    "zone": str(row.get("zone_id", "")).strip() or "GTFS Stop",
                    "is_major_hub": ("isbt" in sname.lower() or "terminal" in sname.lower()),
                }
            )

    route_meta: Dict[str, Tuple[str, str, bool]] = {}
    if "routes.txt" in normalized:
        df_routes = pd.read_csv(io.BytesIO(normalized["routes.txt"]), dtype=str).fillna("")
        bundle.routes_count = len(df_routes)
        for row in df_routes.to_dict(orient="records"):
            rid = str(row.get("route_id", "")).strip()
            if not rid:
                continue
            short_n = str(row.get("route_short_name", "")).strip() or rid
            long_n = str(row.get("route_long_name", "")).strip() or f"Route {short_n}"
            is_ac = "AC" in short_n.upper() or "AC" in long_n.upper() or short_n.upper().endswith("A")
            route_meta[rid] = (short_n, long_n, is_ac)

    trip_meta: Dict[str, Tuple[str, str, str]] = {}
    if "trips.txt" in normalized:
        df_trips = pd.read_csv(io.BytesIO(normalized["trips.txt"]), dtype=str).fillna("")
        bundle.trips_count = len(df_trips)
        for row in df_trips.to_dict(orient="records"):
            tid = str(row.get("trip_id", "")).strip()
            rid = str(row.get("route_id", "")).strip()
            if not tid or not rid:
                continue
            direction = "DOWN" if str(row.get("direction_id", "")).strip() == "1" else "UP"
            headsign = str(row.get("trip_headsign", "")).strip() or f"{direction} Direction"
            trip_meta[tid] = (rid, direction, headsign)

    if "stop_times.txt" in normalized and trip_meta:
        df_st = pd.read_csv(io.BytesIO(normalized["stop_times.txt"]), dtype=str).fillna("")
        bundle.stop_times_count = len(df_st)
        trip_stops: Dict[str, List[Tuple[int, str, Optional[int]]]] = {}
        for row in df_st.to_dict(orient="records"):
            tid = str(row.get("trip_id", "")).strip()
            sid = str(row.get("stop_id", "")).strip()
            try:
                seq = int(float(row.get("stop_sequence", "")))
            except ValueError:
                continue
            if not tid or not sid:
                continue
            mins = _parse_gtfs_minutes(row.get("arrival_time") or row.get("departure_time") or "")
            trip_stops.setdefault(tid, []).append((seq, sid, mins))

        canonical: Dict[Tuple[str, str], Tuple[str, str, List[Tuple[int, str, Optional[int]]]]] = {}
        for tid, st_list in trip_stops.items():
            if tid not in trip_meta:
                continue
            rid, direction, headsign = trip_meta[tid]
            key = (rid, direction)
            if key not in canonical or len(st_list) > len(canonical[key][2]):
                canonical[key] = (tid, headsign, st_list)

        for (rid, direction), (_, headsign, st_list) in canonical.items():
            ordered = sorted(st_list, key=lambda x: x[0])
            if len(ordered) < 2:
                continue
            short_n, long_n, is_ac = route_meta.get(rid, (rid, f"Route {rid}", False))
            first_min = next((m for _, _, m in ordered if m is not None), 0)
            formatted = []
            for idx, (_, sid, mins) in enumerate(ordered):
                offset = max(0, mins - first_min) if mins is not None else idx * 6
                formatted.append(
                    {
                        "stop_id": sid,
                        "stop_sequence": idx + 1,
                        "minutes_from_start": offset,
                    }
                )
            bundle.routes.append(
                {
                    "route_id": f"{rid}_{direction}",
                    "route_number": short_n,
                    "route_name": long_n,
                    "direction": direction,
                    "direction_label": headsign,
                    "is_ac": is_ac,
                    "default_capacity": 45 if is_ac else 50,
                    "frequency_mins": 15,
                    "operating_hours": "GTFS Scheduled",
                    "stops": formatted,
                }
            )

    if "calendar.txt" in normalized:
        df_cal = pd.read_csv(io.BytesIO(normalized["calendar.txt"]), dtype=str).fillna("")
        for row in df_cal.to_dict(orient="records"):
            if row.get("monday") == "1" or row.get("tuesday") == "1":
                bundle.weekday_services += 1
            if row.get("saturday") == "1" or row.get("sunday") == "1":
                bundle.weekend_services += 1

    if "calendar_dates.txt" in normalized:
        df_cd = pd.read_csv(io.BytesIO(normalized["calendar_dates.txt"]), dtype=str)
        bundle.calendar_exceptions = len(df_cd)

    return bundle


def extract_gtfs_zip_bytes(zip_bytes: bytes) -> Dict[str, bytes]:
    extracted: Dict[str, bytes] = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for member in zf.namelist():
            if member.endswith("/"):
                continue
            base = member.split("/")[-1].lower()
            if base in TARGET_GTFS_FILES:
                extracted[base] = zf.read(member)
    return extracted


def match_stops_to_gtfs(unique_stops: List[str], gtfs_stops: List[dict], source_label: str) -> dict:
    if not gtfs_stops:
        return {
            "totalUniqueTicketStops": len(unique_stops),
            "matchedCount": 0,
            "ambiguousCount": 0,
            "unmatchedCount": len(unique_stops),
            "matchingConfidencePct": 0,
            "gtfsSourceLabel": "No Static GTFS Uploaded",
            "matchedSamples": [],
            "ambiguousSamples": [],
            "unmatchedSamples": [
                {
                    "rawStopName": s,
                    "normalizedName": normalize_stop_label(s),
                    "matchStatus": "unmatched",
                    "candidateCount": 0,
                    "confidence": "Low",
                }
                for s in unique_stops[:20]
            ],
        }

    indexed = []
    for st in gtfs_stops:
        norm = normalize_stop_label(st["stop_name"])
        tokens = {t for t in norm.split(" ") if len(t) > 1}
        indexed.append((st, norm, normalize_stop_label(st["short_name"]), tokens))

    matched_cnt = 0
    ambiguous_cnt = 0
    unmatched_cnt = 0
    matched_samples = []
    ambiguous_samples = []
    unmatched_samples = []

    for raw in unique_stops:
        norm = normalize_stop_label(raw)
        if not norm:
            unmatched_cnt += 1
            continue

        exact = [g for g in indexed if g[1] == norm or g[2] == norm]
        if len(exact) == 1:
            matched_cnt += 1
            if len(matched_samples) < 20:
                matched_samples.append(
                    {
                        "rawStopName": raw,
                        "normalizedName": norm,
                        "matchStatus": "matched",
                        "matchedStopId": exact[0][0]["stop_id"],
                        "matchedStopName": exact[0][0]["stop_name"],
                        "candidateCount": 1,
                        "confidence": "High",
                    }
                )
            continue

        raw_tokens = {t for t in norm.split(" ") if len(t) > 1}
        candidates = []
        for st, g_norm, _, g_tokens in indexed:
            score = 0.0
            if g_norm in norm or norm in g_norm:
                score = 0.88
            elif raw_tokens and g_tokens:
                inter = len(raw_tokens & g_tokens)
                union = len(raw_tokens | g_tokens)
                score = inter / union if union else 0.0
            if score >= 0.55:
                candidates.append((score, st))

        candidates.sort(key=lambda x: x[0], reverse=True)
        if not candidates:
            unmatched_cnt += 1
            if len(unmatched_samples) < 20:
                unmatched_samples.append(
                    {
                        "rawStopName": raw,
                        "normalizedName": norm,
                        "matchStatus": "unmatched",
                        "candidateCount": 0,
                        "confidence": "Low",
                    }
                )
        elif len(candidates) > 1 and (candidates[0][0] - candidates[1][0]) < 0.08 and candidates[0][0] < 0.9:
            ambiguous_cnt += 1
            if len(ambiguous_samples) < 20:
                ambiguous_samples.append(
                    {
                        "rawStopName": raw,
                        "normalizedName": norm,
                        "matchStatus": "ambiguous",
                        "matchedStopId": candidates[0][1]["stop_id"],
                        "matchedStopName": candidates[0][1]["stop_name"],
                        "candidateCount": len(candidates),
                        "confidence": "Low",
                    }
                )
        else:
            matched_cnt += 1
            if len(matched_samples) < 20:
                matched_samples.append(
                    {
                        "rawStopName": raw,
                        "normalizedName": norm,
                        "matchStatus": "matched",
                        "matchedStopId": candidates[0][1]["stop_id"],
                        "matchedStopName": candidates[0][1]["stop_name"],
                        "candidateCount": len(candidates),
                        "confidence": "High" if candidates[0][0] >= 0.85 else "Medium",
                    }
                )

    total = len(unique_stops)
    conf_pct = round(((matched_cnt + ambiguous_cnt * 0.4) / total) * 100) if total else 0
    return {
        "totalUniqueTicketStops": total,
        "matchedCount": matched_cnt,
        "ambiguousCount": ambiguous_cnt,
        "unmatchedCount": unmatched_cnt,
        "matchingConfidencePct": conf_pct,
        "gtfsSourceLabel": source_label,
        "matchedSamples": matched_samples,
        "ambiguousSamples": ambiguous_samples,
        "unmatchedSamples": unmatched_samples,
    }
