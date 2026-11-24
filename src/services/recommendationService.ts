import type { JourneyOption, RecommendationCategory, SortOption } from '../types/transit.ts';

export const recommendationService = {
  sortJourneys(journeys: JourneyOption[], sortBy: SortOption): JourneyOption[] {
    const copy = [...journeys];
    switch (sortBy) {
      case 'fastest':
        return copy.sort((a, b) => a.total_duration_mins - b.total_duration_mins);
      case 'least-crowded':
        return copy.sort((a, b) => a.comfort_score - b.comfort_score);
      case 'fewest-transfers':
        return copy.sort((a, b) =>
          a.transfers !== b.transfers
            ? a.transfers - b.transfers
            : a.total_duration_mins - b.total_duration_mins
        );
      case 'balanced':
      default:
        return copy.sort((a, b) => a.balanced_score - b.balanced_score);
    }
  },

  filterByCategory(
    journeys: JourneyOption[],
    category: RecommendationCategory | 'all'
  ): JourneyOption[] {
    if (category === 'all') return journeys;
    return journeys.filter((j) => j.recommendation_tags.includes(category));
  },
};
