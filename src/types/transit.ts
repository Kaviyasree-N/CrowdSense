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
  hasValidCoordinates?: boolean;
}

export interface RouteStopSequence {
  stop_id: string;
  stop_sequence: number;
  minutes_from_start: number;
}

export interface GTFSScheduledStopTime {
  stop_id: string;
  stop_sequence: number;
  arrival_mins: number;
  departure_mins: number;
}

export interface GTFSScheduledTrip {
  trip_id: string;
  route_id: string;
  route_number: string;
  route_name: string;
  direction: 'UP' | 'DOWN';
  direction_label: string;
  service_id: string;
  is_ac: boolean;
  default_capacity: number;
  stop_times: GTFSScheduledStopTime[];
}

export interface GTFSServiceCalendar {
  service_id: string;
  days: [boolean, boolean, boolean, boolean, boolean, boolean, boolean]; // Sun (0) .. Sat (6)
  start_date: string; // YYYYMMDD
  end_date: string; // YYYYMMDD
}

export interface GTFSServiceCalendarsMap {
  calendars: Record<string, GTFSServiceCalendar>;
  addedDates: Record<string, string[]>; // YYYYMMDD -> service_id[]
  removedDates: Record<string, string[]>; // YYYYMMDD -> service_id[]
}

export interface BalancedWeightsConfig {
  timeWeight: number;
  crowdingWeight: number;
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

export interface RouteEvaluationBreakdown {
  routeNumber: string;
  sampleCount: number;
  baselineMae: number;
  baselineRmse: number;
  rfMae: number | null;
  rfRmse: number | null;
}

export interface TimePeriodEvaluationBreakdown {
  period: string;
  sampleCount: number;
  baselineMae: number;
  baselineRmse: number;
  rfMae: number | null;
  rfRmse: number | null;
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
  routeBreakdown?: RouteEvaluationBreakdown[];
  timePeriodBreakdown?: TimePeriodEvaluationBreakdown[];
  evaluationGroundTruthNote?: string;
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
  has_historical_data?: boolean;
  is_scheduled_time?: boolean;
  prediction_explanation?: PredictionExplanation;
}

export interface JourneyTransferDetail {
  after_leg_index: number;
  from_stop: BusStop;
  to_stop: BusStop;
  arrival_time: string;
  next_departure_time: string;
  next_route_number: string;
  wait_mins: number;
  is_walking_transfer?: boolean;
  walk_meters?: number;
  walk_mins?: number;
}

export interface JourneyLeg {
  leg_index: number;
  trip_id?: string;
  route_id: string;
  route_number: string;
  route_name: string;
  direction: 'UP' | 'DOWN';
  direction_label: string;
  is_ac: boolean;
  is_scheduled?: boolean;
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
    has_historical_data?: boolean;
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
  transfers_detail?: JourneyTransferDetail[];
  legs: JourneyLeg[];
  all_segments: JourneySegmentEstimate[];
  peak_segment_occupancy_pct: number;
  peak_crowding_level: CrowdingLevel;
  weighted_avg_occupancy_pct: number;
  overall_confidence: ConfidenceLevel;
  has_missing_predictions?: boolean;
  missing_prediction_segments_count?: number;
  low_confidence_warning?: string;
  uses_gtfs_schedule?: boolean;
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
  preferredCategory?: RecommendationCategory;
}

export type JourneySearchErrorCode =
  | 'MISSING_GTFS'
  | 'INVALID_TIME'
  | 'INVALID_DATE'
  | 'INVALID_STOPS'
  | 'SAME_STOP'
  | 'NO_SERVICE_ON_DATE'
  | 'NO_ROUTE_FOUND';

export interface JourneySearchResult {
  journeys: JourneyOption[];
  errorCode?: JourneySearchErrorCode;
  errorMessage?: string;
  graphStats?: {
    stopsCount: number;
    activeTripsCount: number;
    directedEdgesCount: number;
    walkingLinksCount: number;
  };
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
  scheduledTrips?: GTFSScheduledTrip[];
  serviceCalendars?: GTFSServiceCalendarsMap;
  serviceDaysSummary: {
    weekdayServices: number;
    weekendServices: number;
    calendarExceptions: number;
  };
  warnings: string[];
}

export interface WeeklyDemandPoint {
  weekNumber: number;
  weekLabel: string;
  dateRange: string;
  tickets: number;
  passengers: number;
  weekdayPassengers: number;
  weekendPassengers: number;
  daysObserved: number;
  avgDailyPassengers: number;
}

export interface HourlyDayTypePoint {
  hour: string;
  hourNum: number;
  weekdayTickets: number;
  weekdayPassengers: number;
  weekendTickets: number;
  weekendPassengers: number;
}

export interface CriticalHotspotRow {
  routeId: string;
  routeNumber: string;
  direction: 'UP' | 'DOWN';
  fromStop: string;
  toStop: string;
  peakHour: number;
  timePeriod: string;
  estimatedLoad: number;
  assumedCapacity: number;
  occupancyPct: number;
  crowdingLevel: CrowdingLevel;
  observationsCount: number;
  weeklyConsistencyPct: number;
  isRecurring: boolean;
  confidence: ConfidenceLevel;
}

export interface TransportPlanningInsight {
  id: string;
  category:
    | 'evening-demand'
    | 'peak-hotspot'
    | 'weekday-weekend'
    | 'low-demand'
    | 'insufficient-data';
  title: string;
  detail: string;
  metricLabel: string;
}

export interface DataReliabilitySummary {
  dataMode: DataMode;
  datasetCoverageLabel: string;
  dateRangeLabel: string;
  totalRecords: number;
  validRecords: number;
  invalidAndDuplicateCount: number;
  stopMatchingPct: number;
  matchedStopsCount: number;
  totalUniqueStopsCount: number;
  unmatchedStopsCount: number;
  unmatchedStopsSample: string[];
  identifiedTrips: number;
  ambiguousTrips: number;
  predictionCoveragePct: number;
  segmentsWithPredictions: number;
  totalSegmentsCataloged: number;
  lowConfidencePredictionsCount: number;
  lowConfidenceSharePct: number;
  recordedDemandNote: string;
  estimatedOccupancyNote: string;
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
  hourlyDayTypeDistribution?: HourlyDayTypePoint[];
  dailyDistribution: { date: string; dayLabel: string; dayType: DayType; tickets: number; passengers: number }[];
  weeklyDistribution?: WeeklyDemandPoint[];
  routeVolume: { route: string; routeNumber: string; tickets: number; passengers: number; vehicles: number }[];
  weekdayVsWeekend: {
    weekdayTickets: number;
    weekdayPassengers: number;
    weekendTickets: number;
    weekendPassengers: number;
  };
  timePeriodDemand: { period: string; tickets: number; passengers: number }[];
  matchedRoutesCount?: number;
  totalIdentifiedSegments?: number;
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

export interface WeeklyStabilityPeriodMetric {
  label: string;
  avgLoad: number;
  observationCount: number;
  stabilityPct: number;
  meanCv: number;
  reliable: boolean;
}

export interface WeeklyStabilityRouteMetric {
  routeNumber: string;
  segmentSlots: number;
  totalObservations: number;
  stabilityPct: number;
  meanCv: number;
  status: 'Consistent' | 'Moderate Variance' | 'Unstable' | 'Insufficient Data';
}

export interface WeeklyStabilitySegmentAlert {
  routeNumber: string;
  direction: 'UP' | 'DOWN';
  fromStop: string;
  toStop: string;
  hour: number;
  dayType: DayType;
  medianLoad: number;
  observationsCount: number;
  weeklyCvPct: number;
  weeklyConsistencyPct: number;
}

export interface WeeklyStabilityReport {
  periods: WeeklyStabilityPeriodMetric[];
  routeStability: WeeklyStabilityRouteMetric[];
  consistentHotspots: WeeklyStabilitySegmentAlert[];
  unstableSegments: WeeklyStabilitySegmentAlert[];
  insufficientDataRoutes: string[];
  unreliableTimePeriods: string[];
}


