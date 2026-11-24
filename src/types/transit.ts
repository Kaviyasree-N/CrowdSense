export type CrowdingLevel =
  | 'Seats Available'
  | 'Standing Room'
  | 'Crowded'
  | 'Very Crowded';

export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

export type RecommendationCategory = 'fastest' | 'least-crowded' | 'balanced';

export type DayType = 'weekday' | 'weekend';

export type SortOption = 'balanced' | 'fastest' | 'least-crowded' | 'fewest-transfers';

export interface BusStop {
  stop_id: string;
  stop_name: string;
  short_name: string;
  lat: number;
  lng: number;
  zone: string;
  is_major_hub: boolean;
}

export interface RouteStopSequence {
  stop_id: string;
  stop_sequence: number;
  minutes_from_start: number;
}

export interface BusRoute {
  route_id: string;
  route_number: string;
  route_name: string;
  direction: 'UP' | 'DOWN';
  direction_label: string;
  is_ac: boolean;
  default_capacity: number;
  frequency_mins: number;
  operating_hours: string;
  stops: RouteStopSequence[];
}

export interface ETMTicketRecord {
  created_at: string; // IST ISO or YYYY-MM-DD HH:mm:ss
  vehicle_number: string;
  route: string;
  start_stop_name: string;
  end_stop_name: string;
  passenger_count: number;
  amount: number;
  ticket_type_id: number;
  is_ac: boolean;
}

export type PredictionModelType = 'baseline-median' | 'random-forest';

export interface ConfidenceBreakdown {
  observationsCount: number;
  weeklyConsistencyPct: number;
  missingDataRatePct: number;
  stopMatchQualityPct: number;
  tripGroupingReliabilityPct: number;
}

export interface PredictionExplanation {
  modelUsed: PredictionModelType | 'fallback-missing';
  fallbackTier: 'exact_slot' | 'day_type_only' | 'segment_overall' | 'no_historical_data';
  observationsUsed: string;
  timePeriodConsidered: string;
  calculationMethod: string;
  assumptions: string[];
  confidenceReason: string;
  confidenceBreakdown: ConfidenceBreakdown;
  baselineLoad: number | null;
  randomForestLoad: number | null;
}

export interface HistoricalSegmentRecord {
  route_id: string;
  route_number: string;
  direction: 'UP' | 'DOWN';
  from_stop_id: string;
  to_stop_id: string;
  segment_order: number;
  date: string; // YYYY-MM-DD
  week_number: number; // 1..4 in October
  hour: number; // 0..23
  day_of_week: number; // 0 (Sun) .. 6 (Sat)
  day_type: DayType;
  is_ac: boolean;
  observed_load: number;
  unmatched_stop_rate: number;
  trip_grouping_reliability: number;
  missing_data_rate: number;
  is_simulated: boolean;
}

export interface ModelEvaluationMetrics {
  modelName: string;
  modelKey: PredictionModelType;
  mae: number;
  rmse: number;
  evaluatedSamples: number;
}

export interface ModelEvaluationReport {
  status: 'evaluated' | 'insufficient_data';
  reason: string;
  trainDateRange: string;
  testDateRange: string;
  trainCount: number;
  testCount: number;
  isSimulatedData: boolean;
  baselineMetrics: ModelEvaluationMetrics | null;
  randomForestMetrics: ModelEvaluationMetrics | null;
  winner: PredictionModelType | null;
}

export interface SegmentObservation {
  route_id: string;
  route_number: string;
  direction: 'UP' | 'DOWN';
  from_stop_id: string;
  to_stop_id: string;
  from_stop_name: string;
  to_stop_name: string;
  segment_order: number;
  hour: number;
  day_type: DayType;
  median_load: number;
  p75_load: number;
  boardings_avg: number;
  alightings_avg: number;
  observations_count: number;
  weekly_cv: number; // Coefficient of variation across weeks (0-1)
  unmatched_stop_rate: number; // 0-1
  trip_grouping_reliability: number; // 0-1
  missing_data_rate?: number; // 0-1
  is_simulated: boolean;
}

export interface JourneySegmentEstimate {
  segment_order: number;
  route_id: string;
  route_number: string;
  direction_label: string;
  from_stop: BusStop;
  to_stop: BusStop;
  departure_time: string;
  arrival_time: string;
  duration_mins: number;
  estimated_load: number;
  assumed_capacity: number;
  occupancy_pct: number;
  crowding_level: CrowdingLevel;
  confidence: ConfidenceLevel;
  confidence_reason: string;
  boardings_expected: number;
  alightings_expected: number;
  observations_count: number;
  prediction_explanation?: PredictionExplanation;
}

export interface JourneyLeg {
  leg_index: number;
  route_id: string;
  route_number: string;
  route_name: string;
  direction: 'UP' | 'DOWN';
  direction_label: string;
  is_ac: boolean;
  boarding_stop: BusStop;
  alighting_stop: BusStop;
  departure_time: string;
  arrival_time: string;
  duration_mins: number;
  assumed_capacity: number;
  segments: JourneySegmentEstimate[];
  intermediate_stops: {
    stop: BusStop;
    arrival_time: string;
    departure_time: string;
    cumulative_load: number;
    occupancy_pct: number;
    crowding_level: CrowdingLevel;
  }[];
}

