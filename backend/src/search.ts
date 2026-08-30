import type { ExtractedCount, SearchParams, SearchResult } from './types.js';

type Raw = Record<string, unknown>;

export function normalize(value: unknown): string {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function extractDates(text: string): string[] {
  return [...new Set(text.match(/(?<!\d)\d{6}(?!\d)/g) ?? [])];
}

export function extractCounts(text: string): ExtractedCount[] {
  const results: ExtractedCount[] = [];
  const pattern = /(?<!\d)(\d{1,6})\s*(\+)?\s*(pics?|pictures?|photos?|images?|files?|[pP])(?![a-z])/gi;
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isSafeInteger(value) && value > 0) results.push({ value, approximate: Boolean(match[2]), raw: match[0] });
  }
  return results;
}

function str(raw: Raw, ...keys: string[]): string {
  for (const key of keys) if (typeof raw[key] === 'string') return raw[key] as string;
  return '';
}

function bool(raw: Raw, ...keys: string[]): boolean | undefined {
  for (const key of keys) if (typeof raw[key] === 'boolean') return raw[key] as boolean;
  return undefined;
}

function id(raw: Raw): string { return str(raw, 'uuid', 'id', '_id', 'slug') || JSON.stringify(raw).slice(0, 100); }

function extractUrl(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[0]?.replace(/[),.;]+$/, '') ?? null;
}

function directUrl(raw: Raw, ...keys: string[]): string | null {
  const candidate = str(raw, ...keys);
  return /^https?:\/\//i.test(candidate) ? candidate : null;
}

function cleanExcerpt(text: string): string {
  return text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280);
}

function getStatus(raw: Raw, source: 'Post' | 'Shop'): SearchResult['status'] {
  if (source === 'Post') return 'active';
  const soldOut = bool(raw, 'isSoldOut', 'soldOut') ?? (typeof raw.stock === 'number' && raw.stock <= 0);
  if (soldOut) return 'sold-out';
  const active = bool(raw, 'isActive', 'active', 'is_active');
  return active === false ? 'inactive' : active === true ? 'active' : 'unknown';
}

function matchAndRank(text: string, params: SearchParams, counts: ExtractedCount[]): { rank: number; explanation: string } | null {
  const normalized = normalize(text);
  const dates = extractDates(text);
  const dateMatch = !params.date || dates.includes(params.date);
  const namePhrase = normalize(params.name);
  const nameMatch = !namePhrase || normalized.includes(namePhrase);
  const broadNameMatch = !namePhrase || namePhrase.split(' ').every(token => normalized.includes(token));
  const broadDateMatch = !params.date || normalized.includes(params.date);
  if (params.mode === 'exact' && (!dateMatch || !nameMatch)) return null;
  if (params.mode === 'broad' && (!broadDateMatch || !broadNameMatch)) return null;

  const exactCount = params.count !== undefined && counts.some(c => c.value === params.count && !c.approximate);
  const approximateCount = params.count !== undefined && counts.some(c => c.value === params.count && c.approximate);
  if (dateMatch && nameMatch && exactCount) return { rank: 1, explanation: 'exact date, name, and count' };
  if (dateMatch && nameMatch && approximateCount) return { rank: 2, explanation: 'exact date and name; approximate count' };
  if (dateMatch && nameMatch) {
    return { rank: 3, explanation: params.count === undefined ? 'exact date and name' : 'exact date and name; count differs' };
  }
  return { rank: 4, explanation: 'broad partial match' };
}

function toResult(raw: Raw, source: 'Post' | 'Shop', params: SearchParams, knownPostIds: Set<string>): SearchResult | null {
  const title = source === 'Post' ? str(raw, 'title', 'name') : str(raw, 'name', 'title');
  const body = source === 'Post' ? str(raw, 'content', 'description', 'body', 'caption') : str(raw, 'description', 'content', 'detail');
  const text = `${title} ${body}`;
  const counts = extractCounts(text);
  const match = matchAndRank(text, params, counts);
  if (!match) return null;
  const status = getStatus(raw, source);
  if (source === 'Shop' && !params.includeInactive && status !== 'active' && status !== 'unknown') return null;

  const uuid = id(raw);
  const previewUrl = extractUrl(body, /https?:\/\/(?:www\.)?ganknow\.com\/[^\s<>"']+/i);
  const externalUrl = extractUrl(text, /https?:\/\/(?:[^\s<>"']+\.)?(?:gumroad\.com|ko-fi\.com)\/[^\s<>"']+/i);
  const suppliedUrl = directUrl(raw, 'url', 'link', 'shareUrl', 'webUrl', 'permalink');
  const postUrl = source === 'Post' ? (suppliedUrl ?? `https://ganknow.com/${encodeURIComponent(params.seller)}/posts/${encodeURIComponent(uuid)}`) : previewUrl;
  const shopUrl = source === 'Shop' ? (suppliedUrl ?? `https://ganknow.com/${encodeURIComponent(params.seller)}/services/${encodeURIComponent(uuid)}`) : null;
  const previewId = previewUrl?.split('/').filter(Boolean).at(-1) ?? '';
  const unavailable = Boolean(previewUrl && previewId && !knownPostIds.has(normalize(previewId)));

  return {
    id: uuid, seller: params.seller, source, title: title || '(untitled)',
    createdAt: str(raw, 'createdAt', 'created_at', 'publishedAt', 'published_at') || null,
    fileCount: counts[0] ?? null, status, excerpt: cleanExcerpt(body), postUrl, shopUrl,
    externalUrl, previewUrl, previewUnavailable: Boolean(previewUrl && unavailable),
    matchExplanation: match.explanation, rank: match.rank
  };
}

export function searchRecords(posts: Raw[], services: Raw[], params: SearchParams): SearchResult[] {
  const knownPostIds = new Set(posts.map(raw => normalize(id(raw))));
  const candidates = [
    ...posts.map(raw => toResult(raw, 'Post', params, knownPostIds)),
    ...services.map(raw => toResult(raw, 'Shop', params, knownPostIds))
  ].filter((item): item is SearchResult => Boolean(item));
  return deduplicate(candidates).sort((a, b) => a.rank - b.rank || Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));
}

export function deduplicate(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter(result => {
    const keys = [result.id, result.postUrl, result.shopUrl].filter(Boolean).map(normalize);
    if (keys.some(key => seen.has(key))) return false;
    keys.forEach(key => seen.add(key));
    return true;
  });
}
