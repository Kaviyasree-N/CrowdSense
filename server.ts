import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';
import type { ActualDatasetResult, CrowdingLevel, DayType, ProcessedGTFSData } from './src/types/transit.ts';
import { processGTFSFileContents, splitCsvLine } from './src/engine/gtfsProcessor.ts';
import { createEtmStreamProcessor } from './src/engine/etmPipeline.ts';
import {
  computeCriticalHotspots,
  filterSegmentObservations,
  paginateSegmentObservations,
} from './src/utils/analyticsEngine.ts';
import type { AnalyticsFilterState } from './src/utils/analyticsEngine.ts';
import { DEFAULT_CAPACITY_CONFIG } from './src/utils/crowdClassification.ts';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT ?? 3000);
const FASTAPI_BACKEND_URL = (process.env.FASTAPI_BACKEND_URL ?? '').trim().replace(/\/$/, '');
const DEFAULT_OCTOBER_URL =
  'https://pub-091bd9e794bb4877b10b29e6df80f065.r2.dev/2026-10/October-Delhi.csv.zip';

const UPLOAD_DIR = path.join(os.tmpdir(), 'crowdsense_uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`);
    },
  }),
  limits: {
    fileSize: 512 * 1024 * 1024, // 512 MB cap for ZIP/CSV uploads
  },
});

interface ServerDatasetState {
  gtfs: ProcessedGTFSData | null;
  actualDataset: ActualDatasetResult | null;
  activeEtmFilePath: string | null;
  activeEtmSourceName: string | null;
  activeEtmOrigin: 'url' | 'upload';
}

const serverState: ServerDatasetState = {
  gtfs: null,
  actualDataset: null,
  activeEtmFilePath: null,
  activeEtmSourceName: null,
  activeEtmOrigin: 'upload',
};

function safeUnlink(filePath: string | null | undefined) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Ignore cleanup errors
  }
}

