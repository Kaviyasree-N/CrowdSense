import type { CapacityConfig, ConfidenceLevel, CrowdingLevel } from '../types/transit.ts';

export const DEFAULT_CAPACITY_CONFIG: CapacityConfig = {
  acCapacity: 45,
  nonAcCapacity: 50,
  thresholds: {
    standingRoomMin: 70,
    crowdedMin: 100,
    veryCrowdedMin: 120,
  },
};

export function classifyCrowding(
  estimatedLoad: number,
  assumedCapacity: number,
  config: CapacityConfig = DEFAULT_CAPACITY_CONFIG
): { occupancyPct: number; level: CrowdingLevel } {
  const safeCapacity = Math.max(1, assumedCapacity);
  const occupancyPct = Math.round((estimatedLoad / safeCapacity) * 100);

  if (occupancyPct < config.thresholds.standingRoomMin) {
    return { occupancyPct, level: 'Seats Available' };
  }
  if (occupancyPct < config.thresholds.crowdedMin) {
    return { occupancyPct, level: 'Standing Room' };
  }
  if (occupancyPct < config.thresholds.veryCrowdedMin) {
    return { occupancyPct, level: 'Crowded' };
  }
  return { occupancyPct, level: 'Very Crowded' };
}

export interface CrowdingVisualStyle {
  level: CrowdingLevel;
  hex: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  barClass: string;
  shortHint: string;
}

export function getCrowdingStyle(level: CrowdingLevel): CrowdingVisualStyle {
  switch (level) {
    case 'Seats Available':
      return {
        level,
        hex: '#16A34A',
        bgClass: 'bg-emerald-50',
        textClass: 'text-emerald-800',
        borderClass: 'border-emerald-200',
        barClass: 'bg-emerald-600',
        shortHint: 'Below 70% of assumed capacity',
      };
    case 'Standing Room':
      return {
        level,
        hex: '#CA8A04',
        bgClass: 'bg-amber-50',
        textClass: 'text-amber-800',
        borderClass: 'border-amber-200',
        barClass: 'bg-amber-500',
        shortHint: '70% to 99% of assumed capacity',
      };
    case 'Crowded':
      return {
        level,
        hex: '#EA580C',
        bgClass: 'bg-orange-50',
        textClass: 'text-orange-800',
        borderClass: 'border-orange-200',
        barClass: 'bg-orange-500',
        shortHint: '100% to 119% of assumed capacity',
      };
    case 'Very Crowded':
      return {
        level,
        hex: '#DC2626',
        bgClass: 'bg-red-50',
        textClass: 'text-red-800',
        borderClass: 'border-red-200',
        barClass: 'bg-red-600',
        shortHint: '120%+ of assumed capacity',
      };
  }
}

export function getConfidenceBadgeInfo(confidence: ConfidenceLevel): {
  label: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
  explanation: string;
} {
  switch (confidence) {
    case 'High':
      return {
        label: 'High confidence',
        textClass: 'text-teal-800',
        bgClass: 'bg-teal-50',
        borderClass: 'border-teal-200',
        explanation: 'Backed by 35+ historical trip observations with consistent weekly demand and clean stop mapping.',
      };
    case 'Medium':
      return {
        label: 'Medium confidence',
        textClass: 'text-slate-700',
        bgClass: 'bg-slate-100',
        borderClass: 'border-slate-200',
        explanation: 'Moderate historical sample size or mild week-to-week demand variation across October records.',
      };
    case 'Low':
      return {
        label: 'Low confidence',
        textClass: 'text-amber-800',
        bgClass: 'bg-amber-50',
        borderClass: 'border-amber-200',
        explanation: 'Limited historical ticket observations, higher stop-mapping ambiguity, or irregular off-peak trips.',
      };
  }
}
