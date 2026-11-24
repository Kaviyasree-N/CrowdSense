import { useMemo, useState } from 'react';
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
import { AnalyticsFilterState, dataService } from '../services/dataService';
import type { ActualDatasetResult, CapacityConfig, CrowdingLevel, DataMode } from '../types/transit';
import { getCrowdingStyle } from '../utils/crowdClassification';

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

  const [filters, setFilters] = useState<AnalyticsFilterState>({
    dateStart: isActual && actualDataset?.dateRangeIST.start !== 'N/A' ? actualDataset!.dateRangeIST.start : '2026-10-01',
    dateEnd: isActual && actualDataset?.dateRangeIST.end !== 'N/A' ? actualDataset!.dateRangeIST.end : '2026-10-31',
    routeNumber: 'ALL',
    dayType: 'all',
    timePeriod: 'all',
    direction: 'all',
  });

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

  const peakHourTrends = useMemo(() => {
    return summary.hourlyDemand.filter((h) => h.hourNum >= 7 && h.hourNum <= 21);
  }, [summary.hourlyDemand]);

  const badgeLabel = isActual
    ? 'ACTUAL DATA MODE'
    : 'DEMO DATA – NOT ACTUAL TRANSPORT DATA';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-teal-800">
            Transport Operator Demand & Overload Intelligence
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
            Network Demand Analytics
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Monitor hourly passenger peaks, weekday vs. weekend shifts, route-level load factors, and overloaded corridor segments.
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

      {/* Filters Bar */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <div>
          <label htmlFor="f-start" className="block text-[11px] font-semibold text-slate-600 mb-1">
            Start Date
          </label>
          <input
            id="f-start"
            type="date"
            min={isActual && actualDataset?.dateRangeIST.start !== 'N/A' ? actualDataset!.dateRangeIST.start : '2026-10-01'}
            max={isActual && actualDataset?.dateRangeIST.end !== 'N/A' ? actualDataset!.dateRangeIST.end : '2026-10-31'}
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
            min={isActual && actualDataset?.dateRangeIST.start !== 'N/A' ? actualDataset!.dateRangeIST.start : '2026-10-01'}
            max={isActual && actualDataset?.dateRangeIST.end !== 'N/A' ? actualDataset!.dateRangeIST.end : '2026-10-31'}
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
      </section>

      {/* 6 Operator KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <KPIcard
          label="Total Tickets Analysed"
          value={summary.kpis.totalTicketsAnalyzed.toLocaleString()}
          subtitle={isActual ? actualDataset!.sourceName : 'Simulated Oct 2026'}
        />
        <KPIcard
          label="Number of Bus Routes"
          value={summary.kpis.routeCount}
          subtitle={isActual ? 'Unique ETM routes' : 'Bidirectional corridors'}
        />
        <KPIcard
          label="Estimated Passenger Journeys"
          value={summary.kpis.estimatedJourneys.toLocaleString()}
          subtitle="Using passenger_count"
          accent="teal"
        />
        <KPIcard
          label="Most Crowded Route"
          value={summary.kpis.mostCrowdedRoute}
          subtitle="Highest mean occupancy"
          accent="red"
        />
        <KPIcard
          label="Peak Travel Hour"
          value={summary.kpis.peakTravelHour}
          subtitle="IST departure window"
          accent="amber"
        />
        <KPIcard
          label="Average Estimated Occupancy"
          value={`${summary.kpis.avgEstimatedOccupancy}%`}
          subtitle="Of assumed capacity"
        />
      </section>

      {/* 7 Interactive Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Hourly Passenger Demand */}
        <AnalyticsChart
          title="1. Hourly Passenger Demand"
          subtitle="Average segment passenger load across operating hours (05:00–23:00 IST)"
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
                name="Avg Segment Load (pax)"
                stroke="#0F766E"
                fill="#CCFBF1"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </AnalyticsChart>

        {/* 2. Weekday vs Weekend Demand */}
        <AnalyticsChart
          title="2. Weekday vs. Weekend Demand"
          subtitle="Commuter morning/evening spikes vs. midday weekend shopping travel"
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
                name="Weekday Avg Load"
                stroke="#0F172A"
                strokeWidth={2.2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="weekendAvg"
                name="Weekend Avg Load"
                stroke="#0D9488"
                strokeWidth={2.2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </AnalyticsChart>

        {/* 3. Route-wise Passenger Demand */}
        <AnalyticsChart
          title="3. Route-Wise Passenger Demand"
          subtitle="Mean occupancy % across prototype Delhi bus routes"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summary.routeDemand} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="route" tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} unit="%" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="avgOccupancyPct" name="Avg Occupancy (%)" fill="#0F172A" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </AnalyticsChart>

        {/* 4. Crowding Distribution */}
        <AnalyticsChart
          title="4. Crowding Category Distribution"
          subtitle="Number of route-segment-hour observations falling into each threshold tier"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summary.crowdingDistribution} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="count" name="Segment Observations" radius={[4, 4, 0, 0]}>
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

        {/* 5. Peak-Hour Trends */}
        <AnalyticsChart
          title="5. Peak-Hour Load Trends (07:00–21:00)"
          subtitle="Comparing morning and evening peak intensity across active window"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={peakHourTrends} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="avgLoad" name="Peak Window Load" fill="#EA580C" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </AnalyticsChart>

        {/* 6. Segment-wise Passenger Load */}
        <AnalyticsChart
          title={`6. Segment-Wise Passenger Load (${summary.segmentChartRouteLabel})`}
          subtitle="Shows where the corridor builds up and relieves passenger load"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summary.segmentWiseLoad} margin={{ top: 10, right: 12, left: -12, bottom: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis
                dataKey="segment"
                tick={{ fontSize: 10, fill: '#475569' }}
                interval={0}
                angle={-18}
                textAnchor="end"
                height={48}
              />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="avgLoad" name="Avg Segment Load (pax)" fill="#0D9488" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </AnalyticsChart>
      </div>

      {/* 7. Daily Ticketing Trends (Full Width) */}
      <AnalyticsChart
        title="7. Daily Ticketing & Passenger Trends (October 1–31, 2026)"
        subtitle="Simulated October daily ticket volume and estimated passenger journeys"
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
              name="Est. Passenger Journeys"
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

      {/* Busiest Route Segments Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Busiest Route Segments
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Top overloaded stop-to-stop corridor segments ranked by predicted median passenger load.
            </p>
          </div>
          <span
            className={`text-[10px] font-mono-tabular font-semibold px-2 py-0.5 rounded border ${
              isActual
                ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}
          >
            {badgeLabel}
          </span>
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
                <th className="py-3 px-4">Crowding Category</th>
                <th className="py-3 px-4">Data Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.busiestSegments.map((row, idx) => (
                <tr key={`${row.routeNumber}-${row.fromStop}-${idx}`} className="hover:bg-slate-50/70">
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
                  <td className="py-3 px-4">
                    <CrowdBadge level={row.crowdingLevel} compact />
                  </td>
                  <td className="py-3 px-4">
                    <ConfidenceTag confidence={row.confidence} />
                  </td>
                </tr>
              ))}
              {summary.busiestSegments.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No segments match the current filter combination.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