async function listZipEntries(zipPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('unzip', ['-Z1', zipPath], {
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    const buf = await fs.promises.readFile(zipPath);
    const zip = await JSZip.loadAsync(buf);
    return Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  }
}

async function streamEtmFileToProcessor(
  filePath: string,
  sourceName: string,
  sourceOrigin: 'url' | 'upload',
  gtfsData: ProcessedGTFSData | null
): Promise<ActualDatasetResult> {
  const isZip =
    filePath.toLowerCase().endsWith('.zip') || sourceName.toLowerCase().endsWith('.zip');

  const processor = createEtmStreamProcessor({
    datasetId: `etm_${Date.now()}`,
    sourceName,
    sourceOrigin,
    processingEngine: 'node-streaming',
    gtfsData,
    maxTripSampleTickets: 16000,
    truncatedForBrowser: false,
  });

  let headerProcessed = false;

  const consumeStream = async (stream: NodeJS.ReadableStream) => {
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line || line.trim().length === 0) continue;
      if (!headerProcessed) {
        processor.setHeaders(splitCsvLine(line));
        headerProcessed = true;
        continue;
      }
      processor.processCsvLine(line);
    }
  };

  if (isZip) {
    const entries = await listZipEntries(filePath);
    const csvEntry = entries.find((e) => e.toLowerCase().endsWith('.csv') && !e.startsWith('__MACOSX'));
    if (!csvEntry) {
      throw new Error('The uploaded ZIP archive does not contain any .csv file.');
    }

    // Stream uncompressed CSV from disk via unzip -p so multi-million-row ZIPs don't fill RAM
    try {
      const child = spawn('unzip', ['-p', filePath, csvEntry], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderrOutput = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderrOutput += chunk.toString();
      });

      const exitPromise = new Promise<void>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`unzip exited with code ${code}: ${stderrOutput}`));
        });
      });

      await Promise.all([consumeStream(child.stdout), exitPromise]);
    } catch (unzipErr) {
      // Fallback to JSZip stream for smaller ZIP archives if system unzip fails
      const buf = await fs.promises.readFile(filePath);
      const zip = await JSZip.loadAsync(buf);
      const entry = zip.file(csvEntry);
      if (!entry) throw unzipErr;
      await consumeStream(entry.nodeStream());
    }
  } else {
    const readStream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 256 * 1024 });
    await consumeStream(readStream);
  }

  return processor.finalize();
}

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      engine: FASTAPI_BACKEND_URL ? 'fastapi-proxy' : 'node-streaming',
      hasGtfs: Boolean(serverState.gtfs),
      hasActualDataset: Boolean(serverState.actualDataset),
    });
  });

  app.get('/api/v1/dataset/status', (_req: Request, res: Response) => {
    res.json({
      gtfs: serverState.gtfs,
      actualDataset: serverState.actualDataset,
    });
  });

  app.post('/api/v1/dataset/reset', (_req: Request, res: Response) => {
    safeUnlink(serverState.activeEtmFilePath);
    serverState.gtfs = null;
    serverState.actualDataset = null;
    serverState.activeEtmFilePath = null;
    serverState.activeEtmSourceName = null;
    res.json({ ok: true });
  });

  // Pre-aggregated paginated segment crowding endpoint for large datasets
  app.get('/api/v1/analytics/segments', (req: Request, res: Response) => {
    const actual = serverState.actualDataset;
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(req.query.limit ?? 15) || 15));

    if (!actual) {
      res.json({
        ok: true,
        available: false,
        items: [],
        total: 0,
        page: 1,
        pageSize,
        totalPages: 1,
      });
      return;
    }

    const acCap = Math.max(10, Math.min(150, Number(req.query.acCapacity ?? DEFAULT_CAPACITY_CONFIG.acCapacity) || DEFAULT_CAPACITY_CONFIG.acCapacity));
    const nonAcCap = Math.max(10, Math.min(150, Number(req.query.nonAcCapacity ?? DEFAULT_CAPACITY_CONFIG.nonAcCapacity) || DEFAULT_CAPACITY_CONFIG.nonAcCapacity));
    const capacityConfig = {
      ...DEFAULT_CAPACITY_CONFIG,
      acCapacity: acCap,
      nonAcCapacity: nonAcCap,
    };

    const routeCapacityLookup = new Map<string, number>();
    actual.activeRoutes.forEach((r) => {
      routeCapacityLookup.set(r.route_id, r.is_ac ? acCap : nonAcCap);
    });

    const dayTypeRaw = String(req.query.dayType ?? 'all');
    const timeRaw = String(req.query.timePeriod ?? 'all');
    const dirRaw = String(req.query.direction ?? 'all');
    const crowdingRaw = String(req.query.crowdingLevel ?? 'ALL');

    const filters: Partial<AnalyticsFilterState> = {
      routeNumber: String(req.query.routeNumber ?? 'ALL'),
      dayType: dayTypeRaw === 'weekday' || dayTypeRaw === 'weekend' ? (dayTypeRaw as DayType) : 'all',
      timePeriod:
        timeRaw === 'morning' || timeRaw === 'midday' || timeRaw === 'evening' || timeRaw === 'night'
          ? timeRaw
          : 'all',
      direction: dirRaw === 'UP' || dirRaw === 'DOWN' ? dirRaw : 'all',
    };

    const crowdingFilter: 'ALL' | CrowdingLevel =
      crowdingRaw === 'Seats Available' ||
      crowdingRaw === 'Standing Room' ||
      crowdingRaw === 'Crowded' ||
      crowdingRaw === 'Very Crowded'
        ? crowdingRaw
        : 'ALL';

    const filtered = filterSegmentObservations(actual.aggregatedObservations, filters);
    const paginated = paginateSegmentObservations(
      filtered,
      routeCapacityLookup,
      capacityConfig,
      page,
      pageSize,
      crowdingFilter
    );

    res.json({ ok: true, available: true, ...paginated });
  });

  app.get('/api/v1/analytics/hotspots', (req: Request, res: Response) => {
    const actual = serverState.actualDataset;
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(req.query.limit ?? 15) || 15));

    if (!actual) {
      res.json({ ok: true, available: false, items: [], total: 0, page: 1, pageSize, totalPages: 1 });
      return;
    }

    const acCap = Math.max(10, Math.min(150, Number(req.query.acCapacity ?? DEFAULT_CAPACITY_CONFIG.acCapacity) || DEFAULT_CAPACITY_CONFIG.acCapacity));
    const nonAcCap = Math.max(10, Math.min(150, Number(req.query.nonAcCapacity ?? DEFAULT_CAPACITY_CONFIG.nonAcCapacity) || DEFAULT_CAPACITY_CONFIG.nonAcCapacity));
    const capacityConfig = {
      ...DEFAULT_CAPACITY_CONFIG,
      acCapacity: acCap,
      nonAcCapacity: nonAcCap,
    };

    const routeCapacityLookup = new Map<string, number>();
    actual.activeRoutes.forEach((r) => {
      routeCapacityLookup.set(r.route_id, r.is_ac ? acCap : nonAcCap);
    });

    const filtered = filterSegmentObservations(actual.aggregatedObservations, {
      routeNumber: String(req.query.routeNumber ?? 'ALL'),
      dayType:
        req.query.dayType === 'weekday' || req.query.dayType === 'weekend'
          ? (req.query.dayType as DayType)
          : 'all',
      timePeriod:
        req.query.timePeriod === 'morning' ||
        req.query.timePeriod === 'midday' ||
        req.query.timePeriod === 'evening' ||
        req.query.timePeriod === 'night'
          ? req.query.timePeriod
          : 'all',
      direction:
        req.query.direction === 'UP' || req.query.direction === 'DOWN'
          ? req.query.direction
          : 'all',
    });

    const allHotspots = computeCriticalHotspots(filtered, routeCapacityLookup, capacityConfig);
    const total = allHotspots.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.max(1, Math.min(totalPages, page));
    const start = (safePage - 1) * pageSize;

    res.json({
      ok: true,
      available: true,
      items: allHotspots.slice(start, start + pageSize),
      total,
      page: safePage,
      pageSize,
      totalPages,
    });
  });

  // Static GTFS ingestion (.txt files or .zip archive)
  app.post(
    '/api/v1/gtfs/ingest',
    upload.array('files', 16),
    async (req: Request, res: Response) => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        res.status(400).json({ ok: false, error: 'No GTFS files uploaded.' });
        return;
      }

      const targetNames = new Set([
        'routes.txt',
        'trips.txt',
        'stops.txt',
        'stop_times.txt',
        'calendar.txt',
        'calendar_dates.txt',
      ]);

      try {
        const fileMap: Record<string, string> = {};

        for (const f of files) {
          if (f.originalname.toLowerCase().endsWith('.zip')) {
            const buf = await fs.promises.readFile(f.path);
            const zip = await JSZip.loadAsync(buf);
            for (const entryName of Object.keys(zip.files)) {
              const entry = zip.files[entryName];
              if (entry.dir) continue;
              const base = entryName.split('/').pop()?.toLowerCase() ?? '';
              if (targetNames.has(base)) {
                fileMap[base] = await entry.async('string');
              }
            }
          } else {
            const base = f.originalname.split('/').pop()?.toLowerCase() ?? '';
            if (targetNames.has(base)) {
              fileMap[base] = await fs.promises.readFile(f.path, 'utf8');
            }
          }
        }

        if (Object.keys(fileMap).length === 0) {
          res.status(400).json({
            ok: false,
            error:
              'No standard GTFS files found (expected routes.txt, trips.txt, stops.txt, stop_times.txt, calendar.txt, or calendar_dates.txt).',
          });
          return;
        }

        const gtfsData = processGTFSFileContents(fileMap);
        serverState.gtfs = gtfsData;

        // If an ETM file is already loaded on server, automatically re-run mapping + trip reconstruction
        let updatedActual: ActualDatasetResult | null = null;
        if (serverState.activeEtmFilePath && fs.existsSync(serverState.activeEtmFilePath)) {
          updatedActual = await streamEtmFileToProcessor(
            serverState.activeEtmFilePath,
            serverState.activeEtmSourceName ?? 'uploaded_etm.csv',
            serverState.activeEtmOrigin,
            gtfsData
          );
          serverState.actualDataset = updatedActual;
        }

        res.json({ ok: true, gtfs: gtfsData, actualDataset: updatedActual });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to process GTFS files.';
        res.status(500).json({ ok: false, error: message });
      } finally {
        files.forEach((f) => safeUnlink(f.path));
      }
    }
  );

  // ETM CSV or ZIP upload ingestion
  app.post(
    '/api/v1/etm/ingest-upload',
    upload.single('file'),
    async (req: Request, res: Response) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({ ok: false, error: 'No ETM CSV or ZIP file provided.' });
        return;
      }

      // Optional FastAPI forward if external Python worker is configured
      if (FASTAPI_BACKEND_URL) {
        try {
          const form = new FormData();
          const bytes = await fs.promises.readFile(file.path);
          form.append('file', new Blob([bytes]), file.originalname);
          const proxyRes = await fetch(`${FASTAPI_BACKEND_URL}/api/v1/etm/ingest-upload`, {
            method: 'POST',
            body: form,
          });
          const payload = await proxyRes.json();
          safeUnlink(file.path);
          res.status(proxyRes.status).json(payload);
          return;
        } catch {
          // Fall back to Node streaming if external FastAPI worker is unreachable
        }
      }

      try {
        const result = await streamEtmFileToProcessor(
          file.path,
          file.originalname,
          'upload',
          serverState.gtfs
        );

        // Replace previous retained ETM file on disk
        if (serverState.activeEtmFilePath && serverState.activeEtmFilePath !== file.path) {
          safeUnlink(serverState.activeEtmFilePath);
        }
        serverState.activeEtmFilePath = file.path;
        serverState.activeEtmSourceName = file.originalname;
        serverState.activeEtmOrigin = 'upload';
        serverState.actualDataset = result;

        res.json({ ok: true, actualDataset: result });
      } catch (err) {
        safeUnlink(file.path);
        const message = err instanceof Error ? err.message : 'Failed to stream ETM file.';
        res.status(400).json({ ok: false, error: message });
      }
    }
  );

  // Remote URL download & streaming ingestion (e.g. October-Delhi.csv.zip)
  app.post('/api/v1/etm/ingest-url', async (req: Request, res: Response) => {
    const rawUrl = typeof req.body?.url === 'string' && req.body.url.trim()
      ? req.body.url.trim()
      : DEFAULT_OCTOBER_URL;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        throw new Error('Only HTTP/HTTPS URLs are supported.');
      }
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid dataset URL.',
      });
      return;
    }

    const tempPath = path.join(
      UPLOAD_DIR,
      `remote-${Date.now()}-${path.basename(parsedUrl.pathname) || 'dataset.csv.zip'}`
    );

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(parsedUrl.toString(), { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok || !response.body) {
        res.status(502).json({
          ok: false,
          error: `Remote dataset fetch failed with HTTP ${response.status} ${response.statusText}. Use manual ZIP/CSV upload if the host restricts direct server access.`,
        });
        return;
      }

      const nodeStream = Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream);
      await pipeline(nodeStream, fs.createWriteStream(tempPath));

      const sourceName = path.basename(parsedUrl.pathname) || 'October-Delhi.csv.zip';
      const result = await streamEtmFileToProcessor(
        tempPath,
        sourceName,
        'url',
        serverState.gtfs
      );

      if (serverState.activeEtmFilePath && serverState.activeEtmFilePath !== tempPath) {
        safeUnlink(serverState.activeEtmFilePath);
      }
      serverState.activeEtmFilePath = tempPath;
      serverState.activeEtmSourceName = sourceName;
      serverState.activeEtmOrigin = 'url';
      serverState.actualDataset = result;

      res.json({ ok: true, actualDataset: result });
    } catch (err) {
      safeUnlink(tempPath);
      const detail = err instanceof Error ? err.message : 'Network error';
      res.status(502).json({
        ok: false,
        error: `Could not download dataset from ${parsedUrl.hostname} (${detail}). Download the ZIP locally and upload it directly below.`,
      });
    }
  });

  // Vite middleware (dev) or static dist serving (prod)
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CrowdSense server running on http://0.0.0.0:${PORT}`);
  });
}

createApp().catch((err) => {
  console.error('Failed to start CrowdSense server:', err);
  process.exit(1);
});
