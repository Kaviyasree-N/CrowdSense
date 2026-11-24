import {
  AlertCircle,
  ArrowRight,
  Bus,
  CheckSquare,
  Clock,
  Footprints,
  Repeat,
  Square,
} from 'lucide-react';
import type { JourneyOption, RecommendationCategory } from '../types/transit';
import { formatDisplayTime } from '../services/crowdingService';
import { getCrowdingStyle } from '../utils/crowdClassification';
import { ConfidenceTag, CrowdBadge } from './CrowdBadge';

interface JourneyCardProps {
  journey: JourneyOption;
  onSelect: (journey: JourneyOption) => void;
  isCompared?: boolean;
  compareDisabled?: boolean;
  onToggleCompare?: (journeyId: string) => void;
}

const CATEGORY_LABELS: Record<RecommendationCategory, { title: string; style: string }> = {
  fastest: {
    title: 'Fastest Route',
    style: 'bg-slate-900 text-white',
  },
  'least-crowded': {
    title: 'Least Crowded Route',
    style: 'bg-emerald-700 text-white',
  },
  balanced: {
    title: 'Balanced Route',
    style: 'bg-teal-700 text-white',
  },
};

export function JourneyCard({
  journey,
  onSelect,
  isCompared = false,
  compareDisabled = false,
  onToggleCompare,
}: JourneyCardProps) {
  const primaryTag = journey.recommendation_tags[0];
  const allSegmentsMissing =
    journey.all_segments.length > 0 &&
    journey.all_segments.every((s) => s.has_historical_data === false);

  const transferSummary = (() => {
    if (journey.transfers === 0) return 'Direct (0 transfers)';
    const details = journey.transfers_detail ?? [];
    if (details.length > 0) {
      const stopsText = details
        .map((t) =>
          t.is_walking_transfer
            ? `${t.from_stop.short_name} (walk ${t.walk_meters}m to ${t.to_stop.short_name})`
            : t.from_stop.short_name
        )
        .join(' & ');
      return `${journey.transfers} transfer${journey.transfers > 1 ? 's' : ''} via ${stopsText} (${journey.transfer_wait_mins} min wait)`;
    }
    return `${journey.transfers} transfer${journey.transfers > 1 ? 's' : ''} at ${journey.transfer_stop?.short_name ?? 'hub'} (${journey.transfer_wait_mins} min wait)`;
  })();

  return (
    <article
      className={`bg-white border rounded-xl p-5 sm:p-6 transition-colors ${
        isCompared ? 'border-teal-600 ring-1 ring-teal-600/20' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* Top recommendation header & summary */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {journey.recommendation_tags.map((tag) => (
              <span
                key={tag}
                className={`text-xs font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${CATEGORY_LABELS[tag].style}`}
              >
                {CATEGORY_LABELS[tag].title}
              </span>
            ))}
            {!primaryTag && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 whitespace-nowrap">
                Alternative Option
              </span>
            )}
            <span className="text-xs text-slate-500 font-medium">
              {journey.legs.map((l) => `Route ${l.route_number}`).join(' + ')}
              <span className="mx-1.5" aria-hidden="true">·</span>
              {journey.legs[0].direction_label}
              <span className="mx-1.5" aria-hidden="true">·</span>
              {journey.legs[0].is_ac ? 'AC Low-Floor' : 'Standard Non-AC'}
              {journey.uses_gtfs_schedule && (
                <>
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  <span className="text-teal-800 font-semibold">GTFS Scheduled</span>
                </>
              )}
            </span>
          </div>

          <h3 className="font-display text-lg font-bold text-slate-900 flex flex-wrap items-center gap-2">
            <span className="font-mono-tabular">{formatDisplayTime(journey.departure_time)}</span>
            <ArrowRight className="w-4 h-4 text-slate-400" aria-hidden="true" />
            <span className="font-mono-tabular">{formatDisplayTime(journey.arrival_time)}</span>
            <span className="text-sm font-medium text-slate-500 font-mono-tabular">
              ({journey.total_duration_mins} min)
            </span>
          </h3>

          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Board: <strong className="font-semibold text-slate-800">{journey.source.stop_name}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Alight: <strong className="font-semibold text-slate-800">{journey.destination.stop_name}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              {journey.transfers_detail?.some((t) => t.is_walking_transfer) ? (
                <Footprints className="w-3.5 h-3.5 text-teal-700" />
              ) : (
                <Repeat className="w-3.5 h-3.5 text-slate-400" />
              )}
              {transferSummary}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 shrink-0">
          <div className="text-left sm:text-right space-y-1">
            <div className="text-[11px] font-medium text-slate-500">
              Peak segment occupancy
            </div>
            <div className="flex sm:justify-end items-center gap-2">
              {allSegmentsMissing ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-300 bg-slate-100 text-slate-700 text-xs font-medium whitespace-nowrap">
                  Insufficient historical data
                </span>
              ) : (
                <CrowdBadge
                  level={journey.peak_crowding_level}
                  occupancyPct={journey.peak_segment_occupancy_pct}
                />
              )}
            </div>
            <div className="flex sm:justify-end">
              <ConfidenceTag confidence={journey.overall_confidence} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onToggleCompare && (
              <button
                type="button"
                disabled={!isCompared && compareDisabled}
                onClick={() => onToggleCompare(journey.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                  isCompared
                    ? 'bg-teal-50 border-teal-600 text-teal-900'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
                title={
                  !isCompared && compareDisabled
                    ? 'Maximum 3 journeys can be compared side-by-side'
                    : 'Select to compare side-by-side'
                }
              >
                {isCompared ? (
                  <CheckSquare className="w-3.5 h-3.5 text-teal-700" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-slate-400" />
                )}
                {isCompared ? 'Comparing' : 'Compare'}
              </button>
            )}

            <button
              type="button"
              onClick={() => onSelect(journey)}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              Inspect Segments
            </button>
          </div>
        </div>
      </div>

      {/* Recommendation Explanation & Low-Confidence Notice */}
      <div className="py-3 border-b border-slate-100 space-y-2">
        <p className="text-xs text-slate-700 leading-relaxed">
          {journey.recommendation_reason}
        </p>
        {journey.low_confidence_warning && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{journey.low_confidence_warning}</span>
          </div>
        )}
      </div>

      {/* Segment-Level Crowding Strip */}
      <div className="pt-3.5 space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="font-semibold text-slate-700 flex items-center gap-1.5">
            <Bus className="w-3.5 h-3.5 text-teal-700" />
            Segment-by-segment predicted crowding ({journey.all_segments.length} segments)
          </span>
          <span className="font-mono-tabular flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {allSegmentsMissing
              ? 'Weighted avg: Unavailable'
              : `Weighted avg: ${journey.weighted_avg_occupancy_pct}%`}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {journey.all_segments.map((seg, idx) => {
            const missing = seg.has_historical_data === false;
            const style = getCrowdingStyle(seg.crowding_level);
            return (
              <div
                key={`${seg.route_id}-${seg.from_stop.stop_id}-${idx}`}
                className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 flex flex-col justify-between gap-1.5"
              >
                <div className="flex items-center justify-between gap-1 text-xs">
                  <span
                    className="font-medium text-slate-800 truncate"
                    title={`${seg.from_stop.short_name} to ${seg.to_stop.short_name}`}
                  >
                    {seg.from_stop.short_name} → {seg.to_stop.short_name}
                  </span>
                  <span className="font-mono-tabular text-[11px] text-slate-500 shrink-0">
                    R{seg.route_number}
                  </span>
                </div>

                {missing ? (
                  <>
                    <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden" />
                    <div className="text-[11px] font-medium text-slate-600">
                      Insufficient historical data
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${style.barClass}`}
                        style={{
                          width: `${Math.min(100, Math.round((seg.occupancy_pct / 140) * 100))}%`,
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px]">
                      <span className={`font-semibold ${style.textClass}`}>
                        {seg.crowding_level}
                      </span>
                      <span className="font-mono-tabular text-slate-700">
                        {seg.occupancy_pct}% ({seg.estimated_load}/{seg.assumed_capacity})
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}
