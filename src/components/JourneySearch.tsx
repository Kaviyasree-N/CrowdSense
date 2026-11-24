import {
  ArrowLeftRight,
  Calendar,
  Clock,
  Compass,
  MapPin,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { POPULAR_STOP_IDS, SAMPLE_STOPS } from '../data/sampleStops';
import { isValidIsoDate, parseClockTimeToMinutes } from '../engine/journeyGraph';
import type { BusStop, RecommendationCategory, SearchQuery } from '../types/transit';

interface JourneySearchProps {
  initialQuery: SearchQuery;
  onSearch: (query: SearchQuery) => void;
  compact?: boolean;
  stops?: BusStop[];
}

interface StopAutocompleteProps {
  id: string;
  label: string;
  selectedStopId: string;
  stops: BusStop[];
  stopMap: Record<string, BusStop>;
  iconColorClass?: string;
  placeholder: string;
  onSelectStop: (stopId: string) => void;
}

function StopAutocomplete({
  id,
  label,
  selectedStopId,
  stops,
  stopMap,
  iconColorClass = 'text-teal-700',
  placeholder,
  onSelectStop,
}: StopAutocompleteProps) {
  const selectedStop = stopMap[selectedStopId];
  const [inputText, setInputText] = useState(
    selectedStop ? `${selectedStop.stop_name} (${selectedStop.stop_id})` : ''
  );
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const s = stopMap[selectedStopId];
    setInputText(s ? `${s.stop_name} (${s.stop_id})` : '');
  }, [selectedStopId, stopMap]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        const s = stopMap[selectedStopId];
        setInputText(s ? `${s.stop_name} (${s.stop_id})` : '');
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [selectedStopId, stopMap]);

  const filteredStops = useMemo(() => {
    const q = inputText.trim().toLowerCase();
    const currentFormatted = selectedStop
      ? `${selectedStop.stop_name} (${selectedStop.stop_id})`.toLowerCase()
      : '';
    if (!q || q === currentFormatted) {
      return stops.slice(0, 40);
    }
    return stops
      .filter(
        (s) =>
          s.stop_name.toLowerCase().includes(q) ||
          s.short_name.toLowerCase().includes(q) ||
          s.stop_id.toLowerCase().includes(q) ||
          s.zone.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [inputText, stops, selectedStop]);

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-700 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <MapPin
          className={`w-4 h-4 ${iconColorClass} absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none`}
        />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          value={inputText}
          placeholder={placeholder}
          onFocus={() => {
            setIsOpen(true);
          }}
          onChange={(e) => {
            const val = e.target.value;
            setInputText(val);
            setIsOpen(true);
            const exactById = stops.find(
              (s) => s.stop_id.toLowerCase() === val.trim().toLowerCase()
            );
            if (exactById) {
              onSelectStop(exactById.stop_id);
            } else if (val.trim() === '') {
              onSelectStop('');
            }
          }}
          className="w-full h-11 pl-9 pr-3 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
        />
      </div>

      {isOpen && (
        <ul
          role="listbox"
          className="absolute z-40 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-lg divide-y divide-slate-100"
        >
          {filteredStops.length > 0 ? (
            filteredStops.map((stop) => {
              const isSelected = stop.stop_id === selectedStopId;
              return (
                <li key={stop.stop_id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSelectStop(stop.stop_id);
                      setInputText(`${stop.stop_name} (${stop.stop_id})`);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 hover:bg-teal-50 cursor-pointer ${
                      isSelected ? 'bg-teal-50 text-teal-900 font-semibold' : 'text-slate-800'
                    }`}
                  >
                    <span className="truncate">
                      <span className="font-semibold">{stop.stop_name}</span>
                      <span className="text-slate-500 ml-1.5">· {stop.zone}</span>
                    </span>
                    <span className="font-mono-tabular text-[11px] text-slate-500 shrink-0">
                      {stop.stop_id}
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="px-3 py-2.5 text-xs text-slate-500">
              No matching bus stops found. Try stop name or GTFS Stop ID.
            </li>
          )}
        </ul>
      )}
    </div>
  );
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
  const [preferredCategory, setPreferredCategory] = useState<RecommendationCategory>(
    initialQuery.preferredCategory ?? 'balanced'
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSourceStopId(initialQuery.sourceStopId);
    setDestinationStopId(initialQuery.destinationStopId);
    setDate(initialQuery.date);
    setTime(initialQuery.time);
    setPreferredCategory(initialQuery.preferredCategory ?? 'balanced');
  }, [initialQuery]);

  useEffect(() => {
    if (activeStops.length > 0 && sourceStopId && !stopMap[sourceStopId]) {
      setSourceStopId(activeStops[0].stop_id);
    }
    if (activeStops.length > 1 && destinationStopId && !stopMap[destinationStopId]) {
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

  const handleClear = () => {
    setSourceStopId('');
    setDestinationStopId('');
    setDate('2026-10-14');
    setTime('18:00');
    setPreferredCategory('balanced');
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceStopId || !destinationStopId) {
      setError('Please select both a valid source stop and destination stop from the list.');
      return;
    }
    if (!stopMap[sourceStopId] || !stopMap[destinationStopId]) {
      setError('Unrecognized stop ID. Choose stops from the autocomplete suggestions.');
      return;
    }
    if (sourceStopId === destinationStopId) {
      setError('Source and destination bus stops must be different.');
      return;
    }
    if (!isValidIsoDate(date)) {
      setError('Please enter a valid departure calendar date.');
      return;
    }
    if (parseClockTimeToMinutes(time) === null) {
      setError('Please enter a valid 24-hour departure time (HH:MM).');
      return;
    }
    setError(null);
    onSearch({
      sourceStopId,
      destinationStopId,
      date,
      time,
      preferredCategory,
    });
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
          {/* Source Stop Autocomplete */}
          <div className="lg:col-span-3">
            <StopAutocomplete
              id="source-stop"
              label="From (Boarding Stop)"
              selectedStopId={sourceStopId}
              stops={activeStops}
              stopMap={stopMap}
              iconColorClass="text-teal-700"
              placeholder="Search stop name or ID..."
              onSelectStop={(id) => {
                setSourceStopId(id);
                setError(null);
              }}
            />
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

          {/* Destination Stop Autocomplete */}
          <div className="lg:col-span-3">
            <StopAutocomplete
              id="dest-stop"
              label="To (Destination Stop)"
              selectedStopId={destinationStopId}
              stops={activeStops}
              stopMap={stopMap}
              iconColorClass="text-slate-600"
              placeholder="Search stop name or ID..."
              onSelectStop={(id) => {
                setDestinationStopId(id);
                setError(null);
              }}
            />
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
                onChange={(e) => {
                  setDate(e.target.value);
                  setError(null);
                }}
                className="w-full h-11 pl-9 pr-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 font-mono-tabular focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>
          </div>

          {/* Departure Time */}
          <div className="lg:col-span-1">
            <label
              htmlFor="dep-time"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              Time
            </label>
            <div className="relative">
              <Clock className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="dep-time"
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setError(null);
                }}
                className="w-full h-11 pl-8 pr-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 font-mono-tabular focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>
          </div>

          {/* Journey Preference */}
          <div className="lg:col-span-2">
            <label
              htmlFor="pref-mode"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              Priority
            </label>
            <div className="relative">
              <Compass className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                id="pref-mode"
                value={preferredCategory}
                onChange={(e) => setPreferredCategory(e.target.value as RecommendationCategory)}
                className="w-full h-11 pl-9 pr-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              >
                <option value="balanced">Balanced (Time + Comfort)</option>
                <option value="fastest">Fastest Arrival</option>
                <option value="least-crowded">Least Crowded</option>
              </select>
            </div>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
          >
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
              Supports direct, 1-transfer, and 2-transfer routes with segment-level crowding predictions.
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 h-11 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Clear
            </button>

            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 h-11 bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              <Search className="w-4 h-4" />
              Search Buses
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
