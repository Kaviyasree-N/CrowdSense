import { ArrowLeft, Clock, Info, Repeat } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { ConfidenceTag, CrowdBadge } from '../components/CrowdBadge';
import { RouteMap } from '../components/RouteMap';
import { SegmentTimeline } from '../components/SegmentTimeline';
import { formatDisplayTime } from '../services/crowdingService';
import { JourneyOption } from '../types/transit';
import { getCrowdingStyle } from '../utils/crowdClassification';

interface JourneyDetailsProps {
  journey: JourneyOption;
  onBack: () => void;
}

export function JourneyDetails({ journey, onBack }: JourneyDetailsProps) {
  const chartData = journey.all_segments.map((seg) => ({
    name: `${seg.from_stop.short_name} → ${seg.to_stop.short_name}`,
    occupancyPct: seg.occupancy_pct,
    load: seg.estimated_load,
    capacity: seg.assumed_capacity,
    level: seg.crowding_level,
    hex: getCrowdingStyle(seg.crowding_level).hex,
  }));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Back Nav */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Journey Results
        </button>

        <span className="text-xs font-mono-tabular font-semibold px-2.5 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200">
          DEMO DATA – NOT ACTUAL TRANSPORT DATA
        </span>
      </div>

      {/* Journey Summary Header Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-500">
              {journey.legs.map((l) => `Route ${l.route_number}`).join(' + ')}
              <span className="mx-1.5" aria-hidden="true">·</span>
              {journey.legs[0].direction_label}
              <span className="mx-1.5" aria-hidden="true">·</span>
              {journey.transfers === 0 ? 'Direct journey' : `1 transfer at ${journey.transfer_stop?.stop_name}`}
            </div>

            <h1 className="font-display text-2xl font-bold text-slate-900">
              {journey.source.stop_name} → {journey.destination.stop_name}
            </h1>

            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700 pt-1">
              <span className="inline-flex items-center gap-1.5 font-mono-tabular font-semibold text-slate-900">
                <Clock className="w-4 h-4 text-teal-700" />
                {formatDisplayTime(journey.departure_time)} – {formatDisplayTime(journey.arrival_time)} ({journey.total_duration_mins} min)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Repeat className="w-4 h-4 text-slate-400" />
                {journey.transfers === 0
                  ? '0 transfers'
                  : `${journey.transfers} transfer (${journey.transfer_wait_mins} min buffer)`}
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:items-end gap-2">
            <div className="text-xs text-slate-500">Peak Segment Expected Crowding</div>
            <CrowdBadge
              level={journey.peak_crowding_level}
              occupancyPct={journey.peak_segment_occupancy_pct}
            />
            <ConfidenceTag confidence={journey.overall_confidence} />
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 flex items-start gap-2 text-xs text-slate-600">
          <Info className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
          <span>{journey.recommendation_reason}</span>
        </div>
      </section>

      {/* Main 2-Column Detailed Workspace: Timeline + Map & Load Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Passenger-Load Timeline
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Shows where passengers are expected to board, where crowding peaks, and where seats open up.
              </p>
            </div>
            <SegmentTimeline journey={journey} />
          </section>
        </div>

        <div className="lg:col-span-5 space-y-6">
          <section className="space-y-2">
            <h2 className="font-display text-base font-bold text-slate-900">
              Route Corridor & Stop Map
            </h2>
            <RouteMap mode="journey" journey={journey} heightClass="h-[360px]" />
          </section>

          <AnalyticsChart
            title="Segment Occupancy Profile (% of Assumed Capacity)"
            subtitle="Dashed lines show 100% seated+standing capacity and 120% Very Crowded threshold"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 12, left: -12, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: '#475569' }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={52}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#475569' }}
                  domain={[0, 150]}
                  unit="%"
                />
                <Tooltip
                  formatter={(value) => [`${value}%`, 'Predicted Occupancy']}
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#CBD5E1' }}
                />
                <ReferenceLine y={100} stroke="#EA580C" strokeDasharray="4 4" />
                <ReferenceLine y={120} stroke="#DC2626" strokeDasharray="4 4" />
                <Bar dataKey="occupancyPct" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, idx) => (
                    <Cell key={`cell-${idx}`} fill={entry.hex} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </AnalyticsChart>
        </div>
      </div>
    </div>
  );
}
