import { ArrowRight, BarChart3, Bus, Database, Map, ShieldCheck } from 'lucide-react';
import { JourneySearch } from '../components/JourneySearch';
import type { BusStop, DataMode, SearchQuery } from '../types/transit';
import { AppPage } from '../components/Navbar';

interface HomeProps {
  initialQuery: SearchQuery;
  onSearch: (query: SearchQuery) => void;
  onRunSampleDemo: () => void;
  onNavigate: (page: AppPage) => void;
  dataMode?: DataMode;
  activeStops?: BusStop[];
}

export function Home({
  initialQuery,
  onSearch,
  onRunSampleDemo,
  onNavigate,
  dataMode = 'demo',
  activeStops,
}: HomeProps) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-12">
      {/* Hero & Search Anchor */}
      <section className="space-y-6">
        <div className="max-w-3xl space-y-3">
          <div className="text-xs font-semibold text-teal-800 tracking-wide">
            {dataMode === 'actual'
              ? 'Delhi Public Bus Network · Actual Processed ETM & GTFS Data'
              : 'Delhi Public Bus Network · Historical ETM Demand Prototype'}
          </div>
          <h1 className="font-display text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight leading-[1.12] [text-wrap:balance]">
            Travel Smarter. Choose Your Comfort.
          </h1>
          <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-2xl">
            CrowdSense pairs bus travel times with segment-by-segment predicted passenger crowding from historical ETM and e-ticketing records, helping you avoid overcrowded corridors.
          </p>
        </div>

        <JourneySearch initialQuery={initialQuery} onSearch={onSearch} stops={activeStops} />

        {/* 1-click Hackathon Demonstration Bar */}
        <div className="bg-slate-900 text-white rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="text-xs font-medium text-teal-300">
              Featured Commuter Scenario
            </div>
            <div className="text-sm font-semibold">
              Anand Vihar ISBT → Connaught Place · Weekday Departure at 6:00 PM
            </div>
            <p className="text-xs text-slate-300">
              Compare the fastest corridor (134% Very Crowded at ITO) against balanced and comfortable AC alternatives.
            </p>
          </div>
          <button
            type="button"
            onClick={onRunSampleDemo}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            View 6 PM Comparison
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* Plain-Language Explanation of How Predictions Work */}
      <section className="space-y-5">
        <div className="border-b border-slate-200 pb-3">
          <h2 className="font-display text-xl font-bold text-slate-900">
            How CrowdSense Estimates Bus Crowding
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Expected crowding is estimated using historical ticket records — predictions are based on previous travel patterns and may differ from actual conditions.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
            <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-800 flex items-center justify-center">
              <Bus className="w-5 h-5" />
            </div>
            <h3 className="font-display text-base font-bold text-slate-900">
              01. Segment-Level Load Estimation
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Instead of giving one vague score for an entire route, CrowdSense tracks where passengers board and alight along every stop-to-stop segment of your trip.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
            <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-800 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="font-display text-base font-bold text-slate-900">
              02. Honest Confidence Indicators
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Confidence indicates how much historical data supports an estimate. Routes with sparse off-peak records or ambiguous stop matching are clearly flagged.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
            <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-800 flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
            <h3 className="font-display text-base font-bold text-slate-900">
              03. Fastest vs. Comfortable Trade-Off
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Choose between Fastest, Least Crowded, and Balanced routes. A route with an extreme mid-trip bottleneck is never mislabeled as comfortable.
            </p>
          </div>
        </div>
      </section>

      {/* Prototype Threshold Guide & Quick Module Navigation */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-base font-bold text-slate-900">
              Crowding Levels Explained (Prototype Thresholds)
            </h3>
            <span className="text-xs text-slate-500">
              Normalized against assumed bus capacity
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            <div className="py-2.5 flex items-center justify-between gap-4 text-sm">
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-sm bg-emerald-600 shrink-0" />
                <span className="font-semibold text-slate-900">Seats Available</span>
              </div>
              <span className="font-mono-tabular text-xs text-slate-600">Below 70% occupancy · Comfortable seating likely</span>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4 text-sm">
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-sm bg-amber-500 shrink-0" />
                <span className="font-semibold text-slate-900">Standing Room</span>
              </div>
              <span className="font-mono-tabular text-xs text-slate-600">70% to 99% occupancy · Seats full, moderate standing space</span>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4 text-sm">
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-sm bg-orange-500 shrink-0" />
                <span className="font-semibold text-slate-900">Crowded</span>
              </div>
              <span className="font-mono-tabular text-xs text-slate-600">100% to 119% occupancy · Dense aisle standing</span>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4 text-sm">
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-sm bg-red-600 shrink-0" />
                <span className="font-semibold text-slate-900">Very Crowded</span>
              </div>
              <span className="font-mono-tabular text-xs text-slate-600">120%+ occupancy · Severe peak congestion, boarding difficulty</span>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Note: Thresholds above are illustrative prototype boundaries calibrated for demonstration, not official Delhi Transport standards.
          </p>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between gap-4">
          <div className="space-y-2">
            <h3 className="font-display text-base font-bold text-slate-900">
              Explore Network & Data Pipeline
            </h3>
            <p className="text-sm text-slate-600">
              Inspect corridor crowding across Delhi, review operator peak-hour analytics, or upload October CSV ticketing files for validation.
            </p>
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => onNavigate('map')}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200 hover:border-teal-600 hover:bg-teal-50/40 text-left transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
                <Map className="w-4 h-4 text-teal-700" />
                Historical Crowding Map
              </span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('analytics')}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200 hover:border-teal-600 hover:bg-teal-50/40 text-left transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
                <BarChart3 className="w-4 h-4 text-teal-700" />
                Operator Demand Analytics
              </span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('explorer')}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200 hover:border-teal-600 hover:bg-teal-50/40 text-left transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
                <Database className="w-4 h-4 text-teal-700" />
                CSV Validator & Model Explorer
              </span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
