export type SearchSource = 'posts' | 'shop' | 'both';
export type MatchMode = 'exact' | 'broad';

export interface SearchParams {
  seller: string;
  date?: string;
  name?: string;
  count?: number;
  source: SearchSource;
  includeInactive: boolean;
  mode: MatchMode;
}

export interface ExtractedCount { value: number; approximate: boolean; raw: string }

export interface SearchResult {
  id: string;
  seller: string;
  source: 'Post' | 'Shop';
  title: string;
  createdAt: string | null;
  fileCount: ExtractedCount | null;
  status: 'active' | 'inactive' | 'sold-out' | 'unknown';
  excerpt: string;
  postUrl: string | null;
  shopUrl: string | null;
  externalUrl: string | null;
  previewUrl: string | null;
  previewUnavailable: boolean;
  matchExplanation: string;
  rank: number;
}
