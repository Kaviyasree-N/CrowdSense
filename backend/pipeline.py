from __future__ import annotations

import datetime as dt
import time
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, root_mean_squared_error

from gtfs_loader import GTFSBundle, match_stops_to_gtfs, normalize_stop_label

REQUIRED_ETM_COLUMNS = [
    "passenger_count",
    "amount",
    "vehicle_number",
    "ticket_type_id",
    "start_stop_name",
    "end_stop_name",
    "route",
    "created_at",
    "is_ac",
]

CHUNK_SIZE = 100_000


def _open_csv_chunks(file_path: Path):
    if file_path.suffix.lower() == ".zip":
        zf = zipfile.ZipFile(file_path, "r")
        csv_members = [m for m in zf.namelist() if m.lower().endswith(".csv") and not m.startswith("__MACOSX")]
        if not csv_members:
            zf.close()
            raise ValueError("ZIP archive contains no .csv file.")
        member = csv_members[0]
        stream = zf.open(member, "r")
        reader = pd.read_csv(stream, chunksize=CHUNK_SIZE, dtype=str, keep_default_na=False)
        return reader, (stream, zf)

    reader = pd.read_csv(file_path, chunksize=CHUNK_SIZE, dtype=str, keep_default_na=False)
    return reader, None


def _normalize_ist_series(raw_series: pd.Series) -> pd.Series:
    parsed = pd.to_datetime(raw_series, errors="coerce", utc=False)
    if getattr(parsed.dt, "tz", None) is not None:
        return parsed.dt.tz_convert("Asia/Kolkata")
    return parsed.dt.tz_localize("Asia/Kolkata", nonexistent="shift_forward", ambiguous="NaT")


def _time_period(hour: int) -> str:
    if 6 <= hour <= 10:
        return "Morning Peak (06:00–10:59)"
    if 11 <= hour <= 15:
        return "Midday (11:00–15:59)"
    if 16 <= hour <= 20:
        return "Evening Peak (16:00–20:59)"
    return "Late / Early (21:00–05:59)"


