import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  FolderArchive,
  Globe,
  Layers,
  Server,
  Upload,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { KPIcard } from '../components/KPIcard';
import { SAMPLE_ETM_TICKETS } from '../data/samplePredictions';
import { SAMPLE_ROUTES } from '../data/sampleRoutes';
import {
  actualDataService,
  OCTOBER_DATASET_URL,
} from '../services/actualDataService';
import { dataService } from '../services/dataService';
import type {
  ActualDatasetResult,
  CapacityConfig,
  DataMode,
  ProcessedGTFSData,
} from '../types/transit';
import { REQUIRED_ETM_COLUMNS } from '../engine/etmPipeline';
import { reconstructTripsDetailed } from '../utils/passengerLoad';

interface DataExplorerProps {
  capacityConfig: CapacityConfig;
  onUpdateCapacity: (config: CapacityConfig) => void;
  dataMode: DataMode;
  onSwitchMode: (mode: DataMode) => void;
  actualDataset: ActualDatasetResult | null;
  onSaveActualDataset: (dataset: ActualDatasetResult | null) => void;
  gtfsData: ProcessedGTFSData | null;
  onSaveGtfsData: (gtfs: ProcessedGTFSData | null) => void;
}

const TEN_STAGE_PIPELINE = [
  '1. Raw Ticket Records',
  '2. Data Cleaning',
  '3. Duplicate and Invalid Record Handling',
  '4. Route Mapping',
  '5. GTFS Stop Mapping',
  '6. Trip Identification',
  '7. Boarding and Alighting Aggregation',
  '8. Segment Passenger Load Estimation',
  '9. Historical Feature Generation',
  '10. Crowding Prediction',
];

