import { ArrowLeft, Clock, Info, Repeat } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import { PredictionExplainPanel } from '../components/PredictionExplainPanel';
import { getJourneySegmentKey, RouteMap } from '../components/RouteMap';
import { SegmentTimeline } from '../components/SegmentTimeline';
import { formatDisplayTime } from '../services/crowdingService';
import type { JourneyOption, JourneySegmentEstimate } from '../types/transit';
import { getCrowdingStyle } from '../utils/crowdClassification';

interface JourneyDetailsProps {
  journey: JourneyOption;
  onBack: () => void;
}

export function JourneyDetails({ journey, onBack }: JourneyDetailsProps) {
  const defaultPeakSeg = useMemo(() => {
    if (journey.all_segments.length === 0) return null;
    const peak = [...journey.all_segments].sort(
      (a, b) => b.occupancy_pct - a.occupancy_pct
    )[0];
    return peak ?? journey.all_segments[0];
  }, [journey]);

  const [selectedSegKey, setSelectedSegKey] = useState<string | null>(() =>
    defaultPeakSeg ? getJourneySegmentKey(defaultPeakSeg) : null
  );

  useEffect(() => {
    setSelectedSegKey(defaultPeakSeg ? getJourneySegmentKey(defaultPeakSeg) : null);
  }, [defaultPeakSeg]);

  const selectedSegment: JourneySegmentEstimate | null = useMemo(() => {
    if (journey.all_segments.length === 0) return null;
    return (
      journey.all_segments.find((s) => getJourneySegmentKey(s) === selectedSegKey) ??
      defaultPeakSeg
    );
  }, [journey.all_segments, selectedSegKey, defaultPeakSeg]);

  const allMissing =
    journey.all_segments.length > 0 &&
    journey.all_segments.every((s) => s.has_historical_data === false);

  const chartData = journey.all_segments.map((seg) => {
    const missing = seg.has_historical_data === false;
    return {
      name: `${seg.from_stop.short_name} → ${seg.to_stop.short_name}`,
      occupancyPct: missing ? 0 : seg.occupancy_pct,
      load: missing ? 0 : seg.estimated_load,
      capacity: seg.assumed_capacity,
      level: missing ? 'Insufficient historical data' : seg.crowding_level,
      hex: missing ? '#CBD5E1' : getCrowdingStyle(seg.crowding_level).hex,
      missing,
    };
  });

  const transferHeaderLabel = (() => {
    if (journey.transfers === 0) return 'Direct journey (0 transfers)';
    const stops = (journey.transfers_detail ?? []).map((t) => t.from_stop.short_name);
    if (stops.length > 0) {
      return `${journey.transfers} transfer${journey.transfers > 1 ? 's' : ''} (${stops.join(' → ')})`;
    }
    return `${journey.transfers} transfer${journey.transfers > 1 ? 's' : ''}`;
  })();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Back Nav & Mode Badge */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Journey Results
        </button>

        {journey.is_simulated ? (
          <span className="text-xs font-mono-tabular font-semibold px-2.5 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200">
            DEMO DATA – NOT ACTUAL TRANSPORT DATA
          </span>
        ) : (
          <span className="text-xs font-mono-tabular font-semibold px-2.5 py-1 rounded bg-emerald-50 text-emerald-900 border border-emerald-200">
            ACTUAL DATA MODE
          </span>
        )}
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
              {transferHeaderLabel}
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
                  : `${journey.transfers} transfer${journey.transfers > 1 ? 's' : ''} (${journey.transfer_wait_mins} min wait)`}
              </span>
              <span className="text-xs font-medium text-slate-500">
                {journey.uses_gtfs_schedule
                  ? 'Scheduled times: GTFS stop_times · Crowding: Estimated'
                  : 'Times: Prototype headway · Crowding: Estimated'}
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:items-end gap-2">
            <div className="text-xs text-slate-500">Peak Segment Expected Crowding</div>
            {allMissing ? (
              <span className="inline-flex items-center px-2.5 py-1 rounded-md border border-slate-300 bg-slate-100 text-slate-700 text-xs font-medium">
                Insufficient historical data
              </span>
            ) : (
              <CrowdBadge
                level={journey.peak_crowding_level}
                occupancyPct={journey.peak_segment_occupancy_pct}
              />
            )}
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
                Chronological Journey & Passenger-Load Timeline
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Shows boarding, intermediate stops, where crowding begins or peaks, and transfer waiting times.
              </p>
            </div>
            <SegmentTimeline journey={journey} />
          </section>
        </div>

        <div className="lg:col-span-5 space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold text-slate-900">
                Route Corridor & Stop Map
              </h2>
              <span className="text-[11px] text-slate-500">
                Click any segment to inspect crowding
              </span>
            </div>

            <RouteMap
              mode="journey"
              journey={journey}
              selectedJourneySegmentKey={selectedSegment ? getJourneySegmentKey(selectedSegment) : null}
              onSelectJourneySegment={(seg) => setSelectedSegKey(getJourneySegmentKey(seg))}
              heightClass="h-[360px]"
            />

            {/* Segment Quick-Select & Prediction Explanation Panel synced with Map clicks */}
            {selectedSegment && (
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {journey.all_segments.map((seg, idx) => {
                    const key = getJourneySegmentKey(seg);
                    const active = key === getJourneySegmentKey(selectedSegment);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedSegKey(key)}
                        className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-teal-600'
                        }`}
                      >
                        Seg {idx + 1}: {seg.from_stop.short_name} → {seg.to_stop.short_name}
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-start justify-between gap-2 pt-1 border-t border-slate-100">
                  <div>
                    <div className="text-[11px] font-medium text-slate-500">
                      Route {selectedSegment.route_number} · {selectedSegment.direction_label}
                    </div>
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      {selectedSegment.from_stop.stop_name} → {selectedSegment.to_stop.stop_name}
                    </h3>
                    <div className="text-[11px] font-mono-tabular text-slate-600 mt-0.5">
                      {formatDisplayTime(selectedSegment.departure_time)} – {formatDisplayTime(selectedSegment.arrival_time)} · {selectedSegment.duration_mins} min
                    </div>
                  </div>
                  {selectedSegment.has_historical_data === false ? (
                    <span className="px-2 py-1 rounded bg-slate-100 border border-slate-300 text-[11px] font-medium text-slate-700">
                      Insufficient Data
                    </span>
                  ) : (
                    <CrowdBadge
                      level={selectedSegment.crowding_level}
                      occupancyPct={selectedSegment.occupancy_pct}
                      passengerLoad={selectedSegment.estimated_load}
                      capacity={selectedSegment.assumed_capacity}
                      compact
                    />
                  )}
                </div>

                {selectedSegment.prediction_explanation && (
                  <PredictionExplainPanel explanation={selectedSegment.prediction_explanation} />
                )}
              </div>
            )}
          </section>

          <AnalyticsChart
            title="Segment Occupancy Profile (% of Assumed Capacity)"
            subtitle="Dashed lines show 100% capacity and 120% Very Crowded threshold (grey = insufficient history)"
            dataSourceLabel={journey.is_simulated ? 'DEMO DATA – NOT ACTUAL TRANSPORT DATA' : 'ACTUAL DATA MODE'}
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
                  formatter={(_value, _name, props) => {
                    const item = props?.payload;
                    if (item?.missing) return ['Insufficient historical data', 'Status'];
                    return [`${item?.occupancyPct ?? 0}% (${item?.load ?? 0}/${item?.capacity ?? 50} pax)`, 'Estimated Occupancy'];
                  }}
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
