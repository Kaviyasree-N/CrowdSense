import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { hasRealCoordinates } from '../engine/journeyGraph';
import type {
  BusStop,
  CrowdingLevel,
  JourneyOption,
  JourneySegmentEstimate,
  PredictionExplanation,
} from '../types/transit';
import { getCrowdingStyle } from '../utils/crowdClassification';

export function getJourneySegmentKey(seg: JourneySegmentEstimate): string {
  return `${seg.route_id}-${seg.from_stop.stop_id}-${seg.to_stop.stop_id}-${seg.segment_order}`;
}

export interface NetworkMapSegment {
  id: string;
  routeId: string;
  routeNumber: string;
  direction: 'UP' | 'DOWN';
  directionLabel: string;
  fromStop: BusStop;
  toStop: BusStop;
  estimatedLoad: number;
  assumedCapacity: number;
  occupancyPct: number;
  crowdingLevel: CrowdingLevel;
  confidence: 'High' | 'Medium' | 'Low';
  observationsCount: number;
  hasHistoricalData?: boolean;
  predictionExplanation?: PredictionExplanation;
}

interface RouteMapProps {
  mode: 'journey' | 'network';
  journey?: JourneyOption;
  networkSegments?: NetworkMapSegment[];
  stops?: BusStop[];
  selectedSegmentId?: string | null;
  selectedJourneySegmentKey?: string | null;
  selectedStopId?: string | null;
  onSelectSegment?: (segment: NetworkMapSegment) => void;
  onSelectJourneySegment?: (segment: JourneySegmentEstimate) => void;
  onSelectStop?: (stop: BusStop) => void;
  heightClass?: string;
}

