import {
  ConfidenceLevel,
  JourneyOption,
  JourneySegmentEstimate,
  RecommendationCategory,
} from '../types/transit';

/**
 * Computes weighted scores for Fastest, Least Crowded (Comfort), and Balanced recommendations.
 * Includes an explicit bottleneck penalty so a route is never flagged as "Least Crowded" or "Balanced"
 * solely on average occupancy if one critical segment is Very Crowded (>= 120%).
 */
export function scoreAndRankJourneys(options: JourneyOption[]): JourneyOption[] {
  if (options.length === 0) return [];

  const minDuration = Math.min(...options.map((o) => o.total_duration_mins));
  const maxDuration = Math.max(...options.map((o) => o.total_duration_mins));
  const durationSpread = Math.max(1, maxDuration - minDuration);

  const scored = options.map((option) => {
    const peakPct = Math.max(...option.all_segments.map((s) => s.occupancy_pct));
    const avgPct = option.weighted_avg_occupancy_pct;

    // Bottleneck penalty: heavily penalize segments above 100% and especially >= 120%
    const severeBottlenecks = option.all_segments.filter((s) => s.occupancy_pct >= 120).length;
    const crowdedSegments = option.all_segments.filter(
      (s) => s.occupancy_pct >= 100 && s.occupancy_pct < 120
    ).length;
    const bottleneckPenalty = severeBottlenecks * 38 + crowdedSegments * 14;

    const transferPenalty = option.transfers * 9;
    const normalizedTime = ((option.total_duration_mins - minDuration) / durationSpread) * 100;

    // Lower score = better
    const fastestScore = option.total_duration_mins + option.transfers * 4;
    const comfortScore = avgPct * 0.55 + peakPct * 0.45 + bottleneckPenalty + transferPenalty * 0.6;
    const balancedScore = normalizedTime * 0.42 + comfortScore * 0.58 + transferPenalty;

    return {
      ...option,
      fastest_score: Number(fastestScore.toFixed(1)),
      comfort_score: Number(comfortScore.toFixed(1)),
      balanced_score: Number(balancedScore.toFixed(1)),
      recommendation_tags: [] as RecommendationCategory[],
    };
  });

  // Identify winners per category
  const fastestWinner = [...scored].sort((a, b) => a.fastest_score - b.fastest_score)[0];
  const comfortWinner = [...scored].sort((a, b) => a.comfort_score - b.comfort_score)[0];

  // For balanced, prefer an option that isn't already identical to fastest if another competitive option exists
  const balancedSorted = [...scored].sort((a, b) => a.balanced_score - b.balanced_score);
  const balancedWinner =
    balancedSorted.find((o) => o.id !== fastestWinner.id && o.id !== comfortWinner.id) ??
    balancedSorted[0];

  // Attach tags & human-readable explanation
  return scored.map((option) => {
    const tags: RecommendationCategory[] = [];
    if (option.id === fastestWinner.id) tags.push('fastest');
    if (option.id === comfortWinner.id) tags.push('least-crowded');
    if (option.id === balancedWinner.id) tags.push('balanced');

    const extraMins = option.total_duration_mins - fastestWinner.total_duration_mins;
    const peakSeg = option.all_segments.reduce<JourneySegmentEstimate>(
      (max, seg) => (seg.occupancy_pct > max.occupancy_pct ? seg : max),
      option.all_segments[0]
    );
    const fastestPeakSeg = fastestWinner.all_segments.reduce<JourneySegmentEstimate>(
      (max, seg) => (seg.occupancy_pct > max.occupancy_pct ? seg : max),
      fastestWinner.all_segments[0]
    );

    let reason = '';
    if (tags.includes('fastest') && tags.includes('least-crowded')) {
      reason = `Fastest available journey (${option.total_duration_mins} min) while keeping segment occupancy at ${option.peak_segment_occupancy_pct}% (${option.peak_crowding_level}).`;
    } else if (tags.includes('least-crowded')) {
      reason =
        extraMins > 0
          ? `Recommended for comfort: takes ${extraMins} min longer than the fastest route, keeping peak occupancy at ${option.peak_segment_occupancy_pct}% (${option.peak_crowding_level}) instead of ${fastestPeakSeg.occupancy_pct}%.`
          : `Lowest expected passenger occupancy across all segments (peak ${option.peak_segment_occupancy_pct}%).`;
    } else if (tags.includes('balanced')) {
      reason =
        extraMins > 0
          ? `Recommended balance: takes only ${extraMins} min longer than the fastest option while avoiding the ${fastestPeakSeg.occupancy_pct}% peak on ${fastestPeakSeg.from_stop.short_name} – ${fastestPeakSeg.to_stop.short_name}.`
          : `Best overall trade-off between travel duration (${option.total_duration_mins} min) and segment comfort.`;
    } else if (tags.includes('fastest')) {
      reason = `Shortest estimated travel time (${option.total_duration_mins} min), though ${peakSeg.from_stop.short_name} – ${peakSeg.to_stop.short_name} reaches ${peakSeg.occupancy_pct}% (${peakSeg.crowding_level}).`;
    } else {
      reason = `${option.transfers === 0 ? 'Direct corridor' : `${option.transfers} transfer`} option · peak ${peakSeg.occupancy_pct}% on ${peakSeg.from_stop.short_name} – ${peakSeg.to_stop.short_name}.`;
    }

    return {
      ...option,
      recommendation_tags: tags,
      recommendation_reason: reason,
    };
  });
}

export function aggregateConfidence(segments: JourneySegmentEstimate[]): ConfidenceLevel {
  if (segments.some((s) => s.confidence === 'Low')) return 'Low';
  if (segments.some((s) => s.confidence === 'Medium')) return 'Medium';
  return 'High';
}
