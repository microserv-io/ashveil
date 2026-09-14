export type HillsideTerrainLook = 'baseline' | 'painterly'

export interface HillsideReviewRoute {
  readonly enabled: boolean
  readonly loadZoneDraft: boolean
}

export const HILLSIDE_REVIEW_HOUR = 12

export function hillsideReviewRoute(search: string): HillsideReviewRoute {
  const parameters = new URLSearchParams(search)
  const enabled = parameters.get('hillsideReview') === '1'
  return {
    enabled,
    loadZoneDraft: !enabled && parameters.get('zoneDraft') === '1',
  }
}
