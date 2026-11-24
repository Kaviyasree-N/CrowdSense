import { DayType, ETMTicketRecord, HistoricalSegmentRecord, SegmentObservation } from '../types/transit';
import { SAMPLE_ROUTES } from './sampleRoutes';
import { STOP_MAP } from './sampleStops';

/**
 * Deterministic pseudo-random generator so simulated October 2026 ETM records
 * and segment observations are stable and reproducible across reloads.
 */
function seededValue(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/**
 * Realistic sample ETM / E-Ticketing rows following the exact October 1–31, 2026 schema:
 * created_at, vehicle_number, route, start_stop_name, end_stop_name, passenger_count, amount, ticket_type_id, is_ac
 */
export const SAMPLE_ETM_TICKETS: ETMTicketRecord[] = [
  {
    created_at: '2026-10-14 18:02:14',
    vehicle_number: 'DL1PD4821',
    route: '39',
    start_stop_name: 'Anand Vihar ISBT',
    end_stop_name: 'ITO Crossing',
    passenger_count: 2,
    amount: 30,
    ticket_type_id: 1,
    is_ac: false,
  },
  {
    created_at: '2026-10-14 18:03:09',
    vehicle_number: 'DL1PD4821',
    route: '39',
    start_stop_name: 'Anand Vihar ISBT',
    end_stop_name: 'Connaught Place (Shivaji Stadium)',
    passenger_count: 1,
    amount: 15,
    ticket_type_id: 1,
    is_ac: false,
  },
  {
    created_at: '2026-10-14 18:10:42',
    vehicle_number: 'DL1PD4821',
    route: '39',
    start_stop_name: 'Preet Vihar',
    end_stop_name: 'Mandi House',
    passenger_count: 3,
    amount: 45,
    ticket_type_id: 2,
    is_ac: false,
  },
  {
    created_at: '2026-10-14 18:16:51',
    vehicle_number: 'DL1PD4821',
    route: '39',
    start_stop_name: 'Laxmi Nagar',
    end_stop_name: 'Rajiv Chowk Metro Gate',
    passenger_count: 4,
    amount: 60,
    ticket_type_id: 1,
    is_ac: false,
  },
  {
    created_at: '2026-10-14 18:18:05',
    vehicle_number: 'DL1PD4821',
    route: '39',
    start_stop_name: 'Laxmi Nagar',
    end_stop_name: 'Karol Bagh',
    passenger_count: 2,
    amount: 40,
    ticket_type_id: 1,
    is_ac: false,
  },
  {
    created_at: '2026-10-14 18:05:19',
    vehicle_number: 'DL1PC9104',
    route: '85A',
    start_stop_name: 'Anand Vihar ISBT',
    end_stop_name: 'Connaught Place (Shivaji Stadium)',
    passenger_count: 2,
    amount: 50,
    ticket_type_id: 1,
    is_ac: true,
  },
  {
    created_at: '2026-10-14 18:12:33',
    vehicle_number: 'DL1PC9104',
    route: '85A',
    start_stop_name: 'Preet Vihar',
    end_stop_name: 'India Gate Circle',
    passenger_count: 1,
    amount: 25,
    ticket_type_id: 3,
    is_ac: true,
  },
  {
    created_at: '2026-10-14 18:08:47',
    vehicle_number: 'DL1PC7712',
    route: '410',
    start_stop_name: 'Anand Vihar ISBT',
    end_stop_name: 'Kashmere Gate ISBT',
    passenger_count: 2,
    amount: 30,
    ticket_type_id: 1,
    is_ac: true,
  },
  {
    created_at: '2026-10-14 18:31:22',
    vehicle_number: 'DL1PC7712',
    route: '410',
    start_stop_name: 'Kashmere Gate ISBT',
    end_stop_name: 'Connaught Place (Shivaji Stadium)',
    passenger_count: 1,
    amount: 20,
    ticket_type_id: 1,
    is_ac: true,
  },
  {
    created_at: '2026-10-14 09:14:02',
    vehicle_number: 'DL1PC3309',
    route: '761',
    start_stop_name: 'Dwarka Sector 21',
    end_stop_name: 'Karol Bagh',
    passenger_count: 2,
    amount: 50,
    ticket_type_id: 1,
    is_ac: true,
  },
  {
    created_at: '2026-10-14 09:42:18',
    vehicle_number: 'DL1PC3309',
    route: '761',
    start_stop_name: 'Rajouri Garden',
    end_stop_name: 'Connaught Place (Shivaji Stadium)',
    passenger_count: 3,
    amount: 75,
    ticket_type_id: 2,
    is_ac: true,
  },
  {
    created_at: '2026-10-15 17:45:11',
    vehicle_number: 'DL1PD6192',
    route: '534',
    start_stop_name: 'Laxmi Nagar',
    end_stop_name: 'Lajpat Nagar',
    passenger_count: 2,
    amount: 30,
    ticket_type_id: 1,
    is_ac: false,
  },
  {
    created_at: '2026-10-15 17:58:09',
    vehicle_number: 'DL1PD6192',
    route: '534',
    start_stop_name: 'India Gate Circle',
    end_stop_name: 'AIIMS Trauma & Metro',
    passenger_count: 1,
    amount: 15,
    ticket_type_id: 1,
    is_ac: false,
  },
  {
    created_at: '2026-10-17 13:20:44',
    vehicle_number: 'DL1PC5288',
    route: '623',
    start_stop_name: 'AIIMS Trauma & Metro',
    end_stop_name: 'Connaught Place (Shivaji Stadium)',
    passenger_count: 2,
    amount: 40,
    ticket_type_id: 1,
    is_ac: true,
  },
  {
    created_at: '2026-10-18 16:05:30',
    vehicle_number: 'DL1PD1905',
    route: '901',
    start_stop_name: 'Rohini Sector 18',
    end_stop_name: 'Kashmere Gate ISBT',
    passenger_count: 3,
    amount: 45,
    ticket_type_id: 1,
    is_ac: false,
  },
];

/**
 * Generates baseline historical segment observations for hours 5..23 across
 * weekday and weekend patterns for all prototype routes.
 * Carefully calibrated so Anand Vihar -> CP at Weekday 18:00 showcases:
 * - Route 39: Fastest (38m), Very Crowded bottleneck on Laxmi Nagar -> ITO -> Mandi House (~118%-134%)
 * - Route 85A: Balanced (45m), Standing Room / low Crowded (~78%-93%)
 * - Route 410: Least Crowded (52m), Seats Available (~49%-64%)
 */
function buildSampleObservations(): SegmentObservation[] {
  const observations: SegmentObservation[] = [];
  const hours = Array.from({ length: 19 }, (_, idx) => idx + 5); // 05:00 to 23:00
  const dayTypes: DayType[] = ['weekday', 'weekend'];

  SAMPLE_ROUTES.forEach((route, rIdx) => {
    for (let sIdx = 0; sIdx < route.stops.length - 1; sIdx++) {
      const fromSeq = route.stops[sIdx];
      const toSeq = route.stops[sIdx + 1];
      const fromStop = STOP_MAP[fromSeq.stop_id];
      const toStop = STOP_MAP[toSeq.stop_id];
      if (!fromStop || !toStop) continue;

      const segmentMidRatio = (sIdx + 0.5) / (route.stops.length - 1);
      // Bell-shaped corridor profile peaking near central hubs
      const corridorShape = 0.68 + 0.55 * Math.sin(segmentMidRatio * Math.PI);

      dayTypes.forEach((dayType) => {
        hours.forEach((hour) => {
          let timeFactor = 0.45;
          if (dayType === 'weekday') {
            if (hour >= 8 && hour <= 10) timeFactor = 1.08;
            else if (hour >= 11 && hour <= 15) timeFactor = 0.62;
            else if (hour >= 16 && hour <= 19) timeFactor = 1.15;
            else if (hour >= 20 && hour <= 21) timeFactor = 0.72;
            else timeFactor = 0.38;
          } else {
            // Weekend shopping / leisure peak midday to evening
            if (hour >= 11 && hour <= 14) timeFactor = 0.76;
            else if (hour >= 16 && hour <= 20) timeFactor = 0.88;
            else timeFactor = 0.42;
          }

          // Route-specific realism calibration
          let routeIntensity = 1.0;
          if (route.route_id === 'R39_UP') routeIntensity = 1.24;
          else if (route.route_id === 'R39_DN') routeIntensity = 1.14;
          else if (route.route_id === 'R534_UP' || route.route_id === 'R534_DN') routeIntensity = 1.08;
          else if (route.route_id === 'R85A_UP' || route.route_id === 'R85A_DN') routeIntensity = 0.78;
          else if (route.route_id === 'R410_UP' || route.route_id === 'R410_DN') routeIntensity = 0.56;
          else if (route.route_id === 'R761_UP') routeIntensity = 1.02;
          else if (route.route_id === 'R901_UP') routeIntensity = 0.94;
          else if (route.route_id === 'R623_UP' || route.route_id === 'R623_DN') routeIntensity = 0.82;

          const noise = (seededValue(rIdx * 1000 + sIdx * 100 + hour * 7 + (dayType === 'weekday' ? 1 : 2)) - 0.5) * 0.14;
          let load = Math.round(route.default_capacity * corridorShape * timeFactor * routeIntensity * (1 + noise));

          // Explicit realistic tuning for evening 18:00 weekday Anand Vihar -> CP options
          if (dayType === 'weekday' && hour === 18) {
            if (route.route_id === 'R39_UP') {
              const profile39 = [34, 46, 59, 67, 56, 44, 32];
              load = profile39[sIdx] ?? load;
            } else if (route.route_id === 'R85A_UP') {
              const profile85 = [24, 33, 39, 42, 41, 35, 28];
              load = profile85[sIdx] ?? load;
            } else if (route.route_id === 'R410_UP') {
              const profile410 = [21, 29, 27, 25, 22];
              load = profile410[sIdx] ?? load;
            }
          }

          load = Math.max(6, Math.min(82, load));
          const p75 = Math.round(load * 1.14);

          // Simulate varied historical sample depth & consistency for honest Confidence levels
          const baseObs =
            route.route_number === '410' && hour >= 20
              ? 9
              : route.route_number === '901' && dayType === 'weekend'
              ? 18
              : 42 + Math.round(seededValue(rIdx * 31 + sIdx * 13 + hour) * 38);

          const weeklyCv =
            route.route_number === '410' && hour >= 20
              ? 0.34
              : route.route_number === '901' && dayType === 'weekend'
              ? 0.24
              : 0.08 + seededValue(rIdx * 17 + hour) * 0.11;

          const unmatchedRate = route.route_number === '429' ? 0.09 : 0.02 + seededValue(sIdx + rIdx) * 0.03;
          const tripReliability = route.route_number === '901' ? 0.76 : 0.88 + seededValue(hour + rIdx) * 0.1;

          const boardingsAvg = Math.max(3, Math.round(load * 0.32));
          const alightingsAvg = Math.max(2, Math.round(load * 0.28));

          observations.push({
            route_id: route.route_id,
            route_number: route.route_number,
            direction: route.direction,
            from_stop_id: fromStop.stop_id,
            to_stop_id: toStop.stop_id,
            from_stop_name: fromStop.stop_name,
            to_stop_name: toStop.stop_name,
            segment_order: sIdx + 1,
            hour,
            day_type: dayType,
            median_load: load,
            p75_load: p75,
            boardings_avg: boardingsAvg,
            alightings_avg: alightingsAvg,
            observations_count: baseObs,
            weekly_cv: Number(weeklyCv.toFixed(2)),
            unmatched_stop_rate: Number(unmatchedRate.toFixed(2)),
            trip_grouping_reliability: Number(tripReliability.toFixed(2)),
            is_simulated: true,
          });
        });
      });
    }
  });

  return observations;
}

export const SAMPLE_OBSERVATIONS: SegmentObservation[] = buildSampleObservations();

/**
 * Simulated October 1–31, 2026 daily ticketing aggregate series for Operator Analytics.
 */
export interface DailyTicketTrend {
  date: string;
  dayLabel: string;
  dayType: DayType;
  ticketsAnalyzed: number;
  estimatedPassengers: number;
  avgOccupancyPct: number;
}

export const SAMPLE_OCTOBER_DAILY_TRENDS: DailyTicketTrend[] = Array.from({ length: 31 }, (_, i) => {
  const day = i + 1;
  const dateStr = `2026-10-${String(day).padStart(2, '0')}`;
  // 2026-10-01 is a Thursday (dayOfWeek = 4)
  const dow = new Date(2026, 9, day).getDay();
  const isWeekend = dow === 0 || dow === 6;
  const baseTickets = isWeekend ? 41200 : 62800;
  const variance = Math.round((seededValue(day * 19) - 0.5) * 6400);
  const tickets = baseTickets + variance;
  const passengers = Math.round(tickets * 1.18);
  const avgOcc = isWeekend ? 64 + Math.round(seededValue(day * 5) * 9) : 81 + Math.round(seededValue(day * 5) * 11);

  return {
    date: dateStr,
    dayLabel: `Oct ${day}`,
    dayType: isWeekend ? 'weekend' : 'weekday',
    ticketsAnalyzed: tickets,
    estimatedPassengers: passengers,
    avgOccupancyPct: avgOcc,
  };
});

/**
 * Generates multi-week (Weeks 1–4 of October 2026) trip-level segment records
 * from the prototype corridor profiles so Baseline Median and Random Forest models
 * can be trained on Weeks 1–3 and evaluated chronologically on Week 4.
 * Clearly marked is_simulated: true.
 */
function buildSampleHistoricalRecords(): HistoricalSegmentRecord[] {
  const records: HistoricalSegmentRecord[] = [];
  // Representative dates across Weeks 1..4 of October 2026 (including weekdays & weekends)
  // Oct 1 = Thu (4), Oct 3 = Sat (6), Oct 7 = Wed (3), Oct 10 = Sat (6),
  // Oct 14 = Wed (3), Oct 17 = Sat (6), Oct 21 = Wed (3), Oct 24 = Sat (6), Oct 28 = Wed (3), Oct 31 = Sat (6)
  const sampleDays = [
    { day: 1, week: 1 },
    { day: 3, week: 1 },
    { day: 5, week: 1 },
    { day: 7, week: 1 },
    { day: 8, week: 2 },
    { day: 10, week: 2 },
    { day: 12, week: 2 },
    { day: 14, week: 2 },
    { day: 15, week: 3 },
    { day: 17, week: 3 },
    { day: 19, week: 3 },
    { day: 21, week: 3 },
    { day: 22, week: 4 },
    { day: 24, week: 4 },
    { day: 26, week: 4 },
    { day: 28, week: 4 },
    { day: 30, week: 4 },
    { day: 31, week: 4 },
  ];

  const routeMeta = new Map(SAMPLE_ROUTES.map((r) => [r.route_id, r]));

  SAMPLE_OBSERVATIONS.forEach((obs, obsIdx) => {
    // Sample every 2nd hour for compact deterministic training/eval footprint (5,7,9,11,13,15,17,18,19,21,23)
    if (obs.hour % 2 === 0 && obs.hour !== 18) return;

    const route = routeMeta.get(obs.route_id);
    if (!route) return;

    sampleDays.forEach(({ day, week }, dIdx) => {
      const dateObj = new Date(2026, 9, day);
      const dow = dateObj.getDay();
      const dayType: DayType = dow === 0 || dow === 6 ? 'weekend' : 'weekday';
      if (dayType !== obs.day_type) return;

      const jitter = (seededValue(obsIdx * 41 + day * 13 + dIdx) - 0.5) * obs.weekly_cv * 1.4;
      const observedLoad = Math.max(2, Math.round(obs.median_load * (1 + jitter)));

      records.push({
        route_id: obs.route_id,
        route_number: obs.route_number,
        direction: obs.direction,
        from_stop_id: obs.from_stop_id,
        to_stop_id: obs.to_stop_id,
        segment_order: obs.segment_order,
        date: `2026-10-${String(day).padStart(2, '0')}`,
        week_number: week,
        hour: obs.hour,
        day_of_week: dow,
        day_type: dayType,
        is_ac: route.is_ac,
        observed_load: observedLoad,
        unmatched_stop_rate: obs.unmatched_stop_rate,
        trip_grouping_reliability: obs.trip_grouping_reliability,
        missing_data_rate: Number((obs.unmatched_stop_rate * 0.6).toFixed(2)),
        is_simulated: true,
      });
    });
  });

  return records;
}

export const SAMPLE_HISTORICAL_RECORDS: HistoricalSegmentRecord[] = buildSampleHistoricalRecords();

