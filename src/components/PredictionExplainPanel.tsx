import { PredictionExplanation } from '../types/transit';

interface PredictionExplainPanelProps {
  explanation: PredictionExplanation;
}

export function PredictionExplainPanel({ explanation }: PredictionExplainPanelProps) {
  const { confidenceBreakdown: cb } = explanation;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-900">
          Prediction Transparency & Assumptions
        </span>
        <span className="font-mono-tabular text-[11px] text-teal-800 font-semibold">
          Model: {explanation.modelUsed === 'random-forest'
            ? 'Random Forest (12 Trees)'
            : explanation.modelUsed === 'baseline-median'
            ? 'Historical Median Baseline'
            : 'Conservative Fallback'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
        <div>
          <span className="text-slate-500 block">Observations Used</span>
          <span className="font-medium text-slate-800">{explanation.observationsUsed}</span>
        </div>
        <div>
          <span className="text-slate-500 block">Time Period Considered</span>
          <span className="font-medium text-slate-800">{explanation.timePeriodConsidered}</span>
        </div>
      </div>

      <div className="text-[11px] text-slate-700 leading-relaxed">
        <strong className="text-slate-900">How load was calculated:</strong> {explanation.calculationMethod}
        {explanation.baselineLoad !== null && explanation.randomForestLoad !== null && (
          <span className="font-mono-tabular text-slate-600">
            {' '}
            (Baseline median: {explanation.baselineLoad} pax · Random Forest: {explanation.randomForestLoad} pax)
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
        <div className="bg-white border border-slate-200 rounded px-2 py-1.5">
          <div className="text-[10px] text-slate-500">Observations</div>
          <div className="font-mono-tabular font-semibold text-slate-900">{cb.observationsCount}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded px-2 py-1.5">
          <div className="text-[10px] text-slate-500">Weekly Consistency</div>
          <div className="font-mono-tabular font-semibold text-slate-900">{cb.weeklyConsistencyPct}%</div>
        </div>
        <div className="bg-white border border-slate-200 rounded px-2 py-1.5">
          <div className="text-[10px] text-slate-500">GTFS Stop Match</div>
          <div className="font-mono-tabular font-semibold text-slate-900">{cb.stopMatchQualityPct}%</div>
        </div>
        <div className="bg-white border border-slate-200 rounded px-2 py-1.5">
          <div className="text-[10px] text-slate-500">Trip Grouping</div>
          <div className="font-mono-tabular font-semibold text-slate-900">{cb.tripGroupingReliabilityPct}%</div>
        </div>
        <div className="bg-white border border-slate-200 rounded px-2 py-1.5">
          <div className="text-[10px] text-slate-500">Missing Rate</div>
          <div className="font-mono-tabular font-semibold text-slate-900">{cb.missingDataRatePct}%</div>
        </div>
      </div>

      <div className="text-[11px] text-slate-600">
        <strong className="text-slate-800">Confidence basis:</strong> {explanation.confidenceReason}
      </div>

      <ul className="text-[11px] text-slate-500 list-disc pl-4 space-y-0.5">
        {explanation.assumptions.map((a, idx) => (
          <li key={idx}>{a}</li>
        ))}
      </ul>
    </div>
  );
}
