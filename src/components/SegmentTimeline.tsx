import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Footprints,
  Repeat,
} from 'lucide-react';
import { useState } from 'react';
import type { JourneyOption } from '../types/transit';
import { formatDisplayTime } from '../services/crowdingService';
import { getCrowdingStyle } from '../utils/crowdClassification';
import { ConfidenceTag, CrowdBadge } from './CrowdBadge';
import { PredictionExplainPanel } from './PredictionExplainPanel';

interface SegmentTimelineProps {
  journey: JourneyOption;
}

export function SegmentTimeline({ journey }: SegmentTimelineProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {journey.legs.map((leg, legIdx) => {
        const transferDetail =
          journey.transfers_detail?.find((t) => t.after_leg_index === leg.leg_index) ??
          (legIdx === 0 && journey.transfer_stop
            ? {
                after_leg_index: 1,
                from_stop: journey.transfer_stop,
                to_stop: journey.transfer_stop,
                arrival_time: leg.arrival_time,
                next_departure_time: journey.legs[legIdx + 1]?.departure_time ?? leg.arrival_time,
                next_route_number: journey.legs[legIdx + 1]?.route_number ?? '',
                wait_mins: journey.transfer_wait_mins,
                is_walking_transfer: false,
              }
            : undefined);

        return (
          <div key={`${leg.route_id}-${legIdx}`} className="space-y-4">
            {/* Leg Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
              <div>
                <div className="text-xs font-medium text-slate-500 flex flex-wrap items-center gap-1.5">
                  <span>
                    Leg {leg.leg_index} of {journey.legs.length}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{leg.is_ac ? 'AC Low-Floor Bus' : 'Standard Non-AC Bus'}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Assumed capacity:{' '}
                    <span className="font-mono-tabular">{leg.assumed_capacity} pax</span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-700 font-semibold">
                    {leg.is_scheduled ? 'Scheduled GTFS Trip' : 'Estimated Headway Schedule'}
                  </span>
                </div>
                <h3 className="font-display text-base font-bold text-slate-900 mt-0.5">
                  Route {leg.route_number} — {leg.route_name}
                </h3>
                <p className="text-xs text-slate-600">{leg.direction_label}</p>
              </div>

              <div className="text-right font-mono-tabular text-xs text-slate-700">
                <div className="font-semibold text-slate-900">
                  {formatDisplayTime(leg.departure_time)} – {formatDisplayTime(leg.arrival_time)}
                </div>
                <div className="text-slate-500">{leg.duration_mins} min on board</div>
              </div>
            </div>

            {/* Board Step Marker */}
            <div className="text-xs font-medium text-teal-900 bg-teal-50 border border-teal-200 rounded-lg px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong className="font-mono-tabular">{formatDisplayTime(leg.departure_time)}</strong>
                {' – '}Board Route {leg.route_number} at{' '}
                <strong>{leg.boarding_stop.stop_name}</strong>
              </span>
              <span className="text-[11px] text-teal-800">
                {leg.is_scheduled ? 'Scheduled Departure' : 'Estimated Departure'}
              </span>
            </div>

            {/* Segment-by-Segment Vertical Timeline */}
            <div className="relative pl-5 space-y-4">
              <div
                className="absolute left-2 top-2 bottom-2 w-0.5 bg-slate-200"
                aria-hidden="true"
              />

              {leg.segments.map((seg, idx) => {
                const missing = seg.has_historical_data === false;
                const style = getCrowdingStyle(seg.crowding_level);
                const prevSeg = idx > 0 ? leg.segments[idx - 1] : null;
                const prevObserved = prevSeg && prevSeg.has_historical_data !== false;
                const crowdedBeginsHere =
                  !missing &&
                  seg.occupancy_pct >= 100 &&
                  (!prevObserved || prevSeg.occupancy_pct < 100);

                const loadDelta =
                  !missing && prevObserved
                    ? seg.estimated_load - prevSeg.estimated_load
                    : seg.estimated_load;
                const segKey = `${legIdx}-${seg.from_stop.stop_id}-${seg.to_stop.stop_id}`;
                const isExpanded = expandedKey === segKey;

                return (
                  <div key={segKey} className="relative space-y-2">
                    {crowdedBeginsHere && (
                      <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded px-2.5 py-1">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Crowded segment begins at {seg.from_stop.stop_name} ({seg.occupancy_pct}%)
                        </span>
                      </div>
                    )}

                    {/* Stop Node Marker */}
                    <div
                      className="absolute -left-[17px] top-1.5 w-3 h-3 rounded-full border-2 border-white shadow-sm"
                      style={{ backgroundColor: missing ? '#94A3B8' : style.hex }}
                      aria-hidden="true"
                    />

                    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-mono-tabular text-slate-500 flex flex-wrap items-center gap-1.5">
                            <span>
                              Segment {idx + 1} · {formatDisplayTime(seg.departure_time)} →{' '}
                              {formatDisplayTime(seg.arrival_time)} ({seg.duration_mins} min)
                            </span>
                            <span className="text-[10px] font-sans font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                              {seg.is_scheduled_time ? 'Scheduled' : 'Est. Time'}
                            </span>
                          </div>
                          <div className="font-display text-sm font-bold text-slate-900 mt-0.5">
                            {seg.from_stop.stop_name} → {seg.to_stop.stop_name}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {missing ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-md border border-slate-300 bg-slate-100 text-slate-700 text-xs font-medium whitespace-nowrap">
                              Insufficient historical data
                            </span>
                          ) : (
                            <CrowdBadge
                              level={seg.crowding_level}
                              occupancyPct={seg.occupancy_pct}
                              passengerLoad={seg.estimated_load}
                              capacity={seg.assumed_capacity}
                            />
                          )}
                          <ConfidenceTag
                            confidence={seg.confidence}
                            reason={seg.confidence_reason}
                          />
                        </div>
                      </div>

                      {/* Visual Load Meter + Boarding/Alighting Insight */}
                      {missing ? (
                        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                          No historical ticket observations exist for this segment and time window. Crowding is not estimated.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${style.barClass}`}
                              style={{
                                width: `${Math.min(100, Math.round((seg.occupancy_pct / 145) * 100))}%`,
                              }}
                            />
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="inline-flex items-center gap-1 text-slate-700 font-medium">
                                <ArrowUp className="w-3.5 h-3.5 text-amber-600" />
                                ~{seg.boardings_expected} est. boarding at {seg.from_stop.short_name}
                              </span>
                              <span className="inline-flex items-center gap-1 text-slate-700 font-medium">
                                <ArrowDown className="w-3.5 h-3.5 text-emerald-700" />
                                ~{seg.alightings_expected} est. alighting
                              </span>
                            </div>

                            <span className="font-mono-tabular text-slate-500">
                              {idx === 0 || !prevObserved
                                ? `Estimated load: ${seg.estimated_load} pax`
                                : loadDelta > 0
                                ? `+${loadDelta} net passengers vs previous stop`
                                : loadDelta < 0
                                ? `${loadDelta} net passengers (bus empties slightly)`
                                : 'Steady passenger load'}
                            </span>
                          </div>
                        </div>
                      )}

                      {seg.prediction_explanation && (
                        <div className="pt-1 border-t border-slate-100 space-y-2">
                          <button
                            type="button"
                            onClick={() => setExpandedKey(isExpanded ? null : segKey)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800 hover:text-teal-900 cursor-pointer"
                          >
                            <span>
                              {isExpanded ? 'Hide prediction explanation' : 'Why this estimate?'}
                            </span>
                            <ChevronDown
                              className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          </button>

                          {isExpanded && (
                            <PredictionExplainPanel explanation={seg.prediction_explanation} />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Leg Alighting Stop Node */}
              <div className="relative pt-1">
                <div
                  className="absolute -left-[17px] top-2 w-3 h-3 rounded-full bg-slate-900 border-2 border-white"
                  aria-hidden="true"
                />
                <div className="text-xs font-medium text-slate-700 flex flex-wrap items-center gap-2">
                  <span className="font-mono-tabular font-semibold text-slate-900">
                    {formatDisplayTime(leg.arrival_time)}
                  </span>
                  <span>
                    {legIdx < journey.legs.length - 1 ? 'Alight for transfer at' : 'Final arrival at'}{' '}
                    <strong>{leg.alighting_stop.stop_name}</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Transfer Banner between legs */}
            {legIdx < journey.legs.length - 1 && transferDetail && (
              <div className="bg-slate-100 border border-slate-300 rounded-xl px-4 py-3.5 flex items-start gap-3 text-xs text-slate-700">
                {transferDetail.is_walking_transfer ? (
                  <Footprints className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                ) : (
                  <Repeat className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <div className="font-semibold text-slate-900">
                    Transfer {legIdx + 1} at {transferDetail.from_stop.stop_name}
                    {transferDetail.is_walking_transfer &&
                      ` → Walk ${transferDetail.walk_meters}m (~${transferDetail.walk_mins} min) to ${transferDetail.to_stop.stop_name}`}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600 font-mono-tabular">
                    <span>Arrive: {formatDisplayTime(transferDetail.arrival_time)}</span>
                    <span>·</span>
                    <span>Wait: {transferDetail.wait_mins} min</span>
                    <span>·</span>
                    <span>
                      Board Route {transferDetail.next_route_number} at{' '}
                      {formatDisplayTime(transferDetail.next_departure_time)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
