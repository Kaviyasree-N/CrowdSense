import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Info, RotateCcw, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { ConfidenceTag, CrowdBadge } from '../components/CrowdBadge';
import { KPIcard } from '../components/KPIcard';
import { SAMPLE_ROUTES } from '../data/sampleRoutes';
import { actualDataService } from '../services/actualDataService';
import { AnalyticsFilterState, dataService, PaginatedSegmentsResult } from '../services/dataService';
import type { ActualDatasetResult, CapacityConfig, CrowdingLevel, DataMode } from '../types/transit';
import { getCrowdingStyle } from '../utils/crowdClassification';
import {
  downloadCsvFile,
  generateDataQualityCsv,
  generateHotspotReportCsv,
  generateHourlyDemandCsv,
  generateRouteDemandCsv,
  generateSegmentCrowdingCsv,
} from '../utils/csvExport';

interface AnalyticsDashboardProps {
  capacityConfig: CapacityConfig;
  dataMode?: DataMode;
  actualDataset?: ActualDatasetResult | null;
}

export function AnalyticsDashboard({
  capacityConfig,
  dataMode = 'demo',
  actualDataset = null,
}: AnalyticsDashboardProps) {
  const isActual = dataMode === 'actual' && Boolean(actualDataset);

  const defaultDates = useMemo(
    () => ({
      start:
        isActual && actualDataset?.dateRangeIST.start && actualDataset.dateRangeIST.start !== 'N/A'
          ? actualDataset.dateRangeIST.start
          : '2026-10-01',
      end:
        isActual && actualDataset?.dateRangeIST.end && actualDataset.dateRangeIST.end !== 'N/A'
          ? actualDataset.dateRangeIST.end
          : '2026-10-31',
    }),
    [isActual, actualDataset]
  );

  const [filters, setFilters] = useState<AnalyticsFilterState>({
    dateStart: defaultDates.start,
    dateEnd: defaultDates.end,
    routeNumber: 'ALL',
    dayType: 'all',
    timePeriod: 'all',
    direction: 'all',
  });

  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      dateStart: defaultDates.start,
      dateEnd: defaultDates.end,
      routeNumber: 'ALL',
    }));
  }, [defaultDates.start, defaultDates.end, isActual]);

  const [segmentPage, setSegmentPage] = useState(1);
  const [segmentCrowdingFilter, setSegmentCrowdingFilter] = useState<'ALL' | CrowdingLevel>('ALL');
  const [serverSegments, setServerSegments] = useState<PaginatedSegmentsResult | null>(null);
  const [segmentsLoading, setSegmentsLoading] = useState(false);

  const uniqueRoutes = useMemo(
    () =>
      isActual && actualDataset
        ? actualDataset.routeVolume.map((r) => r.routeNumber)
        : Array.from(new Set(SAMPLE_ROUTES.map((r) => r.route_number))),
    [isActual, actualDataset]
  );

  const summary = useMemo(
    () =>
      isActual && actualDataset
        ? dataService.getActualAnalyticsSummary(actualDataset, filters, capacityConfig)
        : dataService.getAnalyticsSummary(filters, capacityConfig),
    [isActual, actualDataset, filters, capacityConfig]
  );

  // Reset segment pagination to page 1 when filters change
  useEffect(() => {
    setSegmentPage(1);
  }, [filters, segmentCrowdingFilter, isActual]);

  // Fetch paginated segments from backend in Actual Mode (gracefully falling back to local pagination)
  useEffect(() => {
    let active = true;
    if (!isActual) {
      setServerSegments(null);
      setSegmentsLoading(false);
      return;
    }

    setSegmentsLoading(true);
    actualDataService
      .fetchPaginatedSegments({
        page: segmentPage,
        limit: 12,
        routeNumber: filters.routeNumber,
        dayType: filters.dayType,
        timePeriod: filters.timePeriod,
        direction: filters.direction,
        crowdingLevel: segmentCrowdingFilter,
        acCapacity: capacityConfig.acCapacity,
        nonAcCapacity: capacityConfig.nonAcCapacity,
      })
      .then((res) => {
        if (!active) return;
        setServerSegments(res);
      })
      .finally(() => {
        if (active) setSegmentsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isActual, segmentPage, filters, segmentCrowdingFilter, capacityConfig]);

  const paginatedSegments: PaginatedSegmentsResult = useMemo(() => {
    if (isActual && serverSegments) return serverSegments;
    if (isActual && actualDataset) {
      return dataService.paginateActualSegmentsLocal(
        actualDataset,
        filters,
        capacityConfig,
        segmentPage,
        12,
        segmentCrowdingFilter
      );
    }
    return dataService.paginateDemoSegments(
      filters,
      capacityConfig,
      segmentPage,
      12,
      segmentCrowdingFilter
    );
  }, [isActual, serverSegments, actualDataset, filters, capacityConfig, segmentPage, segmentCrowdingFilter]);

  const badgeLabel = isActual
    ? 'ACTUAL DATA MODE'
    : 'DEMO DATA – NOT ACTUAL TRANSPORT DATA';

  const handleResetFilters = () => {
    setFilters({
      dateStart: defaultDates.start,
      dateEnd: defaultDates.end,
      routeNumber: 'ALL',
      dayType: 'all',
      timePeriod: 'all',
      direction: 'all',
    });
    setSegmentCrowdingFilter('ALL');
    setSegmentPage(1);
  };

  const handleExport = (
    kind: 'routes' | 'segments' | 'hourly' | 'hotspots' | 'quality'
  ) => {
    const modeTag = isActual ? 'actual' : 'demo';
    switch (kind) {
      case 'routes':
        downloadCsvFile(
          `crowdsense-route-demand-${modeTag}.csv`,
          generateRouteDemandCsv(summary.routeDemand, filters, badgeLabel)
        );
        break;
      case 'segments':
        downloadCsvFile(
          `crowdsense-segment-crowding-${modeTag}.csv`,
          generateSegmentCrowdingCsv(summary.allFilteredSegments, filters, badgeLabel)
        );
        break;
      case 'hourly':
        downloadCsvFile(
          `crowdsense-hourly-demand-${modeTag}.csv`,
          generateHourlyDemandCsv(summary.hourlyDemand, filters, badgeLabel)
        );
        break;
      case 'hotspots':
        downloadCsvFile(
          `crowdsense-critical-hotspots-${modeTag}.csv`,
          generateHotspotReportCsv(summary.criticalHotspots, filters, badgeLabel)
        );
        break;
      case 'quality':
        downloadCsvFile(
          `crowdsense-data-quality-${modeTag}.csv`,
          generateDataQualityCsv(
            summary.reliabilityIndicators,
            isActual ? actualDataset : null,
            filters,
            badgeLabel
          )
        );
        break;
    }
  };

  const { reliabilityIndicators: rel } = summary;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-teal-800">
            Transport Operator Demand &amp; Overload Intelligence
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
            Operator Analytics &amp; Corridor Reliability
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Analyze ETM passenger demand, weekly consistency, recurring crowding hotspots, and GTFS prediction coverage.
          </p>
        </div>

        <span
          className={`text-xs font-mono-tabular font-semibold px-2.5 py-1 rounded border whitespace-nowrap self-start md:self-auto ${
            isActual
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-amber-50 text-amber-800 border-amber-200'
          }`}
        >
          {badgeLabel}
        </span>
      </div>

      {/* Filters & Export Controls */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end">
          <div>
            <label htmlFor="f-start" className="block text-[11px] font-semibold text-slate-600 mb-1">
              Start Date
            </label>
            <input
              id="f-start"
              type="date"
              min={defaultDates.start}
              max={defaultDates.end}
              value={filters.dateStart}
              onChange={(e) => setFilters((f) => ({ ...f, dateStart: e.target.value }))}
              className="w-full h-9 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono-tabular"
            />
          </div>

          <div>
            <label htmlFor="f-end" className="block text-[11px] font-semibold text-slate-600 mb-1">
              End Date
            </label>
            <input
              id="f-end"
              type="date"
              min={defaultDates.start}
              max={defaultDates.end}
              value={filters.dateEnd}
              onChange={(e) => setFilters((f) => ({ ...f, dateEnd: e.target.value }))}
              className="w-full h-9 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono-tabular"
            />
          </div>

          <div>
            <label htmlFor="f-route" className="block text-[11px] font-semibold text-slate-600 mb-1">
              Route Number
            </label>
            <select
              id="f-route"
              value={filters.routeNumber}
              onChange={(e) => setFilters((f) => ({ ...f, routeNumber: e.target.value }))}
              className="w-full h-9 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium"
            >
              <option value="ALL">All Routes</option>
              {uniqueRoutes.map((r) => (
                <option key={r} value={r}>
                  Route {r}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="f-daytype" className="block text-[11px] font-semibold text-slate-600 mb-1">
              Weekday / Weekend
            </label>
            <select
              id="f-daytype"
              value={filters.dayType}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  dayType: e.target.value as AnalyticsFilterState['dayType'],
                }))
              }
              className="w-full h-9 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium"
            >
              <option value="all">All Days</option>
              <option value="weekday">Weekday Only</option>
              <option value="weekend">Weekend Only</option>
            </select>
          </div>

          <div>
            <label htmlFor="f-time" className="block text-[11px] font-semibold text-slate-600 mb-1">
              Time of Day
            </label>
            <select
              id="f-time"
              value={filters.timePeriod}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  timePeriod: e.target.value as AnalyticsFilterState['timePeriod'],
                }))
              }
              className="w-full h-9 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium"
            >
              <option value="all">All Day (05:00–23:00)</option>
              <option value="morning">Morning Peak (06:00–10:00)</option>
              <option value="midday">Midday (11:00–15:00)</option>
              <option value="evening">Evening Peak (16:00–20:00)</option>
              <option value="night">Late Evening (21:00–23:00)</option>
            </select>
          </div>

          <div>
            <label htmlFor="f-dir" className="block text-[11px] font-semibold text-slate-600 mb-1">
              Direction
            </label>
            <select
              id="f-dir"
              value={filters.direction}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  direction: e.target.value as AnalyticsFilterState['direction'],
                }))
              }
              className="w-full h-9 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium"
            >
              <option value="all">All Directions</option>
              <option value="UP">UP</option>
              <option value="DOWN">DOWN</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleResetFilters}
            className="h-9 px-3 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Filters
          </button>
        </div>

        {/* 5 Filtered CSV Export Buttons */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <FileSpreadsheet className="w-4 h-4 text-teal-700" />
            <span>Export Filtered Reports (CSV):</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleExport('routes')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-teal-700" />
              Route Demand
            </button>
            <button
              type="button"
              onClick={() => handleExport('segments')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-teal-700" />
              Segment Crowding
            </button>
            <button
              type="button"
              onClick={() => handleExport('hourly')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-teal-700" />
              Hourly Demand
            </button>
            <button
              type="button"
              onClick={() => handleExport('hotspots')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-teal-700" />
              Critical Hotspots
            </button>
            <button
              type="button"
              onClick={() => handleExport('quality')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-teal-700" />
              Data Quality
            </button>
          </div>
        </div>
      </section>

      {/* 8 Operator KPI Cards (4 x 2 Grid) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIcard
          label="1. Total Ticket Records"
          value={summary.kpis.totalTicketsAnalyzed.toLocaleString()}
          subtitle={isActual ? actualDataset!.sourceName : 'Filtered Oct 2026 ETM rows'}
        />
        <KPIcard
          label="2. Recorded Passenger Count"
          value={summary.kpis.totalRecordedPassengers.toLocaleString()}
          subtitle="Sum of ticket passenger_count"
          accent="teal"
        />
        <KPIcard
          label="3. Unique Bus Routes"
          value={summary.kpis.routeCount}
          subtitle={isActual ? 'Active ETM routes' : 'Active corridor routes'}
        />
        <KPIcard
          label="4. Unique Vehicles"
          value={summary.kpis.uniqueVehicles.toLocaleString()}
          subtitle="Distinct vehicle_number units"
        />
        <KPIcard
          label="5. Identified Route Segments"
          value={summary.kpis.identifiedSegmentsCount.toLocaleString()}
          subtitle="Directed stop-to-stop links"
        />
        <KPIcard
          label="6. Most Crowded Route"
          value={summary.kpis.mostCrowdedRoute}
          subtitle="Highest mean occupancy %"
          accent="red"
        />
        <KPIcard
          label="7. Peak Demand Hour"
          value={summary.kpis.peakTravelHour}
          subtitle="Peak IST passenger window"
          accent="amber"
        />
        <KPIcard
          label="8. Crowded / Very Crowded Segments"
          value={`${summary.kpis.overloadedSegmentsPct}%`}
          subtitle={`Mean occupancy: ${summary.kpis.avgEstimatedOccupancy}%`}
          accent={summary.kpis.overloadedSegmentsPct >= 25 ? 'red' : 'default'}
        />
      </section>

      {/* 7 Interactive Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* A. Hourly Passenger Demand */}
        <AnalyticsChart
          title="1. Hourly Passenger Demand (05:00–23:00 IST)"
          subtitle="Modeled segment load / hourly passenger intensity across active operating hours"
          dataSourceLabel={badgeLabel}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={summary.hourlyDemand} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Area
                type="monotone"
                dataKey="avgLoad"
                name="Avg Segment Load / Demand"
                stroke="#0F766E"
                fill="#CCFBF1"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </AnalyticsChart>

        {/* B. Daily Demand Across October Dates */}
        <AnalyticsChart
          title="2. Daily Demand Across Available Dates"
          subtitle="Daily ETM ticket volume and recorded passenger_count totals"
          dataSourceLabel={badgeLabel}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={summary.dailyTrends} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="dayLabel" tick={{ fontSize: 10, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area
                type="monotone"
                dataKey="estimatedPassengers"
                name="Recorded Passengers"
                stroke="#0F172A"
                fill="#E2E8F0"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="ticketsAnalyzed"
                name="ETM Tickets Issued"
                stroke="#0F766E"
                fill="#CCFBF1"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </AnalyticsChart>

        {/* C. Weekday vs Weekend Demand */}
        <AnalyticsChart
          title="3. Weekday vs. Weekend Demand Comparison"
          subtitle="Commuter morning/evening peaks compared against weekend travel profiles"
          dataSourceLabel={badgeLabel}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={summary.hourlyDemand} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="weekdayAvg"
                name="Weekday"
                stroke="#0F172A"
                strokeWidth={2.2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="weekendAvg"
                name="Weekend"
                stroke="#0D9488"
                strokeWidth={2.2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </AnalyticsChart>

        {/* D. Route-wise Demand */}
        <AnalyticsChart
          title="4. Route-Wise Demand & Occupancy"
          subtitle="Routes ranked by estimated average occupancy percentage"
          dataSourceLabel={badgeLabel}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summary.routeDemand} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="route" tick={{ fontSize: 10, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} unit="%" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="avgOccupancyPct" name="Avg Occupancy (%)" fill="#0F172A" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </AnalyticsChart>

        {/* E. Segment-wise Crowding */}
        <AnalyticsChart
          title={`5. Segment-Wise Crowding (${summary.segmentChartRouteLabel})`}
          subtitle="Busiest stop-to-stop corridor stretches showing buildup & alighting relief"
          dataSourceLabel={badgeLabel}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summary.segmentWiseLoad} margin={{ top: 10, right: 12, left: -12, bottom: 18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis
                dataKey="segment"
                tick={{ fontSize: 10, fill: '#475569' }}
                interval={0}
                angle={-18}
                textAnchor="end"
                height={50}
              />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="avgLoad" name="Avg Segment Load (pax)" fill="#0D9488" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </AnalyticsChart>

        {/* F. Crowding Distribution (% of segments) */}
        <AnalyticsChart
          title="6. Crowding Distribution (% of Evaluated Segments)"
          subtitle="Share of route-segment-hour slots across crowding categories"
          dataSourceLabel={badgeLabel}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summary.crowdingDistribution} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} domain={[0, 100]} unit="%" />
              <Tooltip
                formatter={(value, _name, props) => [
                  `${value}% (${props?.payload?.count ?? 0} segment slots)`,
                  'Share',
                ]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="pct" name="% of Segments" radius={[4, 4, 0, 0]}>
                {summary.crowdingDistribution.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={getCrowdingStyle(entry.name as CrowdingLevel).hex}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </AnalyticsChart>
      </div>

      {/* G. Weekly Consistency (Full Width) */}
      <AnalyticsChart
        title="7. Weekly Demand Consistency (October Weeks 1–5)"
        subtitle="Compares total & average daily passenger demand across weeks to distinguish recurring corridors from isolated spikes"
        dataSourceLabel={badgeLabel}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={summary.weeklyConsistency} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
            <XAxis dataKey="weekLabel" tick={{ fontSize: 11, fill: '#475569' }} />
            <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
            <Tooltip
              formatter={(value, name) => [
                Number(value ?? 0).toLocaleString(),
                String(name ?? ''),
              ]}
              labelFormatter={(label, payload) => {
                const range = payload?.[0]?.payload?.dateRange;
                return range ? `${label} (${range})` : String(label);
              }}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="avgDailyPassengers" name="Avg Daily Passengers" fill="#0F766E" radius={[4, 4, 0, 0]} />
            <Bar dataKey="weekdayPassengers" name="Total Weekday Passengers" fill="#0F172A" radius={[4, 4, 0, 0]} />
            <Bar dataKey="weekendPassengers" name="Total Weekend Passengers" fill="#94A3B8" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </AnalyticsChart>

      {/* Critical Crowding Hotspots (Recurring Overload Prioritized) */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Critical Crowding Hotspots (Recurring Overload Priority)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Prioritizes segments exceeding capacity across repeated observations rather than single isolated spikes.
            </p>
          </div>
          <span className="text-xs font-mono-tabular text-slate-600">
            {summary.criticalHotspots.filter((h) => h.isRecurring).length} recurring ·{' '}
            {summary.criticalHotspots.length} total overloaded stretches
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-3 px-4">Route</th>
                <th className="py-3 px-4">Dir</th>
                <th className="py-3 px-4">Starting Stop</th>
                <th className="py-3 px-4">Ending Stop</th>
                <th className="py-3 px-4">Peak Hour</th>
                <th className="py-3 px-4 text-right">Est. Load / Cap</th>
                <th className="py-3 px-4 text-right">Occupancy %</th>
                <th className="py-3 px-4 text-right">Observations</th>
                <th className="py-3 px-4">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.criticalHotspots.slice(0, 12).map((row, idx) => (
                <tr key={`${row.routeId}-${row.fromStop}-${idx}`} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono-tabular font-semibold text-slate-900">
                    Route {row.routeNumber}
                  </td>
                  <td className="py-3 px-4 font-mono-tabular text-slate-600">{row.direction}</td>
                  <td className="py-3 px-4 text-slate-800 font-medium">{row.fromStop}</td>
                  <td className="py-3 px-4 text-slate-800 font-medium">{row.toStop}</td>
                  <td className="py-3 px-4 font-mono-tabular text-slate-600">
                    {row.timePeriod}
                  </td>
                  <td className="py-3 px-4 text-right font-mono-tabular text-slate-900">
                    {row.estimatedLoad} / {row.assumedCapacity}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-2 justify-end">
                      <span className="font-mono-tabular font-bold text-slate-900">
                        {row.occupancyPct}%
                      </span>
                      <CrowdBadge level={row.crowdingLevel} compact />
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right font-mono-tabular text-slate-700">
                    {row.observationsCount}
                    {!row.isRecurring && (
                      <span className="block text-[10px] text-amber-700">Low sample</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <ConfidenceTag confidence={row.confidence} />
                  </td>
                </tr>
              ))}
              {summary.criticalHotspots.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
                    No segments exceed 100% capacity for the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Deterministic Transport Planning Insights & Data Reliability Indicators */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Transport Planning Insights
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Deterministic, rule-based operational findings computed strictly from active dataset metrics.
              </p>
            </div>
            <span className="text-[10px] font-mono-tabular font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
              RULE-BASED ANALYTICS
            </span>
          </div>

          <div className="space-y-3">
            {summary.planningInsights.map((ins) => (
              <div
                key={ins.id}
                className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-slate-900">{ins.title}</h3>
                  <span className="text-[11px] font-mono-tabular font-semibold text-teal-800 whitespace-nowrap">
                    {ins.metricLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{ins.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-teal-700" />
                Data Reliability Indicators
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Dataset coverage, stop matching quality, trip reconstruction ambiguity, and coverage limits.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-lg border border-slate-200">
              <div className="text-[11px] text-slate-500">Valid Ticket Records</div>
              <div className="font-mono-tabular text-sm font-bold text-slate-900 mt-0.5">
                {rel.validRecords.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500">
                of {rel.totalRecords.toLocaleString()} parsed
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200">
              <div className="text-[11px] text-slate-500">GTFS Stop Match %</div>
              <div className="font-mono-tabular text-sm font-bold text-slate-900 mt-0.5">
                {rel.stopMatchingPct}%
              </div>
              <div className="text-[10px] text-slate-500">
                {rel.unmatchedStopsCount} unmatched stop(s)
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200">
              <div className="text-[11px] text-slate-500">Prediction Coverage</div>
              <div className="font-mono-tabular text-sm font-bold text-slate-900 mt-0.5">
                {rel.predictionCoveragePct}%
              </div>
              <div className="text-[10px] text-slate-500">
                {rel.segmentsWithPredictions}/{rel.totalSegmentsCataloged} segments
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200">
              <div className="text-[11px] text-slate-500">Identified Trips</div>
              <div className="font-mono-tabular text-sm font-bold text-slate-900 mt-0.5">
                {rel.identifiedTrips.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500">Reconstructed chains</div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200">
              <div className="text-[11px] text-slate-500">Ambiguous Groupings</div>
              <div className="font-mono-tabular text-sm font-bold text-amber-700 mt-0.5">
                {rel.ambiguousTrips.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500">Flagged trip overlaps</div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200">
              <div className="text-[11px] text-slate-500">Low-Confidence Slots</div>
              <div className="font-mono-tabular text-sm font-bold text-slate-900 mt-0.5">
                {rel.lowConfidencePredictionsCount.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500">
                {rel.lowConfidenceSharePct}% of evaluated slots
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-600 space-y-2 pt-1">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
              <span>
                <strong className="text-slate-800">Coverage Window:</strong> {rel.datasetCoverageLabel} ({rel.dateRangeLabel})
              </span>
            </div>
            {rel.unmatchedStopsSample.length > 0 && (
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-slate-800">Sample Unmatched Stops:</strong>{' '}
                  {rel.unmatchedStopsSample.slice(0, 5).join(', ')}
                </span>
              </div>
            )}
          </div>

          {/* Explicit distinction between Recorded Passenger Demand vs Estimated Segment Occupancy */}
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700 space-y-1.5">
            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-teal-700" />
              Methodology Distinction: Recorded Demand vs. Estimated Occupancy
            </div>
            <p>
              <strong>Recorded Passenger Demand:</strong> {rel.recordedDemandNote}
            </p>
            <p>
              <strong>Estimated Segment Occupancy:</strong> {rel.estimatedOccupancyNote}
            </p>
          </div>
        </section>
      </div>

      {/* Paginated Segment-Level Crowding Explorer */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Segment-Level Crowding Directory
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pre-aggregated segment estimates paginated cleanly ({paginatedSegments.total.toLocaleString()} matching segment-hour rows).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="seg-crowd-filter" className="text-xs font-medium text-slate-600">
              Category:
            </label>
            <select
              id="seg-crowd-filter"
              value={segmentCrowdingFilter}
              onChange={(e) => setSegmentCrowdingFilter(e.target.value as 'ALL' | CrowdingLevel)}
              className="h-8 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium"
            >
              <option value="ALL">All Categories</option>
              <option value="Seats Available">Seats Available</option>
              <option value="Standing Room">Standing Room</option>
              <option value="Crowded">Crowded</option>
              <option value="Very Crowded">Very Crowded</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-3 px-4">Route</th>
                <th className="py-3 px-4">Direction</th>
                <th className="py-3 px-4">Starting Stop</th>
                <th className="py-3 px-4">Ending Stop</th>
                <th className="py-3 px-4">Time Period</th>
                <th className="py-3 px-4 text-right">Est. Passenger Load</th>
                <th className="py-3 px-4 text-right">Obs</th>
                <th className="py-3 px-4">Crowding Category</th>
                <th className="py-3 px-4">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {segmentsLoading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={`skel-${idx}`}>
                    <td colSpan={9} className="py-3 px-4">
                      <div className="h-4 bg-slate-100 rounded animate-pulse w-full" />
                    </td>
                  </tr>
                ))
              ) : (
                paginatedSegments.items.map((row, idx) => (
                  <tr key={`${row.routeNumber}-${row.fromStop}-${row.timePeriod}-${idx}`} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono-tabular font-semibold text-slate-900">
                      Route {row.routeNumber}
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-slate-600">{row.direction}</td>
                    <td className="py-3 px-4 text-slate-800 font-medium">{row.fromStop}</td>
                    <td className="py-3 px-4 text-slate-800 font-medium">{row.toStop}</td>
                    <td className="py-3 px-4 font-mono-tabular text-slate-600">{row.timePeriod}</td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-slate-900">
                      {row.estimatedLoad} / {row.assumedCapacity} ({row.occupancyPct}%)
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-slate-600">
                      {row.observationsCount}
                    </td>
                    <td className="py-3 px-4">
                      <CrowdBadge level={row.crowdingLevel} compact />
                    </td>
                    <td className="py-3 px-4">
                      <ConfidenceTag confidence={row.confidence} />
                    </td>
                  </tr>
                ))
              )}
              {!segmentsLoading && paginatedSegments.items.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
                    No segments match the current filter combination.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span className="font-mono-tabular">
            Page {paginatedSegments.page} of {paginatedSegments.totalPages} · {paginatedSegments.total.toLocaleString()} total rows
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={paginatedSegments.page <= 1}
              onClick={() => setSegmentPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 rounded border border-slate-300 bg-white font-medium text-slate-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={paginatedSegments.page >= paginatedSegments.totalPages}
              onClick={() =>
                setSegmentPage((p) => Math.min(paginatedSegments.totalPages, p + 1))
              }
              className="px-3 py-1 rounded border border-slate-300 bg-white font-medium text-slate-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
