const API_BASE = 'https://api.ganknow.com/v1';
const TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 3 * 60_000;

interface CacheEntry { expires: number; value: unknown }
const cache = new Map<string, CacheEntry>();

export class GankApiError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); }
}

async function getJson<T>(url: string): Promise<T> {
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value as T;
  if (cached) cache.delete(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'gank-post-finder/1.0' }
    });
    if (!response.ok) {
      if (response.status === 404) throw new GankApiError('Seller was not found on Gank.', 404);
      throw new GankApiError(`Gank API returned ${response.status}.`);
    }
    const value = await response.json() as T;
    cache.set(url, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    if (error instanceof GankApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new GankApiError('Gank API request timed out.', 504);
    throw new GankApiError('Could not reach the Gank API.');
  } finally {
    clearTimeout(timeout);
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function findArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = object(payload);
  for (const key of ['data', 'items', 'results', 'posts', 'services']) {
    const value = root[key];
    if (Array.isArray(value)) return value;
    const nested = object(value);
    for (const nestedKey of ['data', 'items', 'results', 'posts', 'services']) {
      if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as unknown[];
    }
  }
  return [];
}

export async function resolveUserId(seller: string): Promise<string> {
  const payload = await getJson<unknown>(`${API_BASE}/users/nickname/${encodeURIComponent(seller)}?timezone=7`);
  const root = object(payload);
  const data = object(root.data);
  const user = object(data.user ?? root.user);
  const id = data.id ?? data.uuid ?? data.userId ?? user.id ?? user.uuid ?? root.id ?? root.uuid ?? root.userId;
  if (typeof id !== 'string' && typeof id !== 'number') throw new GankApiError('Gank returned an unexpected seller profile.', 502);
  return String(id);
}

async function fetchAll(endpoint: (page: number) => string, pageSize: number): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const payload = await getJson<unknown>(endpoint(page));
    const batch = findArray(payload).map(object);
    all.push(...batch);
    if (batch.length < pageSize) break;
  }
  return all;
}

export function fetchPosts(userId: string) {
  return fetchAll(page => `${API_BASE}/posts?author=${encodeURIComponent(userId)}&page=${page}&perPage=200`, 200);
}

export function fetchServices(userId: string) {
  return fetchAll(page => `${API_BASE}/catalogs/services?userId=${encodeURIComponent(userId)}&page=${page}&per_page=100&order_by=createdAt%20desc`, 100);
}
