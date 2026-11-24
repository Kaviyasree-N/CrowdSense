import JSZip from 'jszip';
import type { ActualDatasetResult, ProcessedGTFSData } from '../types/transit';
import { processEtmCsvText } from '../engine/etmPipeline';
import { processGTFSFileContents } from '../engine/gtfsProcessor';

export const OCTOBER_DATASET_URL =
  'https://pub-091bd9e794bb4877b10b29e6df80f065.r2.dev/2026-10/October-Delhi.csv.zip';

const BROWSER_FALLBACK_MAX_ROWS = 50000;

export interface IngestEtmResponse {
  actualDataset: ActualDatasetResult;
}

export interface IngestGtfsResponse {
  gtfs: ProcessedGTFSData;
  actualDataset?: ActualDatasetResult | null;
}

async function extractBrowserGtfsFileMap(files: File[]): Promise<Record<string, string>> {
  const targetNames = new Set([
    'routes.txt',
    'trips.txt',
    'stops.txt',
    'stop_times.txt',
    'calendar.txt',
    'calendar_dates.txt',
  ]);
  const fileMap: Record<string, string> = {};

  for (const f of files) {
    if (f.name.toLowerCase().endsWith('.zip')) {
      const zip = await JSZip.loadAsync(f);
      for (const entryName of Object.keys(zip.files)) {
        const entry = zip.files[entryName];
        if (entry.dir) continue;
        const base = entryName.split('/').pop()?.toLowerCase() ?? '';
        if (targetNames.has(base)) {
          fileMap[base] = await entry.async('string');
        }
      }
    } else {
      const base = f.name.split('/').pop()?.toLowerCase() ?? '';
      if (targetNames.has(base)) {
        fileMap[base] = await f.text();
      }
    }
  }
  return fileMap;
}

export const actualDataService = {
  async fetchServerStatus(): Promise<{
    gtfs: ProcessedGTFSData | null;
    actualDataset: ActualDatasetResult | null;
  }> {
    try {
      const res = await fetch('/api/v1/dataset/status');
      if (!res.ok) return { gtfs: null, actualDataset: null };
      const data = await res.json();
      return {
        gtfs: data.gtfs ?? null,
        actualDataset: data.actualDataset ?? null,
      };
    } catch {
      return { gtfs: null, actualDataset: null };
    }
  },

  async uploadGtfsFiles(files: File[]): Promise<IngestGtfsResponse> {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f, f.name));

    try {
      const res = await fetch('/api/v1/gtfs/ingest', {
        method: 'POST',
        body: formData,
      });
      const payload = await res.json();
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || `GTFS ingestion failed (HTTP ${res.status}).`);
      }
      return {
        gtfs: payload.gtfs as ProcessedGTFSData,
        actualDataset: payload.actualDataset ?? null,
      };
    } catch (err) {
      // Only fall back to browser parsing if the API endpoint itself is unreachable
      if (err instanceof TypeError) {
        const fileMap = await extractBrowserGtfsFileMap(files);
        if (Object.keys(fileMap).length === 0) {
          throw new Error(
            'No standard GTFS files detected. Upload routes.txt, trips.txt, stops.txt, stop_times.txt, calendar.txt, or a GTFS .zip archive.'
          );
        }
        return { gtfs: processGTFSFileContents(fileMap), actualDataset: null };
      }
      throw err;
    }
  },

  async uploadEtmFile(
    file: File,
    gtfsFallback: ProcessedGTFSData | null
  ): Promise<IngestEtmResponse> {
    const formData = new FormData();
    formData.append('file', file, file.name);

    try {
      const res = await fetch('/api/v1/etm/ingest-upload', {
        method: 'POST',
        body: formData,
      });
      const payload = await res.json();
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || `ETM ingestion failed (HTTP ${res.status}).`);
      }
      return { actualDataset: payload.actualDataset as ActualDatasetResult };
    } catch (err) {
      // Browser fallback when backend is unavailable
      if (err instanceof TypeError) {
        let csvText = '';
        if (file.name.toLowerCase().endsWith('.zip')) {
          const zip = await JSZip.loadAsync(file);
          const csvEntryName = Object.keys(zip.files).find(
            (name) =>
              !zip.files[name].dir &&
              name.toLowerCase().endsWith('.csv') &&
              !name.startsWith('__MACOSX')
          );
          if (!csvEntryName) {
            throw new Error('Uploaded ZIP archive contains no .csv file.');
          }
          csvText = await zip.files[csvEntryName].async('string');
        } else {
          csvText = await file.text();
        }

        const result = processEtmCsvText(csvText, {
          datasetId: `etm_browser_${Date.now()}`,
          sourceName: file.name,
          sourceOrigin: 'upload',
          processingEngine: 'browser-streaming',
          gtfsData: gtfsFallback,
          maxRows: BROWSER_FALLBACK_MAX_ROWS,
        });
        return { actualDataset: result };
      }
      throw err;
    }
  },

  async ingestFromUrl(url: string = OCTOBER_DATASET_URL): Promise<IngestEtmResponse> {
    const res = await fetch('/api/v1/etm/ingest-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    let payload: { ok?: boolean; error?: string; actualDataset?: ActualDatasetResult };
    try {
      payload = await res.json();
    } catch {
      throw new Error(`Remote ingestion endpoint returned HTTP ${res.status}.`);
    }

    if (!res.ok || !payload.ok || !payload.actualDataset) {
      throw new Error(
        payload.error ||
          `Failed to download and process dataset from ${url} (HTTP ${res.status}).`
      );
    }

    return { actualDataset: payload.actualDataset };
  },

  async resetServerDataset(): Promise<void> {
    try {
      await fetch('/api/v1/dataset/reset', { method: 'POST' });
    } catch {
      // Ignore if backend unavailable
    }
  },
};
