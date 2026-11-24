import { ArrowDown, ArrowUp, ChevronDown, Repeat } from 'lucide-react';
import { useState } from 'react';
import { JourneyOption } from '../types/transit';
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
      {journey.legs.map((leg, legIdx) => (
        <div key={`${leg.route_id}-${legIdx}`} className="space-y-4">
          {/* Leg Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
            <div>
              <div className="text-xs font-medium text-slate-500">
                Leg {leg.leg_index} of {journey.legs.length}
                <span className="mx-1.5" aria-hidden="true">·</span>
                {leg.is_ac ? 'AC Low-Floor Bus' : 'Standard Non-AC Bus'}
                <span className="mx-1.5" aria-hidden="true">·</span>
                Assumed capacity: <span className="font-mono-tabular">{leg.assumed_capacity} pax</span>
              </div>
              <h3 className="font-display text-base font-bold text-slate-900">
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

          {/* Segment-by-Segment Vertical Timeline */}
          <div className="relative pl-5 space-y-4">
            <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-slate-200" aria-hidden="true" />

            {leg.segments.map((seg, idx) => {
              const style = getCrowdingStyle(seg.crowding_level);
              const prevSeg = idx > 0 ? leg.segments[idx - 1] : null;
              const loadDelta = prevSeg ? seg.estimated_load - prevSeg.estimated_load : seg.estimated_load;
              const segKey = `${legIdx}-${seg.from_stop.stop_id}-${seg.to_stop.stop_id}`;
              const isExpanded = expandedKey === segKey;

              return (
                <div key={segKey} className="relative">
                  {/* Stop Node Marker */}
                  <div
                    className="absolute -left-[17px] top-1.5 w-3 h-3 rounded-full border-2 border-white shadow-sm"
                    style={{ backgroundColor: style.hex }}
                    aria-hidden="true"
                  />

                  <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-mono-tabular text-slate-500">
                          Segment {idx + 1} · {formatDisplayTime(seg.departure_time)} → {formatDisplayTime(seg.arrival_time)} ({seg.duration_mins} min)
                        </div>
                        <div className="font-display text-sm font-bold text-slate-900 mt-0.5">
                          {seg.from_stop.stop_name} → {seg.to_stop.stop_name}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <CrowdBadge
                          level={seg.crowding_level}
                          occupancyPct={seg.occupancy_pct}
                          passengerLoad={seg.estimated_load}
                          capacity={seg.assumed_capacity}
                        />
                        <ConfidenceTag confidence={seg.confidence} reason={seg.confidence_reason} />
                      </div>
                    </div>

                    {/* Visual Load Meter + Boarding/Alighting Insight */}
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
                            ~{seg.boardings_expected} boarding at {seg.from_stop.short_name}
                          </span>
                          <span className="inline-flex items-center gap-1 text-slate-700 font-medium">
                            <ArrowDown className="w-3.5 h-3.5 text-emerald-700" />
                            ~{seg.alightings_expected} alighting
                          </span>
                        </div>

                        <span className="font-mono-tabular text-slate-500">
                          {idx === 0
                            ? `Initial segment load: ${seg.estimated_load} pax`
                            : loadDelta > 0
                            ? `+${loadDelta} net passengers vs previous stop`
                            : loadDelta < 0
                            ? `${loadDelta} net passengers (bus empties slightly)`
                            : 'Steady passenger load'}
                        </span>
                      </div>
                    </div>

                    {seg.prediction_explanation && (
                      <div className="pt-1 border-t border-slate-100 space-y-2">
                        <button
                          type="button"
                          onClick={() => setExpandedKey(isExpanded ? null : segKey)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800 hover:text-teal-900 cursor-pointer"
                        >
                          <span>{isExpanded ? 'Hide prediction explanation' : 'Why this estimate?'}</span>
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

            {/* Final Alighting Stop Node */}
            <div className="relative pt-1">
              <div
                className="absolute -left-[17px] top-2 w-3 h-3 rounded-full bg-slate-900 border-2 border-white"
                aria-hidden="true"
              />
              <div className="text-xs font-medium text-slate-700 flex flex-wrap items-center gap-2">
                <span className="font-mono-tabular font-semibold text-slate-900">
                  {formatDisplayTime(leg.arrival_time)}
                </span>
                <span>Alight at {leg.alighting_stop.stop_name}</span>
              </div>
            </div>
          </div>

          {/* Transfer Banner between legs */}
          {legIdx < journey.legs.length - 1 && journey.transfer_stop && (
            <div className="bg-slate-100 border border-slate-200 rounded-lg px-4 py-3 flex items-center gap-3 text-xs text-slate-700">
              <Repeat className="w-4 h-4 text-teal-700 shrink-0" />
              <span>
                <strong>Transfer at {journey.transfer_stop.stop_name}:</strong> allow ~{journey.transfer_wait_mins} min to change to Route {journey.legs[legIdx + 1].route_number}.
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
