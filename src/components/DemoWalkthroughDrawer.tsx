import { CheckCircle2, ChevronLeft, ChevronRight, PlayCircle, RotateCcw, X } from 'lucide-react';
import type { AppPage } from './Navbar';

export interface DemoWalkthroughStep {
  step: number;
  title: string;
  description: string;
  targetPage: AppPage;
}

export const HACKATHON_DEMO_STEPS: DemoWalkthroughStep[] = [
  {
    step: 1,
    title: 'Home Overview',
    description: 'Start on CrowdSense Home showing Delhi corridor journey search & methodology.',
    targetPage: 'home',
  },
  {
    step: 2,
    title: 'Anand Vihar → Connaught Place',
    description: 'Pre-fill source (Anand Vihar ISBT) and destination (Connaught Place).',
    targetPage: 'home',
  },
  {
    step: 3,
    title: 'Weekday Evening 6:00 PM',
    description: 'Set departure date (Wed, Oct 14) and peak hour 18:00 IST.',
    targetPage: 'home',
  },
  {
    step: 4,
    title: 'Alternative Bus Journeys',
    description: 'Compare direct and transfer options with predicted segment crowding.',
    targetPage: 'results',
  },
  {
    step: 5,
    title: 'Fastest vs. Least Crowded vs. Balanced',
    description: 'Switch Balanced Weights or sort by Least Crowded to avoid 120%+ corridors.',
    targetPage: 'results',
  },
  {
    step: 6,
    title: 'Journey Segment Timeline',
    description: 'Inspect stop-by-stop load buildup, capacity ratio, and prediction confidence.',
    targetPage: 'details',
  },
  {
    step: 7,
    title: 'Interactive Delhi Crowding Map',
    description: 'Explore Green/Yellow/Orange/Red segments at 18:00 IST on Leaflet.',
    targetPage: 'map',
  },
  {
    step: 8,
    title: 'Operator Analytics & Weekly Stability',
    description: 'Inspect recurring hotspots, weekday vs weekend demand, and stability.',
    targetPage: 'analytics',
  },
  {
    step: 9,
    title: '10-Stage ETM & GTFS Pipeline',
    description: 'Review streaming CSV/ZIP ingestion, stop matching, and load reconstruction.',
    targetPage: 'explorer',
  },
  {
    step: 10,
    title: 'Model Evaluation & Reset Demo',
    description: 'Compare Baseline vs Random Forest holdout MAE/RMSE and reset cleanly.',
    targetPage: 'explorer',
  },
];

interface DemoWalkthroughDrawerProps {
  isOpen: boolean;
  currentStep: number;
  onSelectStep: (stepNumber: number) => void;
  onClose: () => void;
  onResetDemo: () => void;
}

export function DemoWalkthroughDrawer({
  isOpen,
  currentStep,
  onSelectStep,
  onClose,
  onResetDemo,
}: DemoWalkthroughDrawerProps) {
  if (!isOpen) return null;

  const active =
    HACKATHON_DEMO_STEPS.find((s) => s.step === currentStep) ?? HACKATHON_DEMO_STEPS[0];

  return (
    <div className="bg-slate-900 text-white border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono-tabular font-semibold px-2 py-0.5 rounded bg-teal-600 text-white">
              <PlayCircle className="w-3.5 h-3.5" />
              STEP {active.step} / 10
            </span>
            <div>
              <span className="text-xs font-bold text-white">{active.title}</span>
              <span className="hidden sm:inline text-xs text-slate-300 ml-2">
                — {active.description}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={active.step <= 1}
              onClick={() => onSelectStep(Math.max(1, active.step - 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-medium cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>
            <button
              type="button"
              disabled={active.step >= 10}
              onClick={() => onSelectStep(Math.min(10, active.step + 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-xs font-semibold cursor-pointer"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            {active.step === 10 && (
              <button
                type="button"
                onClick={onResetDemo}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Demo
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close demo guide"
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
          {HACKATHON_DEMO_STEPS.map((s) => {
            const isCurrent = s.step === active.step;
            const isDone = s.step < active.step;
            return (
              <button
                key={s.step}
                type="button"
                onClick={() => onSelectStep(s.step)}
                title={`${s.step}. ${s.title}`}
                className={`px-2 py-1 rounded text-[11px] font-mono-tabular font-semibold text-left truncate flex items-center gap-1 border transition-colors cursor-pointer ${
                  isCurrent
                    ? 'bg-teal-600 border-teal-400 text-white'
                    : isDone
                    ? 'bg-slate-800 border-slate-700 text-teal-300'
                    : 'bg-slate-800/60 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {isDone && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                <span className="truncate">
                  {s.step}. {s.title.split(' ')[0]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