def process_etm_file_chunked(
    file_path: Path,
    source_name: str,
    source_origin: str,
    gtfs: Optional[GTFSBundle],
) -> dict:
    t0 = time.perf_counter()
    reader, handles = _open_csv_chunks(file_path)

    total_records = 0
    valid_records = 0
    duplicate_records = 0
    invalid_records = 0
    total_passengers = 0
    max_pax = 0
    ac_tickets = 0

    missing_counts = {col: 0 for col in REQUIRED_ETM_COLUMNS}
    invalid_reasons = set()
    detected_cols: List[str] = []

    unique_vehicles = set()
    unique_routes = set()
    unique_board_stops = set()
    unique_dest_stops = set()

    hourly_tickets = np.zeros(24, dtype=np.int64)
    hourly_pax = np.zeros(24, dtype=np.int64)
    daily_agg: Dict[str, List[int]] = {}
    route_agg: Dict[str, List[int]] = {}
    route_vehicles: Dict[str, set] = {}
    period_agg: Dict[str, List[int]] = {
        "Morning Peak (06:00–10:59)": [0, 0],
        "Midday (11:00–15:59)": [0, 0],
        "Evening Peak (16:00–20:59)": [0, 0],
        "Late / Early (21:00–05:59)": [0, 0],
    }

    weekday_tix = 0
    weekday_pax = 0
    weekend_tix = 0
    weekend_pax = 0

    dedup_seen = set()
    sampled_dfs: List[pd.DataFrame] = []

    try:
        for chunk in reader:
            if not detected_cols:
                detected_cols = [c.strip() for c in chunk.columns.tolist()]
            chunk.columns = [c.strip() for c in chunk.columns]
            total_records += len(chunk)

            for col in REQUIRED_ETM_COLUMNS:
                if col not in chunk.columns:
                    missing_counts[col] += len(chunk)
                    chunk[col] = ""
                else:
                    missing_counts[col] += int((chunk[col].astype(str).str.strip() == "").sum())

            pax = pd.to_numeric(chunk["passenger_count"], errors="coerce")
            amt = pd.to_numeric(chunk["amount"], errors="coerce")
            t_type = pd.to_numeric(chunk["ticket_type_id"], errors="coerce")
            ist_dt = _normalize_ist_series(chunk["created_at"])

            same_stop = (
                chunk["start_stop_name"].str.strip().str.lower()
                == chunk["end_stop_name"].str.strip().str.lower()
            )
            has_empty = pd.Series(False, index=chunk.index)
            for col in REQUIRED_ETM_COLUMNS:
                has_empty |= chunk[col].astype(str).str.strip() == ""

            bad_pax = pax.isna() | (pax <= 0) | (pax > 25)
            bad_amt = amt.isna() | (amt < 0)
            bad_dt = ist_dt.isna()

            if bad_pax.any():
                invalid_reasons.add("Invalid passenger_count (<= 0, > 25, or non-numeric)")
            if bad_amt.any():
                invalid_reasons.add("Invalid amount (negative or non-numeric)")
            if bad_dt.any():
                invalid_reasons.add("Unparseable created_at timestamp")
            if same_stop.any():
                invalid_reasons.add("start_stop_name matches end_stop_name")

            invalid_mask = has_empty | bad_pax | bad_amt | t_type.isna() | bad_dt | same_stop
            invalid_records += int(invalid_mask.sum())

            valid_df = chunk.loc[~invalid_mask].copy()
            if valid_df.empty:
                continue

            valid_df["pax"] = pax.loc[~invalid_mask].round().astype(int)
            valid_df["amt"] = amt.loc[~invalid_mask].astype(float)
            valid_df["ist_dt"] = ist_dt.loc[~invalid_mask]
            valid_df["ist_str"] = valid_df["ist_dt"].dt.strftime("%Y-%m-%d %H:%M:%S")
            valid_df["is_ac_bool"] = (
                valid_df["is_ac"].str.strip().str.lower().isin(["true", "1", "yes", "ac"])
            )

            # Deduplicate bounded across chunk stream
            fingerprints = (
                valid_df["ist_str"]
                + "|"
                + valid_df["vehicle_number"].str.upper()
                + "|"
                + valid_df["route"].str.upper()
                + "|"
                + valid_df["start_stop_name"].str.lower()
                + "|"
                + valid_df["end_stop_name"].str.lower()
                + "|"
                + valid_df["pax"].astype(str)
                + "|"
                + valid_df["amt"].astype(str)
            )
            keep_mask = []
            for fp in fingerprints.tolist():
                if fp in dedup_seen:
                    keep_mask.append(False)
                    duplicate_records += 1
                else:
                    if len(dedup_seen) > 300_000:
                        dedup_seen.clear()
                    dedup_seen.add(fp)
                    keep_mask.append(True)

            valid_df = valid_df.loc[keep_mask]
            if valid_df.empty:
                continue

            valid_records += len(valid_df)
            total_passengers += int(valid_df["pax"].sum())
            max_pax = max(max_pax, int(valid_df["pax"].max()))
            ac_tickets += int(valid_df["is_ac_bool"].sum())

            unique_vehicles.update(valid_df["vehicle_number"].str.upper().unique())
            unique_routes.update(valid_df["route"].unique())
            unique_board_stops.update(valid_df["start_stop_name"].unique())
            unique_dest_stops.update(valid_df["end_stop_name"].unique())

            hrs = valid_df["ist_dt"].dt.hour.to_numpy()
            pax_arr = valid_df["pax"].to_numpy()
            np.add.at(hourly_tickets, hrs, 1)
            np.add.at(hourly_pax, hrs, pax_arr)

            valid_df["date"] = valid_df["ist_dt"].dt.strftime("%Y-%m-%d")
            valid_df["dow"] = valid_df["ist_dt"].dt.dayofweek
            for d_val, grp in valid_df.groupby("date"):
                cnt = len(grp)
                p_sum = int(grp["pax"].sum())
                entry = daily_agg.setdefault(str(d_val), [0, 0, int(grp["dow"].iloc[0])])
                entry[0] += cnt
                entry[1] += p_sum

            wknd_mask = valid_df["dow"] >= 5
            weekend_tix += int(wknd_mask.sum())
            weekend_pax += int(valid_df.loc[wknd_mask, "pax"].sum())
            weekday_tix += int((~wknd_mask).sum())
            weekday_pax += int(valid_df.loc[~wknd_mask, "pax"].sum())

            for hr, grp in valid_df.groupby(valid_df["ist_dt"].dt.hour):
                p_label = _time_period(int(hr))
                period_agg[p_label][0] += len(grp)
                period_agg[p_label][1] += int(grp["pax"].sum())

            for r_val, grp in valid_df.groupby("route"):
                r_key = str(r_val)
                r_entry = route_agg.setdefault(r_key, [0, 0])
                r_entry[0] += len(grp)
                r_entry[1] += int(grp["pax"].sum())
                route_vehicles.setdefault(r_key, set()).update(
                    grp["vehicle_number"].str.upper().unique()
                )

            if sum(len(s) for s in sampled_dfs) < 16_000:
                sampled_dfs.append(valid_df.head(4000))
    finally:
        if handles:
            handles[0].close()
            handles[1].close()

    gtfs_stops = gtfs.stops if gtfs else []
    gtfs_routes = gtfs.routes if gtfs else []
    all_unique_stops = sorted(unique_board_stops | unique_dest_stops)
    gtfs_label = (
        f"Uploaded GTFS ({len(gtfs_stops):,} stops, {len(gtfs_routes):,} directional routes)"
        if gtfs_stops
        else "No Static GTFS Uploaded"
    )
    stop_report = match_stops_to_gtfs(all_unique_stops, gtfs_stops, gtfs_label)

    daily_dist = [
        {
            "date": d,
            "dayLabel": d[5:],
            "dayType": "weekend" if vals[2] >= 5 else "weekday",
            "tickets": vals[0],
            "passengers": vals[1],
        }
        for d, vals in sorted(daily_agg.items())
    ]

    route_vol = sorted(
        [
            {
                "route": f"Route {r}",
                "routeNumber": r,
                "tickets": vals[0],
                "passengers": vals[1],
                "vehicles": len(route_vehicles.get(r, set())),
            }
            for r, vals in route_agg.items()
        ],
        key=lambda x: x["passengers"],
        reverse=True,
    )[:20]

    # Chronological Scikit-learn RandomForest evaluation if segment history is reconstructed
    eval_report = {
        "status": "insufficient_data",
        "reason": "Upload GTFS route stop sequences alongside multi-week ETM records to train RandomForestRegressor.",
        "trainDateRange": "N/A",
        "testDateRange": "N/A",
        "trainCount": 0,
        "testCount": 0,
        "isSimulatedData": False,
        "baselineMetrics": None,
        "randomForestMetrics": None,
        "winner": None,
    }

    duration_ms = int((time.perf_counter() - t0) * 1000)
    dates_sorted = sorted(daily_agg.keys())

    return {
        "datasetId": f"etm_py_{int(time.time())}",
        "sourceName": source_name,
        "sourceOrigin": source_origin,
        "processedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "timezone": "Asia/Kolkata",
        "status": "completed" if gtfs_stops and valid_records > 0 else ("partial" if valid_records > 0 else "failed"),
        "processingEngine": "fastapi-pandas",
        "totalRecords": total_records,
        "validRecords": valid_records,
        "duplicateRecords": duplicate_records,
        "invalidRecords": invalid_records,
        "totalPassengers": total_passengers,
        "avgPassengersPerTicket": round(total_passengers / valid_records, 2) if valid_records else 0,
        "maxPassengersPerTicket": max_pax,
        "uniqueVehicles": len(unique_vehicles),
        "uniqueRoutes": len(unique_routes),
        "uniqueBoardingStops": len(unique_board_stops),
        "uniqueDestinationStops": len(unique_dest_stops),
        "acSharePct": round((ac_tickets / valid_records) * 100) if valid_records else 0,
        "dateRangeIST": {
            "start": dates_sorted[0] if dates_sorted else "N/A",
            "end": dates_sorted[-1] if dates_sorted else "N/A",
        },
        "missingFieldCounts": missing_counts,
        "invalidReasons": sorted(invalid_reasons),
        "requiredColumnsPresent": [c for c in REQUIRED_ETM_COLUMNS if c in detected_cols],
        "missingRequiredColumns": [c for c in REQUIRED_ETM_COLUMNS if c not in detected_cols],
        "hourlyDistribution": [
            {
                "hour": f"{hr:02d}:00",
                "hourNum": hr,
                "tickets": int(hourly_tickets[hr]),
                "passengers": int(hourly_pax[hr]),
            }
            for hr in range(24)
        ],
        "dailyDistribution": daily_dist,
        "routeVolume": route_vol,
        "weekdayVsWeekend": {
            "weekdayTickets": weekday_tix,
            "weekdayPassengers": weekday_pax,
            "weekendTickets": weekend_tix,
            "weekendPassengers": weekend_pax,
        },
        "timePeriodDemand": [
            {"period": k, "tickets": v[0], "passengers": v[1]} for k, v in period_agg.items()
        ],
        "stopMatchingReport": stop_report,
        "pipelineLogs": [
            {
                "stage": 1,
                "name": "Raw Ticket Records",
                "status": "completed",
                "durationMs": duration_ms,
                "detail": f"Chunk-streamed {total_records:,} ETM rows with Pandas (chunksize={CHUNK_SIZE:,}).",
            }
        ],
        "reconstructedTripsCount": 0,
        "ambiguousTripsCount": 0,
        "historicalSegmentRecords": [],
        "aggregatedObservations": [],
        "evaluationReport": eval_report,
        "sampleRows": [],
        "activeRoutes": gtfs_routes,
        "activeStops": gtfs_stops,
        "truncatedForBrowser": False,
    }
