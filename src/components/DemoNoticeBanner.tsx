import { RotateCcw, Info, ArrowLeftRight } from 'lucide-react';
import type { DataMode } from '../types/transit';

interface DemoNoticeBannerProps {
  dataMode: DataMode;
  hasActualDataset: boolean;
  actualDatasetName?: string;
  hasUploadedCsv: boolean;
  uploadedFileName?: string;
  onSwitchMode: (mode: DataMode) => void;
  onResetDemo: () => void;
}

export function DemoNoticeBanner({
  dataMode,
  hasActualDataset,
  actualDatasetName,
  hasUploadedCsv,
  uploadedFileName,
  onSwitchMode,
  onResetDemo,
}: DemoNoticeBannerProps) {
  const isActual = dataMode === 'actual' && hasActualDataset;

  return (
    <div className={isActual ? 'bg-emerald-50/70 border-b border-emerald-200' : 'bg-slate-100 border-b border-slate-200'}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-700">
        <div className="flex flex-wrap items-center gap-2.5">
          {isActual ? (
            <span className="inline-flex items-center gap-1.5 font-mono-tabular font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 whitespace-nowrap">
              ACTUAL DATA MODE
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-mono-tabular font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 whitespace-nowrap">
              DEMO DATA – NOT ACTUAL TRANSPORT DATA
            </span>
          )}
          <span className="text-slate-600 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>
              {isActual
                ? `Using processed ETM & GTFS records from ${actualDatasetName ?? 'uploaded dataset'} (Asia/Kolkata). Ticket destinations reflect planned alighting and omit unrecorded pass holders.`
                : `Expected crowding is estimated from simulated October 2026 historical ETM ticket patterns, not live GPS or real-time occupancy.${
                    hasUploadedCsv && uploadedFileName
                      ? ` Actual dataset staged (${uploadedFileName}) — switch mode or inspect in Data Explorer.`
                      : ''
                  }`}
            </span>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasActualDataset && (
            <button
              type="button"
              onClick={() => onSwitchMode(isActual ? 'demo' : 'actual')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-teal-700" />
              {isActual ? 'Switch to Demo Mode' : 'Switch to Actual Data'}
            </button>
          )}

          <button
            type="button"
            onClick={onResetDemo}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-200/70 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Demo Data
          </button>
        </div>
      </div>
    </div>
  );
}
