import { ArrowLeftRight, Calendar, Clock, MapPin, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { POPULAR_STOP_IDS, SAMPLE_STOPS } from '../data/sampleStops';
import type { BusStop, SearchQuery } from '../types/transit';

interface JourneySearchProps {
  initialQuery: SearchQuery;
  onSearch: (query: SearchQuery) => void;
  compact?: boolean;
  stops?: BusStop[];
}

export function JourneySearch({
  initialQuery,
  onSearch,
  compact = false,
  stops = SAMPLE_STOPS,
}: JourneySearchProps) {
  const activeStops = stops.length > 0 ? stops : SAMPLE_STOPS;
  const stopMap = useMemo(
    () => Object.fromEntries(activeStops.map((s) => [s.stop_id, s])),
    [activeStops]
  );

  const [sourceStopId, setSourceStopId] = useState(initialQuery.sourceStopId);
  const [destinationStopId, setDestinationStopId] = useState(initialQuery.destinationStopId);
  const [date, setDate] = useState(initialQuery.date);
  const [time, setTime] = useState(initialQuery.time);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeStops.length > 0 && !stopMap[sourceStopId]) {
      setSourceStopId(activeStops[0].stop_id);
    }
    if (activeStops.length > 1 && !stopMap[destinationStopId]) {
      setDestinationStopId(activeStops[Math.min(1, activeStops.length - 1)].stop_id);
    }
  }, [activeStops, stopMap, sourceStopId, destinationStopId]);

  const popularIds = useMemo(() => {
    const matched = POPULAR_STOP_IDS.filter((id) => Boolean(stopMap[id]));
    if (matched.length > 0) return matched;
    return activeStops.slice(0, 6).map((s) => s.stop_id);
  }, [activeStops, stopMap]);

  const handleSwap = () => {
    setSourceStopId(destinationStopId);
    setDestinationStopId(sourceStopId);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceStopId || !destinationStopId) {
      setError('Please select both a boarding stop and a destination stop.');
      return;
    }
    if (sourceStopId === destinationStopId) {
      setError('Source and destination stops must be different.');
      return;
    }
    setError(null);
    onSearch({ sourceStopId, destinationStopId, date, time });
  };

  const handleQuickDestination = (stopId: string) => {
    if (stopId === sourceStopId) {
      setDestinationStopId(sourceStopId);
      setSourceStopId(destinationStopId);
    } else {
      setDestinationStopId(stopId);
    }
    setError(null);
  };

  return (
    <div className={`bg-white border border-slate-200 rounded-xl ${compact ? 'p-4' : 'p-6 sm:p-7'}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          {/* Source Stop */}
          <div className="lg:col-span-4">
            <label
              htmlFor="source-stop"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              From (Boarding Stop)
            </label>
            <div className="relative">
              <MapPin className="w-4 h-4 text-teal-700 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                id="source-stop"
                value={sourceStopId}
                onChange={(e) => {
                  setSourceStopId(e.target.value);
                  setError(null);
                }}
                className="w-full h-11 pl-9 pr-3 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              >
                {activeStops.slice(0, 300).map((stop) => (
                  <option key={stop.stop_id} value={stop.stop_id}>
                    {stop.stop_name} ({stop.zone})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Swap Button */}
          <div className="lg:col-span-1 flex justify-center">
            <button
              type="button"
              onClick={handleSwap}
              className="h-11 w-full lg:w-11 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-teal-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              aria-label="Swap source and destination"
              title="Swap source and destination"
            >
              <ArrowLeftRight className="w-4 h-4" />
            </button>
          </div>

          {/* Destination Stop */}
          <div className="lg:col-span-3">
            <label
              htmlFor="dest-stop"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              To (Destination Stop)
            </label>
            <div className="relative">
              <MapPin className="w-4 h-4 text-slate-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                id="dest-stop"
                value={destinationStopId}
                onChange={(e) => {
                  setDestinationStopId(e.target.value);
                  setError(null);
                }}
                className="w-full h-11 pl-9 pr-3 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              >
                {activeStops.slice(0, 300).map((stop) => (
                  <option key={stop.stop_id} value={stop.stop_id}>
                    {stop.stop_name} ({stop.zone})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Departure Date */}
          <div className="lg:col-span-2">
            <label
              htmlFor="dep-date"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              Date
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="dep-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-11 pl-9 pr-3 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 font-mono-tabular focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>
          </div>

          {/* Departure Time */}
          <div className="lg:col-span-2">
            <label
              htmlFor="dep-time"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              Departure Time
            </label>
            <div className="relative">
              <Clock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="dep-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full h-11 pl-9 pr-3 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 font-mono-tabular focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
          {!compact ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500 mr-1">Popular hubs:</span>
              {popularIds.map((id) => {
                const stop = stopMap[id];
                if (!stop) return null;
                const isSelectedDest = destinationStopId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleQuickDestination(id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                      isSelectedDest
                        ? 'bg-teal-700 text-white border-teal-700'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {stop.short_name}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-slate-500">
              Showing historical segment-level crowding estimates for selected time window.
            </div>
          )}

          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 h-11 bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            <Search className="w-4 h-4" />
            Search Buses
          </button>
        </div>
      </form>
    </div>
  );
}
