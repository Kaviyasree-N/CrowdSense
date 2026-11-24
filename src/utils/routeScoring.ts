import type {
  BalancedWeightsConfig,
  ConfidenceLevel,
  JourneyOption,
  JourneySegmentEstimate,
  RecommendationCategory,
} from '../types/transit.ts';

export const DEFAULT_BALANCED_WEIGHTS: BalancedWeightsConfig = {
  timeWeight: 0.6,
  crowdingWeight: 0.4,
};

function normalizeWeights(weights: BalancedWeightsConfig): BalancedWeightsConfig {
  const tw = Math.max(0, Number.isFinite(weights.timeWeight) ? weights.timeWeight : 0.6);
  const cw = Math.max(0, Number.isFinite(weights.crowdingWeight) ? weights.crowdingWeight : 0.4);
  const sum = tw + cw;
  if (sum <= 0) return DEFAULT_BALANCED_WEIGHTS;
  return {
    timeWeight: tw / sum,
    crowdingWeight: cw / sum,
  };
}

/**
 * Computes weighted scores for Fastest, Least Crowded (Comfort), and Balanced recommendations.
 * Evaluates strictly over the passenger's travelled segments (never whole-route averages),
 * applies an explicit bottleneck penalty for >=100% / >=120% segments, and prevents routes
 * lacking historical data from falsely outscoring genuinely low-crowding observed routes.
 */
