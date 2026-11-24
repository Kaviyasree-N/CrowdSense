import { Info, MapPin, Navigation } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfidenceTag, CrowdBadge } from '../components/CrowdBadge';
import { PredictionExplainPanel } from '../components/PredictionExplainPanel';
import { NetworkMapSegment, RouteMap } from '../components/RouteMap';
import { SAMPLE_ROUTES } from '../data/sampleRoutes';
import { SAMPLE_STOPS, STOP_MAP } from '../data/sampleStops';
import { crowdingService } from '../services/crowdingService';
import type {
  ActualDatasetResult,
  BusStop,
  CapacityConfig,
  DataMode,
  DayType,
  PredictionModelType,
} from '../types/transit';

interface CrowdingMapProps {
  capacityConfig: CapacityConfig;
  preferredModel: PredictionModelType;
  dataMode?: DataMode;
  actualDataset?: ActualDatasetResult | null;
}

export function CrowdingMap({
  capacityConfig,
  preferredModel,
  dataMode = 'demo',
  actualDataset = null,
}: CrowdingMapProps) {
  const [selectedHour, setSelectedHour] = useState<number>(18);
  const [dayType, setDayType] = useState<DayType>('weekday');
  const [routeFilter, setRouteFilter] = useState<string>('ALL');
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'UP' | 'DOWN'>('ALL');
  const [selectedSegment, setSelectedSegment] = useState<NetworkMapSegment | null>(null);
  const [selectedStop, setSelectedStop] = useState<BusStop | null>(null);

  const isActual = dataMode === 'actual' && Boolean(actualDataset);
  const activeRoutes = isActual ? actualDataset!.activeRoutes : SAMPLE_ROUTES;
  const activeStops = isActual ? actualDataset!.activeStops : SAMPLE_STOPS;
  const stopLookup = useMemo(
    () =>
      isActual
        ? Object.fromEntries(activeStops.map((s) => [s.stop_id, s]))
        : STOP_MAP,
    [isActual, activeStops]
  );

  const uniqueRouteNumbers = useMemo(
    () => Array.from(new Set(activeRoutes.map((r) => r.route_number))).slice(0, 150),
    [activeRoutes]
  );

  const networkSegments = useMemo<NetworkMapSegment[]>(() => {
    const depTimeStr = `${String(selectedHour).padStart(2, '0')}:00`;
    const dayOfWeek = dayType === 'weekend' ? 6 : 3;
    const segments: NetworkMapSegment[] = [];

    // Cap rendered routes when ALL is selected on huge GTFS feeds to keep Leaflet responsive
    const routesToRender =
      routeFilter === 'ALL' ? activeRoutes.slice(0, 30) : activeRoutes;

    routesToRender.forEach((route) => {
      if (routeFilter !== 'ALL' && route.route_number !== routeFilter) return;
      if (directionFilter !== 'ALL' && route.direction !== directionFilter) return;

      for (let i = 0; i < route.stops.length - 1; i++) {
        const curr = route.stops[i];
        const next = route.stops[i + 1];
        const fromStop = stopLookup[curr.stop_id];
        const toStop = stopLookup[next.stop_id];
        if (!fromStop || !toStop) continue;

        const duration = Math.max(1, next.minutes_from_start - curr.minutes_from_start);
        const est = crowdingService.estimateSegment(
          route,
          curr.stop_id,
          next.stop_id,
          depTimeStr,
          duration,
          dayType,
          capacityConfig,
          i + 1,
          dayOfWeek,
          preferredModel,
          isActual ? 'actual' : 'demo',
          stopLookup
        );

        segments.push({
          id: `${route.route_id}-${curr.stop_id}-${next.stop_id}`,
          routeId: route.route_id,
          routeNumber: route.route_number,
          direction: route.direction,
          directionLabel: route.direction_label,
          fromStop,
          toStop,
          estimatedLoad: est.estimated_load,
          assumedCapacity: est.assumed_capacity,
          occupancyPct: est.occupancy_pct,
          crowdingLevel: est.crowding_level,
          confidence: est.confidence,
          observationsCount: est.observations_count,
          predictionExplanation: est.prediction_explanation,
        });
      }
    });

    return segments;
  }, [
    selectedHour,
    dayType,
    routeFilter,
    directionFilter,
    capacityConfig,
    preferredModel,
    activeRoutes,
    stopLookup,
    isActual,
  ]);

  const stopConnections = useMemo(() => {
    if (!selectedStop) return [];
    return networkSegments.filter(
      (s) =>
        s.fromStop.stop_id === selectedStop.stop_id ||
        s.toStop.stop_id === selectedStop.stop_id
    );
  }, [selectedStop, networkSegments]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Header & Explicit Historical/Predicted Disclaimer */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-teal-800">
            Historical / Predicted Corridor Crowding Map (Not Live GPS Occupancy)
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
            Delhi Bus Network Crowding Explorer
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Click any colored route segment or bus stop to inspect predicted passenger load from{' '}
            {isActual
              ? `actual processed ETM records (${actualDataset!.sourceName}).`
              : 'historical October 2026 ETM ticket patterns.'}
          </p>
        </div>

        {isActual ? (
          <span className="text-xs font-mono-tabular font-semibold px-2.5 py-1 rounded bg-emerald-50 text-emerald-900 border border-emerald-200 whitespace-nowrap self-start md:self-auto">
            ACTUAL DATA MODE
          </span>
        ) : (
          <span className="text-xs font-mono-tabular font-semibold px-2.5 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap self-start md:self-auto">
            DEMO DATA – NOT ACTUAL TRANSPORT DATA
          </span>
        )}
      </div>

      {isActual && activeRoutes.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900">
          Actual ETM dataset is loaded, but no static GTFS route stop sequences (<code className="font-mono">routes.txt</code>, <code className="font-mono">trips.txt</code>, <code className="font-mono">stops.txt</code>, <code className="font-mono">stop_times.txt</code>) have been uploaded yet. Upload GTFS files in Data & Model Explorer to map route corridors.
        </div>
      )}

      {/* Interactive Map Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
        <div>
          <label htmlFor="map-hour" className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1.5">
            <span>Time Window (IST)</span>
            <span className="font-mono-tabular text-teal-800">
              {String(selectedHour).padStart(2, '0')}:00
            </span>
          </label>
          <input
            id="map-hour"
            type="range"
            min={5}
            max={23}
            value={selectedHour}
            onChange={(e) => setSelectedHour(Number(e.target.value))}
            className="w-full accent-teal-700 cursor-pointer"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Schedule Pattern
          </label>
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
            {(['weekday', 'weekend'] as DayType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setDayType(type)}
                className={`py-1.5 text-xs font-semibold rounded-md capitalize transition-colors cursor-pointer ${
                  dayType === type
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="map-route" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Bus Route
          </label>
          <select
            id="map-route"
            value={routeFilter}
            onChange={(e) => {
              setRouteFilter(e.target.value);
              setSelectedSegment(null);
            }}
            className="w-full h-9 px-3 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-900"
          >
            <option value="ALL">All Routes ({uniqueRouteNumbers.length})</option>
            {uniqueRouteNumbers.map((num) => (
              <option key={num} value={num}>
                Route {num}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="map-dir" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Direction
          </label>
          <select
            id="map-dir"
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value as 'ALL' | 'UP' | 'DOWN')}
            className="w-full h-9 px-3 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-900"
          >
            <option value="ALL">Both Directions (UP & DOWN)</option>
            <option value="UP">UP Direction Only</option>
            <option value="DOWN">DOWN Direction Only</option>
          </select>
        </div>
      </div>

      {/* Map + Inspection Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8">
          <RouteMap
            mode="network"
            networkSegments={networkSegments}
            stops={activeStops.slice(0, 350)}
            selectedSegmentId={selectedSegment?.id}
            selectedStopId={selectedStop?.stop_id}
            onSelectSegment={(seg) => {
              setSelectedSegment(seg);
              setSelectedStop(null);
            }}
            onSelectStop={(stop) => {
              setSelectedStop(stop);
              setSelectedSegment(null);
            }}
            heightClass="h-[520px]"
          />
        </div>

        <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          {selectedSegment ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
                <div>
                  <div className="text-xs font-medium text-slate-500">
                    Route {selectedSegment.routeNumber} · {selectedSegment.direction} Direction
                  </div>
                  <h2 className="font-display text-lg font-bold text-slate-900 mt-0.5">
                    {selectedSegment.fromStop.short_name} → {selectedSegment.toStop.short_name}
                  </h2>
                  <p className="text-xs text-slate-500">{selectedSegment.directionLabel}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-slate-500">Historical Predicted Crowding</div>
                <CrowdBadge
                  level={selectedSegment.crowdingLevel}
                  occupancyPct={selectedSegment.occupancyPct}
                  passengerLoad={selectedSegment.estimatedLoad}
                  capacity={selectedSegment.assumedCapacity}
                />
                <div className="pt-1">
                  <ConfidenceTag confidence={selectedSegment.confidence} />
                </div>
              </div>

              <div className="divide-y divide-slate-100 text-xs">
                <div className="py-2 flex justify-between">
                  <span className="text-slate-500">Time Window</span>
                  <span className="font-mono-tabular font-semibold text-slate-900">
                    {String(selectedHour).padStart(2, '0')}:00 ({dayType})
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-500">Estimated Load</span>
                  <span className="font-mono-tabular font-semibold text-slate-900">
                    {selectedSegment.estimatedLoad} passengers
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-500">Assumed Vehicle Capacity</span>
                  <span className="font-mono-tabular font-semibold text-slate-900">
                    {selectedSegment.assumedCapacity} passengers
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-500">Historical Observations</span>
                  <span className="font-mono-tabular font-semibold text-slate-900">
                    {selectedSegment.observationsCount} trips
                  </span>
                </div>
              </div>

              {selectedSegment.predictionExplanation && (
                <PredictionExplainPanel explanation={selectedSegment.predictionExplanation} />
              )}
            </div>
          ) : selectedStop ? (
            <div className="space-y-4">
              <div className="pb-3 border-b border-slate-100">
                <div className="text-xs font-medium text-teal-800 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  Selected Bus Stop · {selectedStop.zone}
                </div>
                <h2 className="font-display text-lg font-bold text-slate-900 mt-0.5">
                  {selectedStop.stop_name}
                </h2>
                <div className="text-xs font-mono-tabular text-slate-500 mt-0.5">
                  {selectedStop.lat.toFixed(4)}° N, {selectedStop.lng.toFixed(4)}° E
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-700">
                  Segments Serving This Stop at {String(selectedHour).padStart(2, '0')}:00 ({stopConnections.length})
                </h3>
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                  {stopConnections.map((seg) => (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() => setSelectedSegment(seg)}
                      className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-teal-600 transition-colors space-y-1.5 cursor-pointer"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-900">
                          Route {seg.routeNumber} ({seg.direction})
                        </span>
                        <span className="font-mono-tabular text-slate-500">
                          {seg.occupancyPct}%
                        </span>
                      </div>
                      <div className="text-xs text-slate-600">
                        {seg.fromStop.short_name} → {seg.toStop.short_name}
                      </div>
                      <CrowdBadge level={seg.crowdingLevel} compact />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <div className="w-10 h-10 rounded-lg bg-teal-50 text-teal-800 flex items-center justify-center">
                <Navigation className="w-5 h-5" />
              </div>
              <div className="space-y-1.5">
                <h2 className="font-display text-base font-bold text-slate-900">
                  Select a Route Segment or Stop
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Click any colored polyline or bus stop marker on the map to view predicted passenger occupancy, assumed capacity, and historical data confidence.
                </p>
              </div>
              <div className="pt-2 border-t border-slate-100 flex items-start gap-2 text-xs text-slate-500">
                <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span>
                  Colors represent historical pattern estimates for {String(selectedHour).padStart(2, '0')}:00 ({dayType}), not real-time GPS vehicle locations.
                </span>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