export interface JourneyOption {
  id: string;
  source: BusStop;
  destination: BusStop;
  departure_time: string;
  arrival_time: string;
  total_duration_mins: number;
  transfers: number;
  transfer_wait_mins: number;
  transfer_stop?: BusStop;
  legs: JourneyLeg[];
  all_segments: JourneySegmentEstimate[];
  peak_segment_occupancy_pct: number;
  peak_crowding_level: CrowdingLevel;
  weighted_avg_occupancy_pct: number;
  overall_confidence: ConfidenceLevel;
  recommendation_tags: RecommendationCategory[];
  recommendation_reason: string;
  fastest_score: number;
  comfort_score: number;
  balanced_score: number;
  is_simulated: boolean;
}

export interface SearchQuery {
  sourceStopId: string;
  destinationStopId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  capacityOverride?: number;
}

export interface DataQualityReport {
  fileName: string;
  uploadedAt: string;
  totalRows: number;
  validRows: number;
  missingFieldCounts: Record<string, number>;
  invalidRecordsCount: number;
  invalidReasons: string[];
  requiredColumnsPresent: string[];
  missingRequiredColumns: string[];
  routeDistribution: { route: string; tickets: number; passengers: number }[];
  hourlyDistribution: { hour: string; tickets: number; passengers: number }[];
  acSharePct: number;
  unmatchedStopsSample: string[];
  browserTruncated: boolean;
  totalFileBytes: number;
  samplePreview: ETMTicketRecord[];
  parsedValidTickets?: ETMTicketRecord[];
}

export interface GTFSUploadSummary {
  filesDetected: string[];
  stopsCount: number;
  routesCount: number;
  tripsCount: number;
  stopTimesCount: number;
  calendarActive: boolean;
  uploadedAt: string;
}

export interface CapacityConfig {
  acCapacity: number;
  nonAcCapacity: number;
  thresholds: {
    standingRoomMin: number; // default 70
    crowdedMin: number; // default 100
    veryCrowdedMin: number; // default 120
  };
}

export type DataMode = 'demo' | 'actual';

export interface PipelineStageLog {
  stage: number;
  name: string;
  status: 'completed' | 'skipped' | 'warning' | 'error';
  durationMs: number;
  detail: string;
}

export interface StopMatchEntry {
  rawStopName: string;
  normalizedName: string;
  matchStatus: 'matched' | 'ambiguous' | 'unmatched';
  matchedStopId?: string;
  matchedStopName?: string;
  candidateCount: number;
  confidence: ConfidenceLevel;
}

export interface StopMatchingReport {
  totalUniqueTicketStops: number;
  matchedCount: number;
  ambiguousCount: number;
  unmatchedCount: number;
  matchingConfidencePct: number;
  gtfsSourceLabel: string;
  matchedSamples: StopMatchEntry[];
  ambiguousSamples: StopMatchEntry[];
  unmatchedSamples: StopMatchEntry[];
}

export interface ProcessedGTFSData {
  summary: GTFSUploadSummary;
  stops: BusStop[];
  routes: BusRoute[];
  serviceDaysSummary: {
    weekdayServices: number;
    weekendServices: number;
    calendarExceptions: number;
  };
  warnings: string[];
}

export interface ActualDatasetResult {
  datasetId: string;
  sourceName: string;
  sourceOrigin: 'url' | 'upload';
  processedAt: string;
  timezone: 'Asia/Kolkata';
  status: 'completed' | 'partial' | 'failed';
  processingEngine: 'node-streaming' | 'browser-streaming' | 'fastapi-pandas';
  totalRecords: number;
  validRecords: number;
  duplicateRecords: number;
  invalidRecords: number;
  totalPassengers: number;
  avgPassengersPerTicket: number;
  maxPassengersPerTicket: number;
  uniqueVehicles: number;
  uniqueRoutes: number;
  uniqueBoardingStops: number;
  uniqueDestinationStops: number;
  acSharePct: number;
  dateRangeIST: { start: string; end: string };
  missingFieldCounts: Record<string, number>;
  invalidReasons: string[];
  requiredColumnsPresent: string[];
  missingRequiredColumns: string[];
  hourlyDistribution: { hour: string; hourNum: number; tickets: number; passengers: number }[];
  dailyDistribution: { date: string; dayLabel: string; dayType: DayType; tickets: number; passengers: number }[];
  routeVolume: { route: string; routeNumber: string; tickets: number; passengers: number; vehicles: number }[];
  weekdayVsWeekend: {
    weekdayTickets: number;
    weekdayPassengers: number;
    weekendTickets: number;
    weekendPassengers: number;
  };
  timePeriodDemand: { period: string; tickets: number; passengers: number }[];
  stopMatchingReport: StopMatchingReport;
  pipelineLogs: PipelineStageLog[];
  reconstructedTripsCount: number;
  ambiguousTripsCount: number;
  historicalSegmentRecords: HistoricalSegmentRecord[];
  aggregatedObservations: SegmentObservation[];
  evaluationReport: ModelEvaluationReport;
  sampleRows: ETMTicketRecord[];
  activeRoutes: BusRoute[];
  activeStops: BusStop[];
  truncatedForBrowser: boolean;
}