export function RouteMap({
  mode,
  journey,
  networkSegments = [],
  stops = [],
  selectedSegmentId,
  selectedJourneySegmentKey,
  selectedStopId,
  onSelectSegment,
  onSelectJourneySegment,
  onSelectStop,
  heightClass = 'h-[420px]',
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const [omittedCoordCount, setOmittedCoordCount] = useState(0);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [28.6289, 77.2195],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // Re-render segments and stops whenever data or selection changes
  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    const boundsPoints: L.LatLngExpression[] = [];
    let skippedCoords = 0;

    if (mode === 'journey' && journey) {
      journey.all_segments.forEach((seg) => {
        if (!hasRealCoordinates(seg.from_stop) || !hasRealCoordinates(seg.to_stop)) {
          skippedCoords += 1;
          return;
        }
        const missing = seg.has_historical_data === false;
        const style = getCrowdingStyle(seg.crowding_level);
        const segKey = getJourneySegmentKey(seg);
        const isSelected = selectedJourneySegmentKey === segKey;

        const latlngs: L.LatLngExpression[] = [
          [seg.from_stop.lat, seg.from_stop.lng],
          [seg.to_stop.lat, seg.to_stop.lng],
        ];
        boundsPoints.push(...latlngs);

        if (isSelected) {
          L.polyline(latlngs, {
            color: '#0F172A',
            weight: 10,
            opacity: 0.65,
          }).addTo(group);
        }

        const polyline = L.polyline(latlngs, {
          color: missing ? '#94A3B8' : style.hex,
          weight: isSelected ? 7 : 6,
          opacity: isSelected ? 1 : 0.9,
        }).addTo(group);

        polyline.bindTooltip(
          missing
            ? `Route ${seg.route_number}: ${seg.from_stop.short_name} → ${seg.to_stop.short_name}<br/><strong>Insufficient Data</strong> · Click to inspect`
            : `Route ${seg.route_number}: ${seg.from_stop.short_name} → ${seg.to_stop.short_name}<br/><strong>${seg.crowding_level}</strong> (${seg.occupancy_pct}% · ${seg.estimated_load}/${seg.assumed_capacity} pax) · Click to inspect`,
          { sticky: true }
        );

        polyline.on('click', () => {
          onSelectJourneySegment?.(seg);
        });
      });

      // Draw dashed walking connections if any transfer uses a short walk
      (journey.transfers_detail ?? []).forEach((t) => {
        if (
          t.is_walking_transfer &&
          hasRealCoordinates(t.from_stop) &&
          hasRealCoordinates(t.to_stop)
        ) {
          const walkLine = L.polyline(
            [
              [t.from_stop.lat, t.from_stop.lng],
              [t.to_stop.lat, t.to_stop.lng],
            ],
            {
              color: '#0F766E',
              weight: 4,
              dashArray: '6 6',
              opacity: 0.9,
            }
          ).addTo(group);
          walkLine.bindTooltip(
            `Walk transfer: ${t.from_stop.short_name} → ${t.to_stop.short_name} (${t.walk_meters}m, ~${t.walk_mins} min)`,
            { sticky: true }
          );
        }
      });

      // Add stop markers for boarding, intermediate, transfer, and destination
      const uniqueStops = new Map<
        string,
        { stop: BusStop; role: string; kind: 'terminal' | 'transfer' | 'intermediate' }
      >();

      journey.legs.forEach((leg, lIdx) => {
        const boardKind = lIdx === 0 ? 'terminal' : 'transfer';
        uniqueStops.set(leg.boarding_stop.stop_id, {
          stop: leg.boarding_stop,
          role:
            lIdx === 0
              ? `Boarding Stop (Route ${leg.route_number})`
              : `Transfer Board (Route ${leg.route_number})`,
          kind: boardKind,
        });

        leg.intermediate_stops.forEach((inter) => {
          if (!uniqueStops.has(inter.stop.stop_id)) {
            uniqueStops.set(inter.stop.stop_id, {
              stop: inter.stop,
              role:
                inter.has_historical_data === false
                  ? 'Intermediate · Insufficient historical data'
                  : `Intermediate · ${inter.occupancy_pct}% (${inter.crowding_level})`,
              kind: 'intermediate',
            });
          }
        });

        const isFinal = lIdx === journey.legs.length - 1;
        uniqueStops.set(leg.alighting_stop.stop_id, {
          stop: leg.alighting_stop,
          role: isFinal ? 'Destination Stop' : `Transfer Alight (Wait at hub)`,
          kind: isFinal ? 'terminal' : 'transfer',
        });
      });

      uniqueStops.forEach(({ stop, role, kind }) => {
        if (!hasRealCoordinates(stop)) {
          skippedCoords += 1;
          return;
        }
        boundsPoints.push([stop.lat, stop.lng]);

        const marker = L.circleMarker([stop.lat, stop.lng], {
          radius: kind === 'terminal' ? 8.5 : kind === 'transfer' ? 7.5 : 5.5,
          fillColor:
            kind === 'terminal' ? '#0F172A' : kind === 'transfer' ? '#0F766E' : '#FFFFFF',
          color: '#0F172A',
          weight: 2.5,
          fillOpacity: 1,
        }).addTo(group);

        marker.bindPopup(
          `<div style="font-size:12px;"><strong>${stop.stop_name}</strong> (${stop.stop_id})<br/><span style="color:#475569;">${role}</span></div>`
        );
      });

      if (boundsPoints.length > 1) {
        map.fitBounds(L.latLngBounds(boundsPoints), { padding: [36, 36] });
      }
    } else if (mode === 'network') {
      networkSegments.forEach((seg, idx) => {
        if (!hasRealCoordinates(seg.fromStop) || !hasRealCoordinates(seg.toStop)) {
          skippedCoords += 1;
          return;
        }
        const style = getCrowdingStyle(seg.crowdingLevel);
        const isSelected = selectedSegmentId === seg.id;

        const offset = ((idx % 3) - 1) * 0.0011;
        const latlngs: L.LatLngExpression[] = [
          [seg.fromStop.lat + offset, seg.fromStop.lng + offset],
          [seg.toStop.lat + offset, seg.toStop.lng + offset],
        ];
        boundsPoints.push(latlngs[0], latlngs[1]);

        const polyline = L.polyline(latlngs, {
          color: seg.hasHistoricalData === false ? '#94A3B8' : style.hex,
          weight: isSelected ? 8 : 5,
          opacity: isSelected ? 1 : 0.8,
        }).addTo(group);

        polyline.bindTooltip(
          seg.hasHistoricalData === false
            ? `Route ${seg.routeNumber} (${seg.direction}): ${seg.fromStop.short_name} → ${seg.toStop.short_name}<br/><strong>Insufficient historical data</strong>`
            : `Route ${seg.routeNumber} (${seg.direction}): ${seg.fromStop.short_name} → ${seg.toStop.short_name}<br/><strong>${seg.crowdingLevel}</strong> · ${seg.occupancyPct}% predicted`,
          { sticky: true }
        );

        polyline.on('click', () => {
          onSelectSegment?.(seg);
        });
      });

      stops.forEach((stop) => {
        if (!hasRealCoordinates(stop)) {
          skippedCoords += 1;
          return;
        }
        const isSelected = selectedStopId === stop.stop_id;
        const marker = L.circleMarker([stop.lat, stop.lng], {
          radius: isSelected ? 8 : stop.is_major_hub ? 6 : 4.5,
          fillColor: isSelected ? '#0F766E' : '#FFFFFF',
          color: isSelected ? '#0F172A' : '#1E293B',
          weight: isSelected ? 3 : 2,
          fillOpacity: 1,
        }).addTo(group);

        marker.bindTooltip(`${stop.stop_name} (${stop.zone})`, {
          direction: 'top',
        });

        marker.on('click', () => {
          onSelectStop?.(stop);
        });
      });
      if (boundsPoints.length > 1) {
        map.fitBounds(L.latLngBounds(boundsPoints), { padding: [32, 32], maxZoom: 14 });
      }
    }

    setOmittedCoordCount(skippedCoords);
  }, [
    mode,
    journey,
    networkSegments,
    stops,
    selectedSegmentId,
    selectedJourneySegmentKey,
    selectedStopId,
    onSelectSegment,
    onSelectJourneySegment,
    onSelectStop,
  ]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
      <div ref={containerRef} className={`w-full ${heightClass}`} />
      <div className="bg-white/95 backdrop-blur border-t border-slate-200 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-slate-800">Segment Crowding Legend:</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-1.5 rounded-sm bg-emerald-600 inline-block" />
            Seats Available (&lt;70%)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-1.5 rounded-sm bg-amber-500 inline-block" />
            Standing Room (70–99%)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-1.5 rounded-sm bg-orange-500 inline-block" />
            Crowded (100–119%)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-1.5 rounded-sm bg-red-600 inline-block" />
            Very Crowded (120%+)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-1.5 rounded-sm bg-slate-400 inline-block" />
            Insufficient Data
          </span>
        </div>
        <span className="font-mono-tabular text-slate-500">
          {omittedCoordCount > 0
            ? `${omittedCoordCount} stop/segment omitted (missing GTFS coords)`
            : 'Historical / Predicted Estimates · OSM Tiles'}
        </span>
      </div>
    </div>
  );
}
