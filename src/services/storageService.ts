import { CapacityConfig, DataQualityReport, GTFSUploadSummary, SearchQuery } from '../types/transit';
import { DEFAULT_CAPACITY_CONFIG } from '../utils/crowdClassification';

const KEYS = {
  CAPACITY: 'crowdsense_capacity_config_v1',
  CSV_REPORT: 'crowdsense_csv_report_v1',
  GTFS_SUMMARY: 'crowdsense_gtfs_summary_v1',
  LAST_SEARCH: 'crowdsense_last_search_v1',
};

export const DEFAULT_SEARCH_QUERY: SearchQuery = {
  sourceStopId: 'DL_ANV', // Anand Vihar ISBT
  destinationStopId: 'DL_CP', // Connaught Place
  date: '2026-10-14', // Wednesday (Weekday)
  time: '18:00', // 6:00 PM peak demo
};

/**
 * Storage abstraction structured to swap seamlessly to a FastAPI + PostgreSQL/PostGIS backend.
 */
export const storageService = {
  getCapacityConfig(): CapacityConfig {
    try {
      const raw = localStorage.getItem(KEYS.CAPACITY);
      if (!raw) return DEFAULT_CAPACITY_CONFIG;
      return { ...DEFAULT_CAPACITY_CONFIG, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_CAPACITY_CONFIG;
    }
  },

  saveCapacityConfig(config: CapacityConfig): void {
    localStorage.setItem(KEYS.CAPACITY, JSON.stringify(config));
  },

  getCsvReport(): DataQualityReport | null {
    try {
      const raw = localStorage.getItem(KEYS.CSV_REPORT);
      return raw ? (JSON.parse(raw) as DataQualityReport) : null;
    } catch {
      return null;
    }
  },

  saveCsvReport(report: DataQualityReport): void {
    localStorage.setItem(KEYS.CSV_REPORT, JSON.stringify(report));
  },

  getGtfsSummary(): GTFSUploadSummary | null {
    try {
      const raw = localStorage.getItem(KEYS.GTFS_SUMMARY);
      return raw ? (JSON.parse(raw) as GTFSUploadSummary) : null;
    } catch {
      return null;
    }
  },

  saveGtfsSummary(summary: GTFSUploadSummary): void {
    localStorage.setItem(KEYS.GTFS_SUMMARY, JSON.stringify(summary));
  },

  getLastSearch(): SearchQuery {
    try {
      const raw = localStorage.getItem(KEYS.LAST_SEARCH);
      return raw ? { ...DEFAULT_SEARCH_QUERY, ...JSON.parse(raw) } : DEFAULT_SEARCH_QUERY;
    } catch {
      return DEFAULT_SEARCH_QUERY;
    }
  },

  saveLastSearch(query: SearchQuery): void {
    localStorage.setItem(KEYS.LAST_SEARCH, JSON.stringify(query));
  },

  resetAllDemoData(): void {
    localStorage.removeItem(KEYS.CAPACITY);
    localStorage.removeItem(KEYS.CSV_REPORT);
    localStorage.removeItem(KEYS.GTFS_SUMMARY);
    localStorage.removeItem(KEYS.LAST_SEARCH);
  },
};
