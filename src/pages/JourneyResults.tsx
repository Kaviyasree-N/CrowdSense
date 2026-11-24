import { ArrowLeft, Bus, Scale, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { JourneyCard } from '../components/JourneyCard';
import { JourneyComparisonTable } from '../components/JourneyComparisonTable';
import { JourneySearch } from '../components/JourneySearch';
import { SAMPLE_STOPS, STOP_MAP } from '../data/sampleStops';
import { getDayTypeFromDate } from '../services/crowdingService';
import { recommendationService } from '../services/recommendationService';
import type {
  BalancedWeightsConfig,
  BusStop,
  CapacityConfig,
  DataMode,
  JourneyOption,
  JourneySearchErrorCode,
  PredictionModelType,
  RecommendationCategory,
  SearchQuery,
  SortOption,
} from '../types/transit';

interface JourneyResultsProps {
  query: SearchQuery;
  journeys: JourneyOption[];
  searchErrorCode?: JourneySearchErrorCode;
  searchErrorMessage?: string;
  capacityConfig: CapacityConfig;
  preferredModel: PredictionModelType;
  balancedWeights: BalancedWeightsConfig;
  onUpdateBalancedWeights: (weights: BalancedWeightsConfig) => void;
  onUpdateModel: (model: PredictionModelType) => void;
  onUpdateCapacity: (config: CapacityConfig) => void;
  onSearch: (query: SearchQuery) => void;
  onSelectJourney: (journey: JourneyOption) => void;
  onBackHome: () => void;
  dataMode?: DataMode;
  activeStops?: BusStop[];
}

export function JourneyResults({
  query,
  journeys,
  searchErrorCode,
  searchErrorMessage,
  capacityConfig,
  preferredModel,
  balancedWeights,
  onUpdateBalancedWeights,
  onUpdateModel,
  onUpdateCapacity,
  onSearch,
  onSelectJourney,
  onBackHome,
  dataMode = 'demo',
  activeStops,
}: JourneyResultsProps) {
  const [sortBy, setSortBy] = useState<SortOption>(query.preferredCategory ?? 'balanced');
  const [categoryFilter, setCategoryFilter] = useState<RecommendationCategory | 'all'>('all');
  const [maxDurationFilter, setMaxDurationFilter] = useState<number>(0); // 0 = no limit
  const [maxTransfersFilter, setMaxTransfersFilter] = useState<number>(2);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  useEffect(() => {
    if (query.preferredCategory) {
      setSortBy(query.preferredCategory);
    }
    setCompareIds([]);
  }, [query]);

  const stopLookup = useMemo(
    () =>
      dataMode === 'actual' && activeStops && activeStops.length > 0
        ? Object.fromEntries(activeStops.map((s) => [s.stop_id, s]))
        : STOP_MAP,
    [dataMode, activeStops]
  );

  const sourceStop = stopLookup[query.sourceStopId];
  const destStop = stopLookup[query.destinationStopId];
  const dayType = getDayTypeFromDate(query.date);

  const displayedJourneys = useMemo(() => {
    let filtered = recommendationService.filterByCategory(journeys, categoryFilter);
    if (maxTransfersFilter < 2) {
      filtered = filtered.filter((j) => j.transfers <= maxTransfersFilter);
    }
    if (maxDurationFilter > 0) {
      filtered = filtered.filter((j) => j.total_duration_mins <= maxDurationFilter);
    }
    return recommendationService.sortJourneys(filtered, sortBy);
  }, [journeys, categoryFilter, maxTransfersFilter, maxDurationFilter, sortBy]);

  const comparedJourneys = useMemo(
    () => journeys.filter((j) => compareIds.includes(j.id)).slice(0, 3),
    [journeys, compareIds]
  );

  const handleToggleCompare = (journeyId: string) => {
    setCompareIds((prev) => {
      if (prev.includes(journeyId)) return prev.filter((id) => id !== journeyId);
      if (prev.length >= 3) return prev;
      return [...prev, journeyId];
    });
  };

  const fastestOption = journeys.find((j) => j.recommendation_tags.includes('fastest'));
  const comfortOption = journeys.find((j) => j.recommendation_tags.includes('least-crowded'));
  const balancedOption = journeys.find((j) => j.recommendation_tags.includes('balanced'));

  const timeWeightPct = Math.round(balancedWeights.timeWeight * 100);
  const crowdWeightPct = 100 - timeWeightPct;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Breadcrumb & Back */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackHome}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Planner Home
        </button>

        <div className="text-xs text-slate-500">
          {dayType === 'weekday' ? 'Weekday schedule pattern' : 'Weekend schedule pattern'}
          <span className="mx-1.5" aria-hidden="true">·</span>
          <span className="font-mono-tabular">
            {query.date} at {query.time}
          </span>
        </div>
      </div>

      {/* Inline Editable Search Bar */}
      <JourneySearch
        initialQuery={query}
        onSearch={onSearch}
        compact
        stops={dataMode === 'actual' ? activeStops : SAMPLE_STOPS}
      />

      {/* Page Heading & Quick Recommendation Comparison */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">
              {sourceStop?.short_name ?? 'Origin'} → {destStop?.short_name ?? 'Destination'}
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              {journeys.length > 0
                ? `${journeys.length} bus journeys compared by travel time, transfers (up to 2), and segment-level predicted crowding.`
                : searchErrorMessage ??
                  (dataMode === 'actual' && (!activeStops || activeStops.length === 0)
                    ? 'Actual Data Mode is active, but static GTFS route/stop sequences have not been uploaded yet.'
                    : 'No direct, 1-transfer, or 2-transfer corridors found between these stops.')}
            </p>
          </div>

          {dataMode === 'actual' ? (
            <div className="text-xs font-mono-tabular font-semibold px-2.5 py-1 rounded bg-emerald-50 text-emerald-900 border border-emerald-200 whitespace-nowrap self-start sm:self-auto">
              ACTUAL DATA MODE
            </div>
          ) : (
            <div className="text-xs font-mono-tabular font-semibold px-2.5 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap self-start sm:self-auto">
              DEMO DATA – NOT ACTUAL TRANSPORT DATA
            </div>
          )}
        </div>

        {/* 3 Recommendation Mode Summary Strip */}
        {journeys.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {fastestOption && (
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter(categoryFilter === 'fastest' ? 'all' : 'fastest');
                  setSortBy('fastest');
                }}
                className={`text-left rounded-xl border p-4 transition-colors cursor-pointer ${
                  categoryFilter === 'fastest'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white border-slate-200 hover:border-slate-400'
                }`}
              >
                <div
                  className={`text-xs font-semibold ${
                    categoryFilter === 'fastest' ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  Fastest Route · Route {fastestOption.legs.map((l) => l.route_number).join('+')}
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="font-display text-lg font-bold font-mono-tabular">
                    {fastestOption.total_duration_mins} min
                  </span>
                  <span
                    className={`text-xs font-medium ${
                      categoryFilter === 'fastest' ? 'text-amber-300' : 'text-slate-700'
                    }`}
                  >
                    {fastestOption.all_segments.every((s) => s.has_historical_data === false)
                      ? 'Insufficient historical data'
                      : `Peak ${fastestOption.peak_segment_occupancy_pct}% (${fastestOption.peak_crowding_level})`}
                  </span>
                </div>
              </button>
            )}

            {balancedOption && (
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter(categoryFilter === 'balanced' ? 'all' : 'balanced');
                  setSortBy('balanced');
                }}
                className={`text-left rounded-xl border p-4 transition-colors cursor-pointer ${
                  categoryFilter === 'balanced'
                    ? 'bg-teal-800 text-white border-teal-800'
                    : 'bg-white border-slate-200 hover:border-teal-600'
                }`}
              >
                <div
                  className={`text-xs font-semibold ${
                    categoryFilter === 'balanced' ? 'text-teal-100' : 'text-teal-800'
                  }`}
                >
                  Balanced Route ({timeWeightPct}/{crowdWeightPct}) · Route{' '}
                  {balancedOption.legs.map((l) => l.route_number).join('+')}
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="font-display text-lg font-bold font-mono-tabular">
                    {balancedOption.total_duration_mins} min
                  </span>
                  <span
                    className={`text-xs font-medium ${
                      categoryFilter === 'balanced' ? 'text-teal-100' : 'text-slate-700'
                    }`}
                  >
                    {balancedOption.all_segments.every((s) => s.has_historical_data === false)
                      ? 'Insufficient historical data'
                      : `Peak ${balancedOption.peak_segment_occupancy_pct}% (${balancedOption.peak_crowding_level})`}
                  </span>
                </div>
              </button>
            )}

            {comfortOption && (
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter(categoryFilter === 'least-crowded' ? 'all' : 'least-crowded');
                  setSortBy('least-crowded');
                }}
                className={`text-left rounded-xl border p-4 transition-colors cursor-pointer ${
                  categoryFilter === 'least-crowded'
                    ? 'bg-emerald-800 text-white border-emerald-800'
                    : 'bg-white border-slate-200 hover:border-emerald-600'
                }`}
              >
                <div
                  className={`text-xs font-semibold ${
                    categoryFilter === 'least-crowded' ? 'text-emerald-100' : 'text-emerald-800'
                  }`}
                >
                  Least Crowded · Route {comfortOption.legs.map((l) => l.route_number).join('+')}
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="font-display text-lg font-bold font-mono-tabular">
                    {comfortOption.total_duration_mins} min
                  </span>
                  <span
                    className={`text-xs font-medium ${
                      categoryFilter === 'least-crowded' ? 'text-emerald-100' : 'text-slate-700'
                    }`}
                  >
                    {comfortOption.all_segments.every((s) => s.has_historical_data === false)
                      ? 'Insufficient historical data'
                      : `Peak ${comfortOption.peak_segment_occupancy_pct}% (${comfortOption.peak_crowding_level})`}
                  </span>
                </div>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Controls Bar: Filters, Duration/Transfer Caps, Balanced Weights, Capacity & Sort */}
      {journeys.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3.5 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-600 mr-1">Show:</span>
              {(
                [
                  { id: 'all', label: `All (${journeys.length})` },
                  { id: 'balanced', label: 'Balanced' },
                  { id: 'fastest', label: 'Fastest' },
                  { id: 'least-crowded', label: 'Least Crowded' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCategoryFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    categoryFilter === tab.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Max Transfers Filter */}
              <div className="flex items-center gap-1.5 text-xs text-slate-700">
                <label htmlFor="max-xfers" className="font-medium whitespace-nowrap">
                  Max Transfers:
                </label>
                <select
                  id="max-xfers"
                  value={maxTransfersFilter}
                  onChange={(e) => setMaxTransfersFilter(Number(e.target.value))}
                  className="bg-slate-50 border border-slate-300 rounded px-2 py-1 text-xs font-medium text-slate-900"
                >
                  <option value={2}>Up to 2 transfers</option>
                  <option value={1}>Up to 1 transfer</option>
                  <option value={0}>Direct only (0)</option>
                </select>
              </div>

              {/* Max Duration Filter */}
              <div className="flex items-center gap-1.5 text-xs text-slate-700">
                <label htmlFor="max-dur" className="font-medium whitespace-nowrap">
                  Max Duration:
                </label>
                <select
                  id="max-dur"
                  value={maxDurationFilter}
                  onChange={(e) => setMaxDurationFilter(Number(e.target.value))}
                  className="bg-slate-50 border border-slate-300 rounded px-2 py-1 text-xs font-mono-tabular text-slate-900"
                >
                  <option value={0}>Any duration</option>
                  <option value={45}>≤ 45 min</option>
                  <option value={60}>≤ 60 min</option>
                  <option value={90}>≤ 90 min</option>
                  <option value={120}>≤ 120 min</option>
                </select>
              </div>

              {/* Sort By */}
              <div className="flex items-center gap-1.5 text-xs text-slate-700">
                <label htmlFor="sort-journeys" className="font-medium whitespace-nowrap">
                  Sort by:
                </label>
                <select
                  id="sort-journeys"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="bg-slate-50 border border-slate-300 rounded px-2.5 py-1 text-xs font-semibold text-slate-900"
                >
                  <option value="balanced">Balanced (Time + Comfort)</option>
                  <option value="fastest">Fastest Duration</option>
                  <option value="least-crowded">Least Crowded</option>
                  <option value="fewest-transfers">Fewest Transfers</option>
                </select>
              </div>
            </div>
          </div>

          {/* Second control row: Configurable Balanced Weights + Model + Capacity */}
          <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-700">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                <Scale className="w-3.5 h-3.5 text-teal-700" />
                Balanced Trade-Off Weights:
              </span>
              <input
                aria-label="Balanced time vs crowding weight"
                type="range"
                min={0}
                max={100}
                step={10}
                value={timeWeightPct}
                onChange={(e) => {
                  const t = Number(e.target.value) / 100;
                  onUpdateBalancedWeights({
                    timeWeight: t,
                    crowdingWeight: Number((1 - t).toFixed(2)),
                  });
                }}
                className="w-32 accent-teal-700 cursor-pointer"
              />
              <span className="font-mono-tabular text-slate-700">
                {timeWeightPct}% Time / {crowdWeightPct}% Crowding
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label htmlFor="pred-model" className="font-medium whitespace-nowrap">
                  Model:
                </label>
                <select
                  id="pred-model"
                  value={preferredModel}
                  onChange={(e) => onUpdateModel(e.target.value as PredictionModelType)}
                  className="bg-slate-50 border border-slate-300 rounded px-2 py-1 text-xs font-medium text-slate-900"
                >
                  <option value="baseline-median">Baseline Median</option>
                  <option value="random-forest">Random Forest (12 Trees)</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                <label htmlFor="nonac-cap" className="font-medium whitespace-nowrap">
                  Std Bus Capacity:
                </label>
                <select
                  id="nonac-cap"
                  value={capacityConfig.nonAcCapacity}
                  onChange={(e) => {
                    const nonAc = Number(e.target.value);
                    onUpdateCapacity({
                      ...capacityConfig,
                      nonAcCapacity: nonAc,
                      acCapacity: Math.max(35, nonAc - 5),
                    });
                  }}
                  className="bg-slate-50 border border-slate-300 rounded px-2 py-1 text-xs font-mono-tabular"
                >
                  <option value={45}>45 pax (AC 40)</option>
                  <option value={50}>50 pax (AC 45 · Default)</option>
                  <option value={60}>60 pax (AC 55)</option>
                  <option value={70}>70 pax (AC 65)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Side-by-Side Comparison Matrix (up to 3 selected journeys) */}
      {comparedJourneys.length > 0 && (
        <JourneyComparisonTable
          journeys={comparedJourneys}
          onRemove={(id) => setCompareIds((prev) => prev.filter((x) => x !== id))}
          onClearAll={() => setCompareIds([])}
          onSelectJourney={onSelectJourney}
        />
      )}

      {/* Results List or Empty / Error State */}
      {displayedJourneys.length > 0 ? (
        <div className="space-y-4">
          {displayedJourneys.map((journey) => (
            <JourneyCard
              key={journey.id}
              journey={journey}
              onSelect={onSelectJourney}
              isCompared={compareIds.includes(journey.id)}
              compareDisabled={compareIds.length >= 3}
              onToggleCompare={handleToggleCompare}
            />
          ))}
        </div>
      ) : journeys.length > 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
          <h2 className="font-display text-base font-bold text-slate-900">
            No journeys match the active duration / transfer filters
          </h2>
          <p className="text-xs text-slate-600">
            {journeys.length} valid journey(s) exist for this search, but were filtered out by your max transfers or max duration constraints.
          </p>
          <button
            type="button"
            onClick={() => {
              setMaxDurationFilter(0);
              setMaxTransfersFilter(2);
              setCategoryFilter('all');
            }}
            className="inline-flex items-center px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <div className="w-11 h-11 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
            <Bus className="w-5 h-5" />
          </div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            {searchErrorCode === 'MISSING_GTFS'
              ? 'GTFS routes and stop sequences not loaded'
              : searchErrorCode === 'NO_SERVICE_ON_DATE'
              ? 'No scheduled bus service on selected date'
              : searchErrorCode === 'INVALID_TIME' || searchErrorCode === 'INVALID_DATE'
              ? 'Invalid departure date or time'
              : 'No matching bus journeys found'}
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            {searchErrorMessage ??
              'No direct, 1-transfer, or 2-transfer connections were found for this origin, destination, and departure window.'}
          </p>
          {dataMode === 'demo' && (
            <button
              type="button"
              onClick={() =>
                onSearch({
                  sourceStopId: 'DL_ANV',
                  destinationStopId: 'DL_CP',
                  date: '2026-10-14',
                  time: '18:00',
                  preferredCategory: 'balanced',
                })
              }
              className="inline-flex items-center px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Load Anand Vihar → Connaught Place (6 PM)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