export function DataExplorer({
  capacityConfig,
  onUpdateCapacity,
  dataMode,
  onSwitchMode,
  actualDataset,
  onSaveActualDataset,
  gtfsData,
  onSaveGtfsData,
}: DataExplorerProps) {
  const [etmLoading, setEtmLoading] = useState(false);
  const [urlLoading, setUrlLoading] = useState(false);
  const [gtfsLoading, setGtfsLoading] = useState(false);
  const [etmError, setEtmError] = useState<string | null>(null);
  const [gtfsError, setGtfsError] = useState<string | null>(null);
  const [datasetUrl, setDatasetUrl] = useState(OCTOBER_DATASET_URL);

  const sampleBatchSummary = useMemo(
    () => reconstructTripsDetailed(SAMPLE_ETM_TICKETS, SAMPLE_ROUTES),
    []
  );
  const sampleReconstructedTrips = sampleBatchSummary.trips;

  const demoEvaluationReport = useMemo(
    () => dataService.getDemoModelEvaluation(),
    []
  );

  const [selectedTripKey, setSelectedTripKey] = useState<string>(
    sampleReconstructedTrips[0]?.tripKey ?? ''
  );

  const activeTrip =
    sampleReconstructedTrips.find((t) => t.tripKey === selectedTripKey) ??
    sampleReconstructedTrips[0];

  const handleEtmFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEtmLoading(true);
    setEtmError(null);
    try {
      const { actualDataset: res } = await actualDataService.uploadEtmFile(file, gtfsData);
      onSaveActualDataset(res);
    } catch (err) {
      setEtmError(err instanceof Error ? err.message : 'Failed to process ETM CSV/ZIP file.');
    } finally {
      setEtmLoading(false);
      e.target.value = '';
    }
  };

  const handleFetchRemoteDataset = async () => {
    setUrlLoading(true);
    setEtmError(null);
    try {
      const { actualDataset: res } = await actualDataService.ingestFromUrl(datasetUrl);
      onSaveActualDataset(res);
    } catch (err) {
      setEtmError(
        err instanceof Error
          ? err.message
          : 'Failed to download or process remote October dataset.'
      );
    } finally {
      setUrlLoading(false);
    }
  };

  const handleGtfsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    setGtfsLoading(true);
    setGtfsError(null);
    try {
      const { gtfs, actualDataset: refreshedActual } = await actualDataService.uploadGtfsFiles(files);
      onSaveGtfsData(gtfs);
      if (refreshedActual) {
        onSaveActualDataset(refreshedActual);
      }
    } catch (err) {
      setGtfsError(err instanceof Error ? err.message : 'GTFS validation failed.');
    } finally {
      setGtfsLoading(false);
      e.target.value = '';
    }
  };

  const handleDownloadSampleCsv = () => {
    const csv = dataService.generateSampleCsvString();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'crowdsense_october_etm_sample.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const weekdayWeekendChartData = useMemo(() => {
    if (!actualDataset) return [];
    return [
      {
        category: 'Weekday',
        tickets: actualDataset.weekdayVsWeekend.weekdayTickets,
        passengers: actualDataset.weekdayVsWeekend.weekdayPassengers,
      },
      {
        category: 'Weekend',
        tickets: actualDataset.weekdayVsWeekend.weekendTickets,
        passengers: actualDataset.weekdayVsWeekend.weekendPassengers,
      },
    ];
  }, [actualDataset]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-teal-800">
            Technical Methodology, ETM Pipeline & Actual Dataset Integration
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
            Data & Crowd Estimation Model Explorer
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-3xl">
            Ingest actual Delhi ETM ticketing CSV/ZIP archives and static GTFS feeds to reconstruct segment loads, inspect stop-matching confidence, and switch the entire planner between Demo and Actual Data modes.
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadSampleCsv}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 hover:border-slate-400 text-slate-800 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-4 h-4 text-teal-700" />
          Download Sample ETM CSV
        </button>
      </div>

      {/* 1. Reproducible 10-Stage Processing Pipeline */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Reproducible 10-Stage ETM & GTFS Processing Pipeline
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Modular streaming pipeline executed identically in Node.js streaming and Python FastAPI/Pandas chunked workers.
            </p>
          </div>
          {actualDataset && (
            <span className="text-[11px] font-mono-tabular font-semibold px-2.5 py-1 rounded bg-emerald-50 text-emerald-900 border border-emerald-200">
              Engine: {actualDataset.processingEngine} · Status: {actualDataset.status.toUpperCase()}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {TEN_STAGE_PIPELINE.map((label, idx) => {
            const log = actualDataset?.pipelineLogs.find((l) => l.stage === idx + 1);
            const statusColor =
              log?.status === 'completed'
                ? 'border-emerald-200 bg-emerald-50/50'
                : log?.status === 'warning'
                ? 'border-amber-200 bg-amber-50/50'
                : log?.status === 'error'
                ? 'border-red-200 bg-red-50/50'
                : 'border-slate-200 bg-slate-50/70';

            return (
              <div
                key={label}
                className={`rounded-lg border p-3 flex flex-col justify-between gap-1.5 ${statusColor}`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-semibold text-slate-800">{label}</span>
                  {idx < TEN_STAGE_PIPELINE.length - 1 && (
                    <ArrowRight className="w-3.5 h-3.5 text-teal-700 shrink-0 hidden lg:block" />
                  )}
                </div>
                {log && (
                  <div className="text-[11px] text-slate-600 leading-snug">
                    <span className="font-mono-tabular font-semibold text-slate-800">
                      [{log.status} · {log.durationMs}ms]
                    </span>{' '}
                    {log.detail}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 2. Actual ETM CSV / ZIP Integration (Remote URL + File Upload) */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-teal-700" />
              Actual October Delhi ETM / E-Ticketing Dataset Integration
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Fetch the October 2026 Delhi bus ticketing ZIP directly on the server or upload a local <code className="font-mono">.csv</code> / <code className="font-mono">.zip</code> file. All timestamps normalize to <code className="font-mono">Asia/Kolkata</code>.
            </p>
          </div>

          <label className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer">
            <Upload className="w-4 h-4" />
            {etmLoading ? 'Streaming & Processing...' : 'Upload ETM CSV or ZIP'}
            <input
              type="file"
              accept=".csv,.zip,text/csv,application/zip"
              onChange={handleEtmFileUpload}
              disabled={etmLoading || urlLoading}
              className="sr-only"
            />
          </label>
        </div>

        {/* Remote Dataset Fetch Bar */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex-1 flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-3 h-9">
            <Globe className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="url"
              aria-label="Remote October Delhi ETM ZIP URL"
              value={datasetUrl}
              onChange={(e) => setDatasetUrl(e.target.value)}
              className="w-full text-xs font-mono-tabular text-slate-800 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={handleFetchRemoteDataset}
            disabled={urlLoading || etmLoading}
            className="inline-flex items-center justify-center gap-2 px-4 h-9 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            {urlLoading ? 'Downloading & Streaming...' : 'Fetch & Process October ZIP'}
          </button>
        </div>

        {etmError && (
          <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{etmError}</span>
          </div>
        )}

        {actualDataset ? (
          <div className="space-y-6">
            {/* Processing Summary & Mode Toggle */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-teal-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  Processed Actual Dataset: {actualDataset.sourceName} ({actualDataset.timezone})
                </div>
                <div className="text-xs text-slate-600 font-mono-tabular">
                  IST Window: {actualDataset.dateRangeIST.start} to {actualDataset.dateRangeIST.end} · AC Share: {actualDataset.acSharePct}% · Avg Pax/Ticket: {actualDataset.avgPassengersPerTicket} (Max {actualDataset.maxPassengersPerTicket})
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSwitchMode(dataMode === 'actual' ? 'demo' : 'actual')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    dataMode === 'actual'
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-white text-slate-900 border-slate-300 hover:border-teal-600'
                  }`}
                >
                  {dataMode === 'actual'
                    ? 'Active Across App: ACTUAL DATA MODE'
                    : 'Use Actual Data in Planner, Map & Analytics'}
                </button>
              </div>
            </div>

            {actualDataset.truncatedForBrowser && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
                Browser fallback capped inspection at 50,000 rows because the streaming server API was unreachable. Run <code className="font-mono">npm run dev</code> (Express + Node streaming) or the Python FastAPI worker to process all 2.56M rows.
              </div>
            )}

            {/* Schema & Missing Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-slate-200 rounded-lg p-4 space-y-2">
                <h3 className="text-xs font-bold text-slate-900">Required Schema Validation</h3>
                <div className="flex flex-wrap gap-1.5">
                  {REQUIRED_ETM_COLUMNS.map((col) => {
                    const present = actualDataset.requiredColumnsPresent.includes(col);
                    return (
                      <span
                        key={col}
                        className={`text-[11px] font-mono-tabular px-2 py-0.5 rounded border ${
                          present
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-red-50 text-red-800 border-red-200'
                        }`}
                      >
                        {col} {present ? '✓' : 'Missing'}
                      </span>
                    );
                  })}
                </div>
                {actualDataset.invalidReasons.length > 0 && (
                  <div className="pt-2 text-xs text-amber-800">
                    <strong>Invalid/duplicate flags:</strong> {actualDataset.invalidReasons.join(' · ')}
                  </div>
                )}
              </div>

              <div className="border border-slate-200 rounded-lg p-4 space-y-2">
                <h3 className="text-xs font-bold text-slate-900">Missing Values Detected per Column</h3>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {Object.entries(actualDataset.missingFieldCounts).map(([col, count]) => (
                    <div key={col} className="flex items-center justify-between bg-slate-50 px-2 py-1 rounded">
                      <span className="font-mono-tabular text-[11px] text-slate-600 truncate">{col}</span>
                      <span className="font-mono-tabular font-semibold text-slate-900">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ACTUAL DATASET DASHBOARD — 10 Required Metrics */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-bold text-slate-900">
                  Actual Dataset Dashboard
                </h3>
                <span className="text-[11px] font-mono-tabular font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-200">
                  ACTUAL UPLOADED DATA · NO SIMULATED VALUES
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <KPIcard
                  label="Total Ticket Records"
                  value={actualDataset.totalRecords.toLocaleString()}
                  subtitle={`${actualDataset.validRecords.toLocaleString()} valid`}
                />
                <KPIcard
                  label="Total passenger_count"
                  value={actualDataset.totalPassengers.toLocaleString()}
                  subtitle={`Avg ${actualDataset.avgPassengersPerTicket} / ticket`}
                  accent="teal"
                />
                <KPIcard
                  label="Unique Vehicles"
                  value={actualDataset.uniqueVehicles.toLocaleString()}
                  subtitle="Distinct buses"
                />
                <KPIcard
                  label="Unique Routes"
                  value={actualDataset.uniqueRoutes.toLocaleString()}
                  subtitle="ETM route codes"
                />
                <KPIcard
                  label="Unique Boarding Stops"
                  value={actualDataset.uniqueBoardingStops.toLocaleString()}
                  subtitle="start_stop_name"
                />
                <KPIcard
                  label="Unique Dest Stops"
                  value={actualDataset.uniqueDestinationStops.toLocaleString()}
                  subtitle="end_stop_name"
                />
                <KPIcard
                  label="Matched GTFS Stops"
                  value={actualDataset.stopMatchingReport.matchedCount.toLocaleString()}
                  subtitle={`${actualDataset.stopMatchingReport.matchingConfidencePct}% match confidence`}
                  accent="teal"
                />
                <KPIcard
                  label="Unmatched Stops"
                  value={actualDataset.stopMatchingReport.unmatchedCount.toLocaleString()}
                  subtitle={`${actualDataset.stopMatchingReport.ambiguousCount} ambiguous`}
                  accent={actualDataset.stopMatchingReport.unmatchedCount > 0 ? 'amber' : 'default'}
                />
                <KPIcard
                  label="Invalid & Duplicate Rows"
                  value={(actualDataset.invalidRecords + actualDataset.duplicateRecords).toLocaleString()}
                  subtitle={`${actualDataset.invalidRecords} invalid · ${actualDataset.duplicateRecords} dup`}
                  accent={actualDataset.invalidRecords > 0 ? 'red' : 'default'}
                />
                <KPIcard
                  label="Processing Status"
                  value={actualDataset.status.toUpperCase()}
                  subtitle={`${actualDataset.reconstructedTripsCount} trips grouped`}
                  accent={actualDataset.status === 'completed' ? 'teal' : 'amber'}
                />
              </div>
            </div>

            {/* 5 Actual Dataset Visualizations */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AnalyticsChart
                title="1. Ticket Distribution by Hour (IST)"
                subtitle="Tickets & total passenger_count grouped by Asia/Kolkata hour"
                dataSourceLabel="ACTUAL DATASET"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={actualDataset.hourlyDistribution} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#475569' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="tickets" name="Tickets" fill="#0F172A" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="passengers" name="Passengers" fill="#0F766E" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </AnalyticsChart>

              <AnalyticsChart
                title="2. Ticket Distribution by Date (IST)"
                subtitle="Daily ticket and passenger totals across uploaded dates"
                dataSourceLabel="ACTUAL DATASET"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={actualDataset.dailyDistribution} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="dayLabel" tick={{ fontSize: 10, fill: '#475569' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="tickets" name="Tickets" fill="#0F172A" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="passengers" name="Passengers" fill="#0D9488" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </AnalyticsChart>

              <AnalyticsChart
                title="3. Route-Wise Ticket Volume (Top Routes)"
                subtitle="Total tickets & passengers grouped by ETM route"
                dataSourceLabel="ACTUAL DATASET"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={actualDataset.routeVolume} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="route" tick={{ fontSize: 10, fill: '#475569' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="passengers" name="Passengers" fill="#0F766E" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </AnalyticsChart>

              <AnalyticsChart
                title="4. Weekday vs. Weekend Demand"
                subtitle="Comparison of weekday commuter volume vs. weekend volume"
                dataSourceLabel="ACTUAL DATASET"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekdayWeekendChartData} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="tickets" name="Tickets" fill="#0F172A" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="passengers" name="Passengers" fill="#0F766E" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </AnalyticsChart>
            </div>

            <AnalyticsChart
              title="5. Passenger Demand by Time Period"
              subtitle="Morning Peak (06–10), Midday (11–15), Evening Peak (16–20), and Late/Early (21–05) IST"
              dataSourceLabel="ACTUAL DATASET"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={actualDataset.timePeriodDemand} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="tickets" name="Tickets" fill="#0F172A" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="passengers" name="Passengers" fill="#EA580C" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </AnalyticsChart>

            {/* Stop-Matching Report */}
            <div className="border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    GTFS Stop-Matching Report
                  </h3>
                  <p className="text-xs text-slate-500">
                    Source: {actualDataset.stopMatchingReport.gtfsSourceLabel}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-mono-tabular">
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                    Matched: {actualDataset.stopMatchingReport.matchedCount}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                    Ambiguous: {actualDataset.stopMatchingReport.ambiguousCount}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-red-50 text-red-800 border border-red-200">
                    Unmatched: {actualDataset.stopMatchingReport.unmatchedCount}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                    Confidence: {actualDataset.stopMatchingReport.matchingConfidencePct}%
                  </span>
                </div>
              </div>

              {(actualDataset.stopMatchingReport.matchedSamples.length > 0 ||
                actualDataset.stopMatchingReport.ambiguousSamples.length > 0 ||
                actualDataset.stopMatchingReport.unmatchedSamples.length > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                    <div className="font-semibold text-emerald-800">Matched Stops (Sample)</div>
                    {actualDataset.stopMatchingReport.matchedSamples.slice(0, 6).map((s) => (
                      <div key={s.rawStopName} className="truncate text-slate-700">
                        {s.rawStopName} → <span className="font-semibold">{s.matchedStopName}</span>
                      </div>
                    ))}
                    {actualDataset.stopMatchingReport.matchedSamples.length === 0 && (
                      <div className="text-slate-400">None matched yet</div>
                    )}
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                    <div className="font-semibold text-amber-800">Ambiguous Matches (Sample)</div>
                    {actualDataset.stopMatchingReport.ambiguousSamples.slice(0, 6).map((s) => (
                      <div key={s.rawStopName} className="truncate text-slate-700">
                        {s.rawStopName} ({s.candidateCount} candidates)
                      </div>
                    ))}
                    {actualDataset.stopMatchingReport.ambiguousSamples.length === 0 && (
                      <div className="text-slate-400">No ambiguous stops</div>
                    )}
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                    <div className="font-semibold text-red-800">Unmatched Stops (Sample)</div>
                    {actualDataset.stopMatchingReport.unmatchedSamples.slice(0, 6).map((s) => (
                      <div key={s.rawStopName} className="truncate text-slate-700">
                        {s.rawStopName}
                      </div>
                    ))}
                    {actualDataset.stopMatchingReport.unmatchedSamples.length === 0 && (
                      <div className="text-slate-400">All stops matched</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-slate-300 rounded-xl p-6 text-center space-y-2">
            <p className="text-sm font-medium text-slate-800">
              No actual ETM dataset ingested yet.
            </p>
            <p className="text-xs text-slate-500 max-w-lg mx-auto">
              Click "Fetch & Process October ZIP" or upload an ETM <code className="font-mono">.csv</code> / <code className="font-mono">.zip</code> file above (you can also click "Download Sample ETM CSV" and upload it) to run the 10-stage pipeline and unlock the Actual Dataset Dashboard.
            </p>
          </div>
        )}
      </section>

      {/* 3. Interactive Trip Reconstruction Simulator + Static GTFS Integration */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Live Segment-Load Reconstruction Engine
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Runs <code className="font-mono">Load[i] = Load[i-1] + Boarding - Alighting</code> on sample ETM rows.
              </p>
            </div>

            <select
              aria-label="Select reconstructed trip"
              value={activeTrip?.tripKey ?? ''}
              onChange={(e) => setSelectedTripKey(e.target.value)}
              className="h-8 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono-tabular"
            >
              {sampleReconstructedTrips.map((trip) => (
                <option key={trip.tripKey} value={trip.tripKey}>
                  Route {trip.routeNumber} · {trip.vehicleNumber} ({trip.direction})
                </option>
              ))}
            </select>
          </div>

          {activeTrip && (
            <div className="space-y-3">
              <div className="text-xs text-slate-600 space-y-1.5 bg-slate-50 rounded-lg p-3 border border-slate-200">
                <div className="flex flex-wrap gap-3">
                  <span>
                    Tickets grouped: <strong className="font-mono-tabular text-slate-900">{activeTrip.ticketCount}</strong>
                  </span>
                  <span>
                    Total passengers: <strong className="font-mono-tabular text-slate-900">{activeTrip.totalPassengers}</strong>
                  </span>
                  <span>
                    Unmatched stops: <strong className="font-mono-tabular text-slate-900">{activeTrip.unmatchedTickets}</strong>
                  </span>
                  <span>
                    Grouping reliability: <strong className="font-mono-tabular text-slate-900">{Math.round(activeTrip.tripGroupingReliability * 100)}%</strong>
                  </span>
                </div>
                <div className="text-[11px] text-slate-700">
                  <strong>Trip Identification:</strong> {activeTrip.groupingExplanation}
                  {activeTrip.isAmbiguousGrouping && (
                    <span className="ml-1.5 font-semibold text-amber-800">
                      (Ambiguous grouping flagged)
                    </span>
                  )}
                  {activeTrip.negativeClampEvents > 0 && (
                    <span className="ml-1.5 font-semibold text-red-700">
                      (Clamped {activeTrip.negativeClampEvents} negative load step(s) to 0)
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-2">Segment</th>
                      <th className="py-2 px-2 text-right">Board (+)</th>
                      <th className="py-2 px-2 text-right">Alight (-)</th>
                      <th className="py-2 pl-2 text-right">Running Load</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeTrip.segments.map((seg) => (
                      <tr key={seg.segmentOrder}>
                        <td className="py-2 pr-2 font-medium text-slate-800">
                          {seg.fromStopName.split(' ')[0]} → {seg.toStopName.split(' ')[0]}
                        </td>
                        <td className="py-2 px-2 text-right font-mono-tabular text-amber-700">
                          +{seg.boardings}
                        </td>
                        <td className="py-2 px-2 text-right font-mono-tabular text-emerald-700">
                          -{seg.alightings}
                        </td>
                        <td className="py-2 pl-2 text-right font-mono-tabular font-bold text-slate-900">
                          {seg.runningLoad} pax
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* Static GTFS Integration & Configurable Capacity Calibration */}
        <section className="lg:col-span-6 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
                  <FolderArchive className="w-4 h-4 text-teal-700" />
                  Static GTFS Import & Stop Sequence Reconstruction
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Upload <code className="font-mono">routes.txt</code>, <code className="font-mono">trips.txt</code>, <code className="font-mono">stops.txt</code>, <code className="font-mono">stop_times.txt</code>, <code className="font-mono">calendar.txt</code>, <code className="font-mono">calendar_dates.txt</code> or a GTFS <code className="font-mono">.zip</code>.
                </p>
              </div>
              <label className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap shrink-0">
                {gtfsLoading ? 'Parsing GTFS...' : 'Select GTFS Files / ZIP'}
                <input
                  type="file"
                  multiple
                  accept=".txt,.csv,.zip"
                  onChange={handleGtfsUpload}
                  disabled={gtfsLoading}
                  className="sr-only"
                />
              </label>
            </div>

            {gtfsError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                {gtfsError}
              </p>
            )}

            {gtfsData ? (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1.5">
                <div className="font-semibold text-teal-800">
                  Parsed GTFS files: {gtfsData.summary.filesDetected.join(', ')}
                </div>
                <div className="font-mono-tabular text-slate-700">
                  Stops: {gtfsData.stops.length.toLocaleString()} · Directional Routes Reconstructed: {gtfsData.routes.length.toLocaleString()} · Trips: {gtfsData.summary.tripsCount.toLocaleString()} · Stop Times: {gtfsData.summary.stopTimesCount.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-600">
                  Calendar services: {gtfsData.serviceDaysSummary.weekdayServices} weekday · {gtfsData.serviceDaysSummary.weekendServices} weekend · {gtfsData.serviceDaysSummary.calendarExceptions} exceptions
                </div>
                {gtfsData.warnings.length > 0 && (
                  <div className="text-[11px] text-amber-800">
                    Warnings: {gtfsData.warnings.join(' · ')}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                No static GTFS uploaded yet. Demo Mode uses the sample Delhi corridor GTFS structure (8 bidirectional routes, 25 stops); Actual Data Mode never invents GTFS routes.
              </p>
            )}
          </div>

          {/* Configurable Vehicle Capacity */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-teal-700" />
              Configurable Capacity & Threshold Calibration
            </h2>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <label htmlFor="cfg-ac" className="block font-semibold text-slate-700 mb-1">
                  AC Bus Capacity (pax)
                </label>
                <input
                  id="cfg-ac"
                  type="number"
                  min={25}
                  max={80}
                  value={capacityConfig.acCapacity}
                  onChange={(e) =>
                    onUpdateCapacity({
                      ...capacityConfig,
                      acCapacity: Math.max(25, Number(e.target.value) || 45),
                    })
                  }
                  className="w-full h-9 px-3 bg-slate-50 border border-slate-300 rounded-lg font-mono-tabular"
                />
              </div>

              <div>
                <label htmlFor="cfg-nonac" className="block font-semibold text-slate-700 mb-1">
                  Non-AC Bus Capacity (pax)
                </label>
                <input
                  id="cfg-nonac"
                  type="number"
                  min={30}
                  max={90}
                  value={capacityConfig.nonAcCapacity}
                  onChange={(e) =>
                    onUpdateCapacity({
                      ...capacityConfig,
                      nonAcCapacity: Math.max(30, Number(e.target.value) || 50),
                    })
                  }
                  className="w-full h-9 px-3 bg-slate-50 border border-slate-300 rounded-lg font-mono-tabular"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Changes immediately recompute Crowding Ratio = Estimated Load / Assumed Capacity across Journey Results, Map, and Analytics.
            </p>
          </div>
        </section>
      </div>

      {/* 4. Sample / Actual ETM Ticket Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              {actualDataset && actualDataset.sampleRows.length > 0
                ? 'Actual Normalized ETM Ticket Sample (Asia/Kolkata)'
                : 'Sample ETM & E-Ticketing Records (Schema Reference)'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Required fields: created_at, vehicle_number, route, start_stop_name, end_stop_name, passenger_count, amount, ticket_type_id, is_ac.
            </p>
          </div>
          {actualDataset && actualDataset.sampleRows.length > 0 ? (
            <span className="text-[10px] font-mono-tabular font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-200">
              ACTUAL UPLOADED RECORDS
            </span>
          ) : (
            <span className="text-[10px] font-mono-tabular font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
              DEMO DATA – NOT ACTUAL TRANSPORT DATA
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-mono-tabular">
                <th className="py-2.5 px-3">created_at</th>
                <th className="py-2.5 px-3">vehicle_number</th>
                <th className="py-2.5 px-3">route</th>
                <th className="py-2.5 px-3">start_stop_name</th>
                <th className="py-2.5 px-3">end_stop_name</th>
                <th className="py-2.5 px-3 text-right">passenger_count</th>
                <th className="py-2.5 px-3 text-right">amount</th>
                <th className="py-2.5 px-3 text-right">ticket_type_id</th>
                <th className="py-2.5 px-3">is_ac</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono-tabular">
              {(actualDataset && actualDataset.sampleRows.length > 0
                ? actualDataset.sampleRows
                : SAMPLE_ETM_TICKETS
              )
                .slice(0, 10)
                .map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">{row.created_at}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">{row.vehicle_number}</td>
                    <td className="py-2.5 px-3 text-teal-800 font-semibold">{row.route}</td>
                    <td className="py-2.5 px-3 font-sans text-slate-800">{row.start_stop_name}</td>
                    <td className="py-2.5 px-3 font-sans text-slate-800">{row.end_stop_name}</td>
                    <td className="py-2.5 px-3 text-right font-semibold text-slate-900">{row.passenger_count}</td>
                    <td className="py-2.5 px-3 text-right text-slate-700">{row.amount}</td>
                    <td className="py-2.5 px-3 text-right text-slate-600">{row.ticket_type_id}</td>
                    <td className="py-2.5 px-3 text-slate-700">{row.is_ac ? 'true' : 'false'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4b. Chronological Model Evaluation (Baseline Median vs Random Forest) */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Chronological Model Evaluation (Earlier Weeks Train → Later Week Holdout Test)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Compares Historical Median Baseline against the Random Forest Regressor using MAE and RMSE (in passengers).
            </p>
          </div>
          <span className="text-[10px] font-mono-tabular font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
            SEPARATE DEMO VS ACTUAL EVALUATION
          </span>
        </div>

        {demoEvaluationReport.evaluationGroundTruthNote && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-slate-700">
            <strong>Ground Truth Methodology Note:</strong> {demoEvaluationReport.evaluationGroundTruthNote}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900">Simulated October 2026 Holdout Evaluation</span>
              <span className="font-mono-tabular text-slate-500">
                Train: {demoEvaluationReport.trainCount} · Test: {demoEvaluationReport.testCount}
              </span>
            </div>
            <div className="text-[11px] text-slate-600 font-mono-tabular">
              Train split: {demoEvaluationReport.trainDateRange} · Test split: {demoEvaluationReport.testDateRange}
            </div>
            {demoEvaluationReport.status === 'evaluated' && demoEvaluationReport.baselineMetrics && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <div className="text-xs font-semibold text-slate-800">
                    {demoEvaluationReport.baselineMetrics.modelName}
                  </div>
                  <div className="font-mono-tabular text-sm font-bold text-slate-900 mt-1">
                    MAE: {demoEvaluationReport.baselineMetrics.mae} pax
                  </div>
                  <div className="font-mono-tabular text-xs text-slate-600">
                    RMSE: {demoEvaluationReport.baselineMetrics.rmse} pax
                  </div>
                </div>
                {demoEvaluationReport.randomForestMetrics && (
                  <div className="bg-teal-50/60 border border-teal-200 rounded-lg p-3">
                    <div className="text-xs font-semibold text-teal-900">
                      {demoEvaluationReport.randomForestMetrics.modelName}
                    </div>
                    <div className="font-mono-tabular text-sm font-bold text-teal-900 mt-1">
                      MAE: {demoEvaluationReport.randomForestMetrics.mae} pax
                    </div>
                    <div className="font-mono-tabular text-xs text-teal-800">
                      RMSE: {demoEvaluationReport.randomForestMetrics.rmse} pax
                    </div>
                  </div>
                )}
              </div>
            )}

            {demoEvaluationReport.timePeriodBreakdown && demoEvaluationReport.timePeriodBreakdown.length > 0 && (
              <div className="pt-2 space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-700">Holdout Error by Time Period</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-1 pr-2">Period</th>
                        <th className="py-1 px-2 text-right">N</th>
                        <th className="py-1 px-2 text-right">Base MAE/RMSE</th>
                        <th className="py-1 pl-2 text-right">RF MAE/RMSE</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono-tabular">
                      {demoEvaluationReport.timePeriodBreakdown.map((row) => (
                        <tr key={row.period}>
                          <td className="py-1 pr-2 font-sans text-slate-700">{row.period}</td>
                          <td className="py-1 px-2 text-right text-slate-500">{row.sampleCount}</td>
                          <td className="py-1 px-2 text-right text-slate-900">
                            {row.baselineMae} / {row.baselineRmse}
                          </td>
                          <td className="py-1 pl-2 text-right text-teal-800">
                            {row.rfMae !== null ? `${row.rfMae} / ${row.rfRmse}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {demoEvaluationReport.routeBreakdown && demoEvaluationReport.routeBreakdown.length > 0 && (
              <div className="pt-2 space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-700">Holdout Error by Route</div>
                <div className="max-h-36 overflow-y-auto overflow-x-auto">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-1 pr-2">Route</th>
                        <th className="py-1 px-2 text-right">N</th>
                        <th className="py-1 px-2 text-right">Base MAE/RMSE</th>
                        <th className="py-1 pl-2 text-right">RF MAE/RMSE</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono-tabular">
                      {demoEvaluationReport.routeBreakdown.map((row) => (
                        <tr key={row.routeNumber}>
                          <td className="py-1 pr-2 font-semibold text-slate-800">R{row.routeNumber}</td>
                          <td className="py-1 px-2 text-right text-slate-500">{row.sampleCount}</td>
                          <td className="py-1 px-2 text-right text-slate-900">
                            {row.baselineMae} / {row.baselineRmse}
                          </td>
                          <td className="py-1 pl-2 text-right text-teal-800">
                            {row.rfMae !== null ? `${row.rfMae} / ${row.rfRmse}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <p className="text-xs text-slate-600">{demoEvaluationReport.reason}</p>
          </div>

          <div className="border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900">Actual Dataset Chronological Evaluation</span>
              <span className="font-mono-tabular text-[11px] text-slate-500">
                {actualDataset
                  ? actualDataset.evaluationReport.status === 'evaluated'
                    ? 'Evaluated'
                    : 'Insufficient Data'
                  : 'Awaiting Dataset'}
              </span>
            </div>
            {actualDataset ? (
              actualDataset.evaluationReport.status === 'evaluated' &&
              actualDataset.evaluationReport.baselineMetrics ? (
                <div className="space-y-3 text-xs">
                  <div className="font-mono-tabular text-slate-600">
                    Train: {actualDataset.evaluationReport.trainDateRange} ({actualDataset.evaluationReport.trainCount}) · Test: {actualDataset.evaluationReport.testDateRange} ({actualDataset.evaluationReport.testCount})
                  </div>
                  <div className="font-mono-tabular font-semibold text-slate-900">
                    Baseline MAE: {actualDataset.evaluationReport.baselineMetrics.mae} pax · RMSE: {actualDataset.evaluationReport.baselineMetrics.rmse} pax
                  </div>
                  {actualDataset.evaluationReport.randomForestMetrics && (
                    <div className="font-mono-tabular font-semibold text-teal-800">
                      Random Forest MAE: {actualDataset.evaluationReport.randomForestMetrics.mae} pax · RMSE: {actualDataset.evaluationReport.randomForestMetrics.rmse} pax
                    </div>
                  )}
                  {actualDataset.evaluationReport.timePeriodBreakdown &&
                    actualDataset.evaluationReport.timePeriodBreakdown.length > 0 && (
                      <div className="overflow-x-auto pt-1">
                        <table className="w-full text-left text-[11px] border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-500">
                              <th className="py-1 pr-2">Period</th>
                              <th className="py-1 px-2 text-right">N</th>
                              <th className="py-1 px-2 text-right">Base MAE/RMSE</th>
                              <th className="py-1 pl-2 text-right">RF MAE/RMSE</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-mono-tabular">
                            {actualDataset.evaluationReport.timePeriodBreakdown.map((row) => (
                              <tr key={row.period}>
                                <td className="py-1 pr-2 font-sans text-slate-700">{row.period}</td>
                                <td className="py-1 px-2 text-right text-slate-500">{row.sampleCount}</td>
                                <td className="py-1 px-2 text-right text-slate-900">
                                  {row.baselineMae} / {row.baselineRmse}
                                </td>
                                <td className="py-1 pl-2 text-right text-teal-800">
                                  {row.rfMae !== null ? `${row.rfMae} / ${row.rfRmse}` : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
                  <strong>Insufficient data for chronological evaluation:</strong> {actualDataset.evaluationReport.reason}
                </div>
              )
            ) : (
              <p className="text-xs text-slate-500">
                Ingest multi-week ETM records alongside static GTFS route stop sequences to evaluate Baseline Median vs. Random Forest on actual holdout weeks.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 5. Methodological Assumptions & Backend/PostGIS Architecture */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-3">
          <h2 className="font-display text-base font-bold text-slate-900">
            Explicit Estimation Assumptions & Limitations
          </h2>
          <ul className="space-y-2 text-xs text-slate-600 leading-relaxed list-disc pl-4">
            <li>
              <strong>Planned vs. Actual Alighting:</strong> Ticket <code className="font-mono">end_stop_name</code> reflects the destination paid for at boarding, not guaranteed physical alighting stop.
            </li>
            <li>
              <strong>Unrecorded Pass Holders:</strong> ETM records may undercount monthly pass holders, smart-card commuters, or free-travel concession riders.
            </li>
            <li>
              <strong>Trip Grouping Ambiguity:</strong> Grouping by <code className="font-mono">(vehicle_number, route)</code> alone is unreliable; CrowdSense splits trips using inter-ticket layovers and GTFS direction reversals.
            </li>
            <li>
              <strong>Prototype Thresholds:</strong> Vehicle capacities and 70% / 100% / 120% crowding thresholds are configurable prototype assumptions, not official transport standards.
            </li>
          </ul>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-3">
          <h2 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
            <Server className="w-4 h-4 text-teal-700" />
            Scalable Streaming & FastAPI / Pandas Architecture
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Built with both a disk-streaming Node.js ingestion backend (<code className="font-mono">server.ts</code>) and a chunked Python FastAPI + Pandas + Scikit-learn backend (<code className="font-mono">backend/</code>) using <code className="font-mono">chunksize=100_000</code> so 2.56M+ ticket files never load into browser memory:
          </p>
          <div className="bg-slate-900 text-slate-100 rounded-lg p-3.5 font-mono text-[11px] space-y-1 overflow-x-auto">
            <div className="text-teal-300 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5" />
              Active API & Streaming Endpoints
            </div>
            <div>POST /api/v1/etm/ingest-upload  # Stream .csv or .zip to disk</div>
            <div>POST /api/v1/etm/ingest-url     # Download & stream remote dataset</div>
            <div>POST /api/v1/gtfs/ingest        # Parse GTFS .txt or .zip archive</div>
            <div>GET  /api/v1/analytics/segments # Paginated pre-aggregated segments</div>
            <div>GET  /api/v1/analytics/hotspots # Recurring crowding hotspots</div>
            <div>GET  /api/v1/dataset/status     # Inspect active server dataset</div>
          </div>
        </section>
      </div>

      {/* 6. Technical Architecture Documentation & Live Hackathon Readiness */}
      <details className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
        <summary className="cursor-pointer font-display text-base font-bold text-slate-900 select-none">
          Technical System Documentation (14 Sections) &amp; Live Readiness Matrix
        </summary>
        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600 leading-relaxed">
          <div className="space-y-2">
            <p><strong>1. Problem &amp; Concept:</strong> Standard bus planners minimize travel time/transfers alone; CrowdSense adds stop-segment predicted occupancy so riders avoid overloaded corridors.</p>
            <p><strong>2. Architecture:</strong> React 19 + TypeScript SPA backed by an Express + Node disk-streaming processor (<code className="font-mono">server.ts</code>) and optional Python FastAPI worker (<code className="font-mono">backend/</code>).</p>
            <p><strong>3. Data Sources &amp; Schema:</strong> 9-field ETM ticket records (<code className="font-mono">created_at, vehicle_number, route, start_stop_name, end_stop_name, passenger_count, amount, ticket_type_id, is_ac</code>) normalized to <code className="font-mono">Asia/Kolkata</code> + static GTFS 6-file feed.</p>
            <p><strong>4. Cleaning &amp; GTFS Mapping:</strong> Bounded streaming deduplication, negative/zero passenger filtering, and multi-pass normalized stop matching with explicit ambiguous/unmatched reporting.</p>
            <p><strong>5. Passenger Load Logic:</strong> <code className="font-mono">Load[s] = max(0, Prev + Boarding - Alighting)</code> after chronological vehicle+route layover (45m) and GTFS direction-reversal trip splitting.</p>
            <p><strong>6. Crowding Classification &amp; Models:</strong> Historical Median Baseline (with fallback hierarchy) vs. 12-tree Random Forest Regressor across 70%/100%/120% capacity thresholds.</p>
            <p><strong>7. Confidence &amp; Explainability:</strong> Multi-factor scoring over observation depth, weekly CV, GTFS stop matching, trip reliability, and missingness; missing segments never score as low crowding.</p>
          </div>
          <div className="space-y-2">
            <p><strong>8. Evaluation &amp; Weekly Consistency:</strong> Strict chronological train/test split reporting overall, per-route, and per-period MAE/RMSE against ticket-derived loads (not physical headcounts).</p>
            <p><strong>9. Journey Graph &amp; Recommendations:</strong> Time-dependent directed GTFS graph supporting direct, 1-transfer, 2-transfer, calendar filtering, walking links (&le;350m), and configurable Balanced weights.</p>
            <p><strong>10. Crowding Map &amp; Analytics:</strong> Leaflet OpenStreetMap corridor explorer + 7 Recharts views, stability diagnostics, recurring hotspots, and 5 filtered CSV exports.</p>
            <p><strong>11. Live Verification Snapshot:</strong> Demo Holdout Test N={demoEvaluationReport.testCount} (Base RMSE {demoEvaluationReport.baselineMetrics?.rmse ?? 'N/A'} vs RF RMSE {demoEvaluationReport.randomForestMetrics?.rmse ?? 'N/A'}); Actual Dataset: {actualDataset ? `${actualDataset.validRecords.toLocaleString()} valid rows (${actualDataset.status})` : 'Not ingested in current session'}; GTFS: {gtfsData ? `${gtfsData.stops.length} stops, ${gtfsData.routes.length} routes` : 'Using Demo corridor catalog'}.</p>
            <p><strong>12. Remaining Scope:</strong> Live bus GPS/AVL feeds, physical APC/CCTV occupancy sensors, and full 2.56M-row trip reconstruction beyond the 16k stratified reservoir sample remain future production extensions.</p>
          </div>
        </div>
      </details>
    </div>
  );
}
