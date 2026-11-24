import { ArrowRight, CheckCircle2, X } from 'lucide-react';
import { formatDisplayTime } from '../services/crowdingService';
import type { JourneyOption } from '../types/transit';
import { ConfidenceTag, CrowdBadge } from './CrowdBadge';

interface JourneyComparisonTableProps {
  journeys: JourneyOption[];
  onRemove: (journeyId: string) => void;
  onClearAll: () => void;
  onSelectJourney: (journey: JourneyOption) => void;
}

export function JourneyComparisonTable({
  journeys,
  onRemove,
  onClearAll,
  onSelectJourney,
}: JourneyComparisonTableProps) {
  if (journeys.length === 0) return null;

  const minDuration = Math.min(...journeys.map((j) => j.total_duration_mins));
  const minTransfers = Math.min(...journeys.map((j) => j.transfers));
  const observedJourneys = journeys.filter(
    (j) => !j.all_segments.every((s) => s.has_historical_data === false)
  );
  const minComfort =
    observedJourneys.length > 0
      ? Math.min(...observedJourneys.map((j) => j.comfort_score))
      : Infinity;
  const minBalanced = Math.min(...journeys.map((j) => j.balanced_score));

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-bold">
            Side-by-Side Journey Comparison ({journeys.length}/3 selected)
          </h2>
          <p className="text-[11px] text-slate-300">
            Compare travel duration, transfers, segment peak crowding, and prediction confidence.
          </p>
        </div>
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs font-medium text-slate-300 hover:text-white underline cursor-pointer"
        >
          Clear Comparison
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <th className="py-3 px-4 font-semibold w-44">Metric</th>
              {journeys.map((j) => (
                <th key={j.id} className="py-3 px-4 font-semibold min-w-[210px]">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-display text-sm font-bold text-slate-900">
                        {j.legs.map((l) => `R${l.route_number}`).join(' + ')}
                      </div>
                      <div className="font-mono-tabular text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                        <span>{formatDisplayTime(j.departure_time)}</span>
                        <ArrowRight className="w-3 h-3" />
                        <span>{formatDisplayTime(j.arrival_time)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemove(j.id)}
                      aria-label="Remove from comparison"
                      className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="py-3 px-4 font-semibold text-slate-700">Preference Match</td>
              {journeys.map((j) => {
                const isBestBalanced = j.balanced_score === minBalanced;
                const isBestFastest = j.total_duration_mins === minDuration;
                const isBestComfort = j.comfort_score === minComfort;
                return (
                  <td key={j.id} className="py-3 px-4">
                    <div className="flex flex-wrap gap-1">
                      {isBestBalanced && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-semibold text-[11px]">
                          <CheckCircle2 className="w-3 h-3" />
                          Best Balanced
                        </span>
                      )}
                      {isBestFastest && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-900 border border-slate-300 font-semibold text-[11px]">
                          Fastest
                        </span>
                      )}
                      {isBestComfort && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[11px]">
                          Least Crowded
                        </span>
                      )}
                      {!isBestBalanced && !isBestFastest && !isBestComfort && (
                        <span className="text-slate-500">Alternative</span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>

            <tr>
              <td className="py-3 px-4 font-semibold text-slate-700">Total Travel Duration</td>
              {journeys.map((j) => (
                <td key={j.id} className="py-3 px-4 font-mono-tabular font-semibold text-slate-900">
                  {j.total_duration_mins} min
                  {j.total_duration_mins === minDuration && journeys.length > 1 && (
                    <span className="ml-1.5 text-[11px] font-sans text-teal-700">(Shortest)</span>
                  )}
                </td>
              ))}
            </tr>

            <tr>
              <td className="py-3 px-4 font-semibold text-slate-700">Transfers & Wait</td>
              {journeys.map((j) => (
                <td key={j.id} className="py-3 px-4 text-slate-700">
                  <span className="font-mono-tabular font-semibold text-slate-900">
                    {j.transfers}
                  </span>{' '}
                  {j.transfers === 0
                    ? '· Direct'
                    : `(${j.transfer_wait_mins} min wait)`}
                  {j.transfers === minTransfers && journeys.length > 1 && (
                    <span className="ml-1.5 text-[11px] text-teal-700 font-medium">(Fewest)</span>
                  )}
                </td>
              ))}
            </tr>

            <tr>
              <td className="py-3 px-4 font-semibold text-slate-700">Expected Peak Crowding</td>
              {journeys.map((j) => {
                const allMissing = j.all_segments.every((s) => s.has_historical_data === false);
                return (
                  <td key={j.id} className="py-3 px-4">
                    {allMissing ? (
                      <span className="text-slate-600 font-medium">
                        Insufficient historical data
                      </span>
                    ) : (
                      <CrowdBadge level={j.peak_crowding_level} compact />
                    )}
                  </td>
                );
              })}
            </tr>

            <tr>
              <td className="py-3 px-4 font-semibold text-slate-700">Max Segment Occupancy</td>
              {journeys.map((j) => {
                const allMissing = j.all_segments.every((s) => s.has_historical_data === false);
                return (
                  <td key={j.id} className="py-3 px-4 font-mono-tabular font-semibold text-slate-900">
                    {allMissing ? 'Insufficient historical data' : `${j.peak_segment_occupancy_pct}%`}
                  </td>
                );
              })}
            </tr>

            <tr>
              <td className="py-3 px-4 font-semibold text-slate-700">Average Occupancy</td>
              {journeys.map((j) => {
                const allMissing = j.all_segments.every((s) => s.has_historical_data === false);
                return (
                  <td key={j.id} className="py-3 px-4 font-mono-tabular text-slate-800">
                    {allMissing ? 'Insufficient historical data' : `${j.weighted_avg_occupancy_pct}%`}
                  </td>
                );
              })}
            </tr>

            <tr>
              <td className="py-3 px-4 font-semibold text-slate-700">Prediction Confidence</td>
              {journeys.map((j) => (
                <td key={j.id} className="py-3 px-4">
                  <ConfidenceTag confidence={j.overall_confidence} />
                </td>
              ))}
            </tr>

            <tr>
              <td className="py-3 px-4 font-semibold text-slate-700">Action</td>
              {journeys.map((j) => (
                <td key={j.id} className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => onSelectJourney(j)}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md transition-colors cursor-pointer"
                  >
                    Inspect Timeline
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