export function scoreAndRankJourneys(
  options: JourneyOption[],
  weightsConfig: BalancedWeightsConfig = DEFAULT_BALANCED_WEIGHTS
): JourneyOption[] {
  if (options.length === 0) return [];

  const weights = normalizeWeights(weightsConfig);
  const minDuration = Math.min(...options.map((o) => o.total_duration_mins));
  const maxDuration = Math.max(...options.map((o) => o.total_duration_mins));
  const durationSpread = Math.max(1, maxDuration - minDuration);

  // First pass: raw fastest & comfort metrics
  const rawScored = options.map((option) => {
    const observedSegs = option.all_segments.filter((s) => s.has_historical_data !== false);
    const missingCount = option.all_segments.length - observedSegs.length;
    const allMissing = observedSegs.length === 0;

    const peakPct = allMissing
      ? 0
      : Math.max(...observedSegs.map((s) => s.occupancy_pct));
    const avgPct = allMissing ? 0 : option.weighted_avg_occupancy_pct;

    // Bottleneck penalty: heavily penalize segments above 100% and especially >= 120%
    const severeBottlenecks = observedSegs.filter((s) => s.occupancy_pct >= 120).length;
    const crowdedSegments = observedSegs.filter(
      (s) => s.occupancy_pct >= 100 && s.occupancy_pct < 120
    ).length;
    const bottleneckPenalty = severeBottlenecks * 38 + crowdedSegments * 14;

    const transferPenalty = option.transfers * 9;
    const missingDataPenalty = allMissing ? 160 : missingCount * 35;

    const fastestScore = option.total_duration_mins + option.transfers * 4;
    const rawComfort =
      (allMissing ? 75 : avgPct * 0.55 + peakPct * 0.45) +
      bottleneckPenalty +
      transferPenalty * 0.6 +
      missingDataPenalty;

    return {
      option,
      fastestScore,
      rawComfort,
      normalizedTime: ((option.total_duration_mins - minDuration) / durationSpread) * 100,
    };
  });

  const minComfort = Math.min(...rawScored.map((s) => s.rawComfort));
  const maxComfort = Math.max(...rawScored.map((s) => s.rawComfort));
  const comfortSpread = Math.max(1, maxComfort - minComfort);

  const scored = rawScored.map(({ option, fastestScore, rawComfort, normalizedTime }) => {
    const normalizedCrowding = ((rawComfort - minComfort) / comfortSpread) * 100;
    const balancedScore =
      weights.timeWeight * normalizedTime +
      weights.crowdingWeight * normalizedCrowding +
      option.transfers * 4;

    return {
      ...option,
      fastest_score: Number(fastestScore.toFixed(1)),
      comfort_score: Number(rawComfort.toFixed(1)),
      balanced_score: Number(balancedScore.toFixed(1)),
      recommendation_tags: [] as RecommendationCategory[],
    };
  });

  // Identify winners per category
  const fastestWinner = [...scored].sort((a, b) => a.fastest_score - b.fastest_score)[0];
  const comfortWinner = [...scored].sort((a, b) => a.comfort_score - b.comfort_score)[0];

  const balancedSorted = [...scored].sort((a, b) => a.balanced_score - b.balanced_score);
  const balancedWinner =
    balancedSorted.find((o) => o.id !== fastestWinner.id && o.id !== comfortWinner.id) ??
    balancedSorted[0];

  const timePctLabel = Math.round(weights.timeWeight * 100);
  const crowdPctLabel = Math.round(weights.crowdingWeight * 100);

  return scored.map((option) => {
    const tags: RecommendationCategory[] = [];
    if (option.id === fastestWinner.id) tags.push('fastest');
    if (option.id === comfortWinner.id) tags.push('least-crowded');
    if (option.id === balancedWinner.id) tags.push('balanced');

    const extraMins = option.total_duration_mins - fastestWinner.total_duration_mins;
    const observedSegs = option.all_segments.filter((s) => s.has_historical_data !== false);
    const peakSeg =
      observedSegs.length > 0
        ? observedSegs.reduce<JourneySegmentEstimate>(
            (max, seg) => (seg.occupancy_pct > max.occupancy_pct ? seg : max),
            observedSegs[0]
          )
        : option.all_segments[0];

    const fastestObserved = fastestWinner.all_segments.filter((s) => s.has_historical_data !== false);
    const fastestPeakSeg =
      fastestObserved.length > 0
        ? fastestObserved.reduce<JourneySegmentEstimate>(
            (max, seg) => (seg.occupancy_pct > max.occupancy_pct ? seg : max),
            fastestObserved[0]
          )
        : fastestWinner.all_segments[0];

    let reason = '';
    if (option.has_missing_predictions && observedSegs.length === 0) {
      reason = `${option.transfers === 0 ? 'Direct corridor' : `${option.transfers} transfer${option.transfers > 1 ? 's' : ''}`} (${option.total_duration_mins} min) — insufficient historical ticket data for segment crowding estimation.`;
    } else if (tags.includes('fastest') && tags.includes('least-crowded')) {
      reason = `Fastest available journey (${option.total_duration_mins} min) while keeping segment occupancy at ${option.peak_segment_occupancy_pct}% (${option.peak_crowding_level}).`;
    } else if (tags.includes('least-crowded')) {
      reason =
        extraMins > 0
          ? `Recommended for comfort: takes ${extraMins} min longer than the fastest route, keeping peak occupancy at ${option.peak_segment_occupancy_pct}% (${option.peak_crowding_level}) instead of ${fastestPeakSeg.occupancy_pct}%.`
          : `Lowest expected passenger occupancy across travelled segments (peak ${option.peak_segment_occupancy_pct}%).`;
    } else if (tags.includes('balanced')) {
      reason =
        extraMins > 0
          ? `Balanced (${timePctLabel}% time / ${crowdPctLabel}% comfort): takes ${extraMins} min longer than fastest while avoiding the ${fastestPeakSeg.occupancy_pct}% peak on ${fastestPeakSeg.from_stop.short_name} – ${fastestPeakSeg.to_stop.short_name}.`
          : `Best overall trade-off (${timePctLabel}% time / ${crowdPctLabel}% comfort) at ${option.total_duration_mins} min with ${option.peak_segment_occupancy_pct}% peak occupancy.`;
    } else if (tags.includes('fastest')) {
      reason = `Shortest estimated travel time (${option.total_duration_mins} min), though ${peakSeg.from_stop.short_name} – ${peakSeg.to_stop.short_name} reaches ${peakSeg.occupancy_pct}% (${peakSeg.crowding_level}).`;
    } else {
      reason = `${option.transfers === 0 ? 'Direct corridor' : `${option.transfers} transfer${option.transfers > 1 ? 's' : ''}`} option (${option.total_duration_mins} min) · peak ${peakSeg.occupancy_pct}% on ${peakSeg.from_stop.short_name} – ${peakSeg.to_stop.short_name}.`;
    }

    if (option.low_confidence_warning && observedSegs.length > 0) {
      reason = `${reason} Note: ${option.low_confidence_warning}`;
    }

    return {
      ...option,
      recommendation_tags: tags,
      recommendation_reason: reason,
    };
  });
}

export function aggregateConfidence(segments: JourneySegmentEstimate[]): ConfidenceLevel {
  if (segments.some((s) => s.has_historical_data === false || s.confidence === 'Low')) return 'Low';
  if (segments.some((s) => s.confidence === 'Medium')) return 'Medium';
  return 'High';
}
