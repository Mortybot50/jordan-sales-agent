/**
 * Curated hospitality categories for LeadFlow sourcing searches.
 *
 * These are passed verbatim into the search query string for Outscraper
 * Google Maps Scraper / Google Places text search. Keep them lowercase
 * single-word tokens — the engines match them as venue category keywords.
 */
export const HOSPITALITY_CATEGORIES = [
  'restaurant',
  'cafe',
  'bar',
  'hotel',
  'function_venue',
  'fine_dining',
  'bakery',
  'pub',
  'club',
  'brewery',
  'distillery',
  'winery',
] as const

export type HospitalityCategory = (typeof HOSPITALITY_CATEGORIES)[number]
