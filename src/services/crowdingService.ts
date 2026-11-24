import {
  BusRoute,
  BusStop,
  CapacityConfig,
  DataMode,
  DayType,
  HistoricalSegmentRecord,
  JourneySegmentEstimate,
  PredictionModelType,
  SegmentObservation,
} from '../types/transit';
import {
  SAMPLE_HISTORICAL_RECORDS,
  SAMPLE_OBSERVATIONS,
} from '../data/samplePredictions';
import { STOP_MAP } from '../data/sampleStops';
import { DEFAULT_CAPACITY_CONFIG } from '../utils/crowdClassification';
import {
  predictSegmentCrowding,
  TrainedBaselineModel,
  TrainedRandomForestModel,
  trainBaselineMedianModel,
  trainRandomForestModel,
} from '../engine/predictionEngine';

export function getDayTypeFromDate(dateStr: string): DayType {
  const parsed = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'weekday';
  const day = parsed.getDay();
  return day === 0 || day === 6 ? 'weekend' : 'weekday';
}

export function getDayOfWeekFromDate(dateStr: string): number {
  const parsed = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return 3; // Wednesday default
  return parsed.getDay();
}

export function addMinutesToTime(baseTime: string, minutesToAdd: number): string {
  const [hStr, mStr] = baseTime.split(':');
  const startTotal = Number(hStr) * 60 + Number(mStr);
  const total = (startTotal + minutesToAdd) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatDisplayTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${suffix}`;
}

// Train demo models once lazily from the multi-week October 2026 records
let cachedDemoBaseline: TrainedBaselineModel | null = null;
let cachedDemoRf: TrainedRandomForestModel | null = null;

// Actual uploaded dataset models & lookup (never mixed with demo models)
let uploadedBaseline: TrainedBaselineModel | null = null;
let uploadedRf: TrainedRandomForestModel | null = null;
let uploadedObservations: SegmentObservation[] = [];
let uploadedStopMap: Record<string, BusStop> = {};

function ensureDemoModels() {
  if (!cachedDemoBaseline) {
    cachedDemoBaseline = trainBaselineMedianModel(
      SAMPLE_HISTORICAL_RECORDS,
      SAMPLE_OBSERVATIONS
    );
  }
  if (!cachedDemoRf) {
    cachedDemoRf = trainRandomForestModel(SAMPLE_HISTORICAL_RECORDS);
  }
  return { baseline: cachedDemoBaseline, rf: cachedDemoRf };
}

export const crowdingService = {
  setUploadedTrainingRecords(
    records: HistoricalSegmentRecord[] | null,
    observations: SegmentObservation[] = [],
    stops: BusStop[] = []
  ) {
    if (!records || records.length === 0) {
      uploadedBaseline = null;
      uploadedRf = null;
      uploadedObservations = [];
      uploadedStopMap = {};
      return;
    }
    uploadedBaseline = trainBaselineMedianModel(records, observations);
    uploadedRf = trainRandomForestModel(records);
    uploadedObservations = observations;
    uploadedStopMap = {};
    stops.forEach((s) => {
      uploadedStopMap[s.stop_id] = s;
    });
  },

  hasUploadedTrainedModel(): boolean {
    return uploadedBaseline !== null;
  },

  getModels(dataMode: DataMode = 'demo') {
    if (dataMode === 'actual') {
      return {
        baseline:
          uploadedBaseline ??
          trainBaselineMedianModel([], []),
        rf: uploadedRf,
        isSimulated: false,
      };
    }
    const demo = ensureDemoModels();
    return {
      baseline: demo.baseline,
      rf: demo.rf,
      isSimulated: true,
    };
  },

  getObservation(
    routeId: string,
    fromStopId: string,
    toStopId: string,
    hour: number,
    dayType: DayType,
    dataMode: DataMode = 'demo'
  ): SegmentObservation | undefined {
    const clampedHour = Math.max(0, Math.min(23, hour));
    const source = dataMode === 'actual' ? uploadedObservations : SAMPLE_OBSERVATIONS;
    return source.find(
      (o) =>
        o.route_id === routeId &&
        o.from_stop_id === fromStopId &&
        o.to_stop_id === toStopId &&
        o.hour === clampedHour &&
        o.day_type === dayType
    );
  },

  getAllObservationsForHour(
    hour: number,
    dayType: DayType,
    dataMode: DataMode = 'demo'
  ): SegmentObservation[] {
    const clampedHour = Math.max(0, Math.min(23, hour));
    const source = dataMode === 'actual' ? uploadedObservations : SAMPLE_OBSERVATIONS;
    return source.filter((o) => o.hour === clampedHour && o.day_type === dayType);
  },

  estimateSegment(
    route: BusRoute,
    fromStopId: string,
    toStopId: string,
    departureTime: string,
    durationMins: number,
    dayType: DayType,
    capacityConfig: CapacityConfig = DEFAULT_CAPACITY_CONFIG,
    segmentOrder: number,
    dayOfWeek = dayType === 'weekend' ? 6 : 3,
    preferredModel: PredictionModelType = 'baseline-median',
    dataMode: DataMode = 'demo',
    customStopLookup?: Record<string, BusStop>
  ): JourneySegmentEstimate {
    const stopLookup =
      dataMode === 'actual'
        ? customStopLookup ?? uploadedStopMap
        : STOP_MAP;
    const fromStop: BusStop = stopLookup[fromStopId] ?? {
      stop_id: fromStopId,
      stop_name: fromStopId,
      short_name: fromStopId,
      lat: 28.6289,
      lng: 77.2195,
      zone: 'GTFS Stop',
      is_major_hub: false,
    };
    const toStop: BusStop = stopLookup[toStopId] ?? {
      stop_id: toStopId,
      stop_name: toStopId,
      short_name: toStopId,
      lat: 28.6289,
      lng: 77.2195,
      zone: 'GTFS Stop',
      is_major_hub: false,
    };

    const hour = Number(departureTime.split(':')[0]) || 18;
    const obs = this.getObservation(route.route_id, fromStopId, toStopId, hour, dayType, dataMode);

    const { baseline, rf } = this.getModels(dataMode);

    const prediction = predictSegmentCrowding(
      {
        routeId: route.route_id,
        routeNumber: route.route_number,
        direction: route.direction,
        fromStopId,
        toStopId,
        fromStopName: fromStop.stop_name,
        toStopName: toStop.stop_name,
        segmentOrder,
        hour,
        dayOfWeek,
        dayType,
        isAc: route.is_ac,
      },
      baseline,
      rf,
      preferredModel,
      capacityConfig
    );

    return {
      segment_order: segmentOrder,
      route_id: route.route_id,
      route_number: route.route_number,
      direction_label: route.direction_label,
      from_stop: fromStop,
      to_stop: toStop,
      departure_time: departureTime,
      arrival_time: addMinutesToTime(departureTime, durationMins),
      duration_mins: durationMins,
      estimated_load: prediction.predictedLoad,
      assumed_capacity: prediction.assumedCapacity,
      occupancy_pct: prediction.occupancyPct,
      crowding_level: prediction.crowdingLevel,
      confidence: prediction.confidence,
      confidence_reason: prediction.confidenceReason,
      boardings_expected: obs?.boardings_avg ?? Math.round(prediction.predictedLoad * 0.28),
      alightings_expected: obs?.alightings_avg ?? Math.round(prediction.predictedLoad * 0.24),
      observations_count: prediction.observationsCount,
      prediction_explanation: prediction.explanation,
    };
  },
};
