from __future__ import annotations

import tempfile
from pathlib import Path
from typing import List, Optional

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from gtfs_loader import GTFSBundle, extract_gtfs_zip_bytes, load_gtfs_from_raw_files
from pipeline import process_etm_file_chunked

DEFAULT_OCTOBER_URL = (
    "https://pub-091bd9e794bb4877b10b29e6df80f065.r2.dev/2026-10/October-Delhi.csv.zip"
)

app = FastAPI(title="CrowdSense ETM & GTFS Processing API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATE = {
    "gtfs": None,
    "actual_dataset": None,
}


class UrlIngestRequest(BaseModel):
    url: Optional[str] = DEFAULT_OCTOBER_URL


@app.get("/api/v1/health")
def health():
    return {
        "ok": True,
        "engine": "fastapi-pandas",
        "hasGtfs": STATE["gtfs"] is not None,
        "hasActualDataset": STATE["actual_dataset"] is not None,
    }


@app.post("/api/v1/gtfs/ingest")
async def ingest_gtfs(files: List[UploadFile] = File(...)):
    file_map = {}
    for uf in files:
        content = await uf.read()
        if uf.filename and uf.filename.lower().endswith(".zip"):
            file_map.update(extract_gtfs_zip_bytes(content))
        elif uf.filename:
            file_map[uf.filename] = content

    if not file_map:
        raise HTTPException(status_code=400, detail="No valid GTFS files found.")

    bundle: GTFSBundle = load_gtfs_from_raw_files(file_map)
    STATE["gtfs"] = bundle
    return {
        "ok": True,
        "gtfs": {
            "summary": {
                "filesDetected": bundle.files_detected,
                "stopsCount": len(bundle.stops),
                "routesCount": bundle.routes_count,
                "tripsCount": bundle.trips_count,
                "stopTimesCount": bundle.stop_times_count,
                "calendarActive": (
                    "calendar.txt" in bundle.files_detected
                    or "calendar_dates.txt" in bundle.files_detected
                ),
            },
            "stops": bundle.stops,
            "routes": bundle.routes,
            "serviceDaysSummary": {
                "weekdayServices": bundle.weekday_services,
                "weekendServices": bundle.weekend_services,
                "calendarExceptions": bundle.calendar_exceptions,
            },
            "warnings": bundle.warnings,
        },
    }


@app.post("/api/v1/etm/ingest-upload")
async def ingest_etm_upload(file: UploadFile = File(...)):
    suffix = Path(file.filename or "upload.csv").suffix or ".csv"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        while chunk := await file.read(1024 * 1024):
            tmp.write(chunk)
        tmp_path = Path(tmp.name)

    try:
        result = process_etm_file_chunked(
            tmp_path,
            source_name=file.filename or "uploaded_etm",
            source_origin="upload",
            gtfs=STATE["gtfs"],
        )
        STATE["actual_dataset"] = result
        return {"ok": True, "actualDataset": result}
    finally:
        tmp_path.unlink(missing_ok=True)


@app.post("/api/v1/etm/ingest-url")
async def ingest_etm_url(payload: UrlIngestRequest):
    target_url = (payload.url or DEFAULT_OCTOBER_URL).strip()
    suffix = ".zip" if target_url.lower().endswith(".zip") else ".csv"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp_path = Path(tmp.name)

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            async with client.stream("GET", target_url) as resp:
                if resp.status_code >= 400:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Remote URL returned HTTP {resp.status_code}",
                    )
                with open(tmp_path, "wb") as out:
                    async for chunk in resp.aiter_bytes(chunk_size=1024 * 1024):
                        out.write(chunk)

        result = process_etm_file_chunked(
            tmp_path,
            source_name=Path(target_url).name or "October-Delhi.csv.zip",
            source_origin="url",
            gtfs=STATE["gtfs"],
        )
        STATE["actual_dataset"] = result
        return {"ok": True, "actualDataset": result}
    finally:
        tmp_path.unlink(missing_ok=True)
