import { useEffect, useMemo, useState } from 'react';
import { DemoNoticeBanner } from './components/DemoNoticeBanner';
import { AppPage, Navbar } from './components/Navbar';
import { AnalyticsDashboard } from './pages/AnalyticsDashboard';
import { CrowdingMap } from './pages/CrowdingMap';
import { DataExplorer } from './pages/DataExplorer';
import { Home } from './pages/Home';
import { JourneyDetails } from './pages/JourneyDetails';
import { JourneyResults } from './pages/JourneyResults';
import { actualDataService } from './services/actualDataService';
import { crowdingService } from './services/crowdingService';
import { journeyService } from './services/journeyService';
import { DEFAULT_SEARCH_QUERY, storageService } from './services/storageService';
import type {
  ActualDatasetResult,
  BalancedWeightsConfig,
  CapacityConfig,
  DataMode,
  JourneyOption,
  PredictionModelType,
  ProcessedGTFSData,
  SearchQuery,
} from './types/transit';
import { DEFAULT_CAPACITY_CONFIG } from './utils/crowdClassification';
import { DEFAULT_BALANCED_WEIGHTS } from './utils/routeScoring';

export default function App() {
  const [currentPage, setCurrentPage] = useState<AppPage>('home');
  const [searchQuery, setSearchQuery] = useState<SearchQuery>(() =>
    storageService.getLastSearch()
  );
  const [capacityConfig, setCapacityConfig] = useState<CapacityConfig>(() =>
    storageService.getCapacityConfig()
  );
  const [preferredModel, setPreferredModel] = useState<PredictionModelType>('baseline-median');
  const [balancedWeights, setBalancedWeights] = useState<BalancedWeightsConfig>(
    DEFAULT_BALANCED_WEIGHTS
  );
  const [dataMode, setDataMode] = useState<DataMode>('demo');
  const [actualDataset, setActualDataset] = useState<ActualDatasetResult | null>(null);
  const [gtfsData, setGtfsData] = useState<ProcessedGTFSData | null>(null);
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null);

  // Sync any server-side processed dataset on mount
  useEffect(() => {
    let mounted = true;
    actualDataService.fetchServerStatus().then(({ gtfs, actualDataset: serverDataset }) => {
      if (!mounted) return;
      if (gtfs) setGtfsData(gtfs);
      if (serverDataset) {
        setActualDataset(serverDataset);
        crowdingService.setUploadedTrainingRecords(
          serverDataset.historicalSegmentRecords,
          serverDataset.aggregatedObservations,
          serverDataset.activeStops
        );
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSaveActualDataset = (dataset: ActualDatasetResult | null) => {
    setActualDataset(dataset);
    if (dataset) {
      crowdingService.setUploadedTrainingRecords(
        dataset.historicalSegmentRecords,
        dataset.aggregatedObservations,
        dataset.activeStops
      );
    } else {
      crowdingService.setUploadedTrainingRecords(null);
      setDataMode('demo');
    }
  };

  const handleSwitchMode = (nextMode: DataMode) => {
    if (nextMode === 'actual' && !actualDataset && !gtfsData) return;
    setDataMode(nextMode);
    setSelectedJourneyId(null);

    const actualStops =
      actualDataset?.activeStops && actualDataset.activeStops.length >= 2
        ? actualDataset.activeStops
        : gtfsData?.stops ?? [];

    // Update default search stops if switching to Actual GTFS stops or back to Demo
    if (nextMode === 'actual' && actualStops.length >= 2) {
      setSearchQuery((prev) => ({
        ...prev,
        sourceStopId: actualStops[0].stop_id,
        destinationStopId: actualStops[Math.min(2, actualStops.length - 1)].stop_id,
        date:
          actualDataset && actualDataset.dateRangeIST.start !== 'N/A'
            ? actualDataset.dateRangeIST.start
            : prev.date,
      }));
    } else if (nextMode === 'demo') {
      setSearchQuery(DEFAULT_SEARCH_QUERY);
    }
  };

  const activeStopsForMode =
    dataMode === 'actual'
      ? actualDataset?.activeStops?.length
        ? actualDataset.activeStops
        : gtfsData?.stops
      : undefined;

  const activeRoutesForMode =
    dataMode === 'actual'
      ? actualDataset?.activeRoutes?.length
        ? actualDataset.activeRoutes
        : gtfsData?.routes ?? []
      : [];

  const searchDetailedResult = useMemo(
    () =>
      journeyService.searchJourneysDetailed(searchQuery, capacityConfig, preferredModel, {
        dataMode,
        actualRoutes: activeRoutesForMode,
        actualStops: activeStopsForMode ?? [],
        scheduledTrips: dataMode === 'actual' ? gtfsData?.scheduledTrips : undefined,
        serviceCalendars: dataMode === 'actual' ? gtfsData?.serviceCalendars : undefined,
        balancedWeights,
      }),
    [
      searchQuery,
      capacityConfig,
      preferredModel,
      dataMode,
      activeRoutesForMode,
      activeStopsForMode,
      gtfsData,
      balancedWeights,
    ]
  );

  const searchResults = searchDetailedResult.journeys;

  const selectedJourney = useMemo(
    () => searchResults.find((j) => j.id === selectedJourneyId) ?? searchResults[0] ?? null,
    [searchResults, selectedJourneyId]
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPage, selectedJourneyId]);

  const handleSearch = (query: SearchQuery) => {
    setSearchQuery(query);
    storageService.saveLastSearch(query);
    setSelectedJourneyId(null);
    setCurrentPage('results');
  };

  const handleRunSampleDemo = () => {
    setDataMode('demo');
    const demoQuery: SearchQuery = {
      sourceStopId: 'DL_ANV',
      destinationStopId: 'DL_CP',
      date: '2026-10-14',
      time: '18:00',
      preferredCategory: 'balanced',
    };
    setSearchQuery(demoQuery);
    storageService.saveLastSearch(demoQuery);
    setSelectedJourneyId(null);
    setCurrentPage('results');
  };

  const handleSelectJourney = (journey: JourneyOption) => {
    setSelectedJourneyId(journey.id);
    setCurrentPage('details');
  };

  const handleUpdateCapacity = (nextConfig: CapacityConfig) => {
    setCapacityConfig(nextConfig);
    storageService.saveCapacityConfig(nextConfig);
  };

  const handleResetDemo = () => {
    storageService.resetAllDemoData();
    void actualDataService.resetServerDataset();
    crowdingService.setUploadedTrainingRecords(null);
    setCapacityConfig(DEFAULT_CAPACITY_CONFIG);
    setBalancedWeights(DEFAULT_BALANCED_WEIGHTS);
    setDataMode('demo');
    setActualDataset(null);
    setGtfsData(null);
    setSearchQuery(DEFAULT_SEARCH_QUERY);
    setSelectedJourneyId(null);
    setCurrentPage('home');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900">
      <Navbar
        currentPage={currentPage}
        onNavigate={(page) => setCurrentPage(page)}
        onRunSampleDemo={handleRunSampleDemo}
      />

      <DemoNoticeBanner
        dataMode={dataMode}
        hasActualDataset={Boolean(actualDataset || gtfsData)}
        actualDatasetName={actualDataset?.sourceName ?? (gtfsData ? 'Uploaded GTFS Feed' : undefined)}
        hasUploadedCsv={Boolean(actualDataset)}
        uploadedFileName={actualDataset?.sourceName}
        onSwitchMode={handleSwitchMode}
        onResetDemo={handleResetDemo}
      />

      <main className="flex-1">
        {currentPage === 'home' && (
          <Home
            initialQuery={searchQuery}
            onSearch={handleSearch}
            onRunSampleDemo={handleRunSampleDemo}
            onNavigate={setCurrentPage}
            dataMode={dataMode}
            activeStops={activeStopsForMode}
          />
        )}

        {currentPage === 'results' && (
          <JourneyResults
            query={searchQuery}
            journeys={searchResults}
            searchErrorCode={searchDetailedResult.errorCode}
            searchErrorMessage={searchDetailedResult.errorMessage}
            capacityConfig={capacityConfig}
            preferredModel={preferredModel}
            balancedWeights={balancedWeights}
            onUpdateBalancedWeights={setBalancedWeights}
            onUpdateModel={setPreferredModel}
            onUpdateCapacity={handleUpdateCapacity}
            onSearch={handleSearch}
            onSelectJourney={handleSelectJourney}
            onBackHome={() => setCurrentPage('home')}
            dataMode={dataMode}
            activeStops={activeStopsForMode}
          />
        )}

        {currentPage === 'details' && selectedJourney && (
          <JourneyDetails
            journey={selectedJourney}
            onBack={() => setCurrentPage('results')}
          />
        )}

        {currentPage === 'details' && !selectedJourney && (
          <JourneyResults
            query={searchQuery}
            journeys={searchResults}
            searchErrorCode={searchDetailedResult.errorCode}
            searchErrorMessage={searchDetailedResult.errorMessage}
            capacityConfig={capacityConfig}
            preferredModel={preferredModel}
            balancedWeights={balancedWeights}
            onUpdateBalancedWeights={setBalancedWeights}
            onUpdateModel={setPreferredModel}
            onUpdateCapacity={handleUpdateCapacity}
            onSearch={handleSearch}
            onSelectJourney={handleSelectJourney}
            onBackHome={() => setCurrentPage('home')}
            dataMode={dataMode}
            activeStops={activeStopsForMode}
          />
        )}

        {currentPage === 'map' && (
          <CrowdingMap
            capacityConfig={capacityConfig}
            preferredModel={preferredModel}
            dataMode={dataMode}
            actualDataset={actualDataset}
            gtfsData={gtfsData}
          />
        )}

        {currentPage === 'analytics' && (
          <AnalyticsDashboard
            capacityConfig={capacityConfig}
            dataMode={dataMode}
            actualDataset={actualDataset}
          />
        )}

        {currentPage === 'explorer' && (
          <DataExplorer
            capacityConfig={capacityConfig}
            onUpdateCapacity={handleUpdateCapacity}
            dataMode={dataMode}
            onSwitchMode={handleSwitchMode}
            actualDataset={actualDataset}
            onSaveActualDataset={handleSaveActualDataset}
            gtfsData={gtfsData}
            onSaveGtfsData={setGtfsData}
          />
        )}
      </main>

      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            <span className="font-display font-bold text-slate-800">CrowdSense</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Travel Smarter. Choose Your Comfort.</span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => setCurrentPage('home')}
              className="hover:text-slate-900 cursor-pointer"
            >
              Journey Planner
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage('map')}
              className="hover:text-slate-900 cursor-pointer"
            >
              Crowding Map
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage('analytics')}
              className="hover:text-slate-900 cursor-pointer"
            >
              Analytics
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage('explorer')}
              className="hover:text-slate-900 cursor-pointer"
            >
              Data & Model Explorer
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
