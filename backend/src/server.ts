import cors from 'cors';
import express from 'express';
import { fetchPosts, fetchServices, GankApiError, resolveUserId } from './gankClient.js';
import { searchRecords } from './search.js';
import type { MatchMode, SearchParams, SearchSource } from './types.js';

const app = express();
const port = Number(process.env.PORT) || 3001;
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));

function one(value: unknown): string { return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? ''); }

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/sellers/resolve', async (req, res) => {
  const seller = one(req.query.seller).trim();
  if (!/^[\p{L}\p{N}_.-]{1,80}$/u.test(seller)) return res.status(400).json({ error: 'Enter a valid seller nickname.' });
  try {
    const userId = await resolveUserId(seller);
    res.json({ seller, userId });
  } catch (error) {
    const status = error instanceof GankApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Could not resolve this seller.';
    res.status(status).json({ error: message });
  }
});

app.get('/api/search', async (req, res) => {
  const seller = one(req.query.seller).trim();
  const date = one(req.query.date).trim();
  const name = one(req.query.name).trim();
  const countText = one(req.query.count).trim();
  const source = (one(req.query.source) || 'both') as SearchSource;
  const mode = (one(req.query.mode) || 'exact') as MatchMode;
  const includeInactive = one(req.query.includeInactive).toLowerCase() === 'true';

  if (!/^[\p{L}\p{N}_.-]{1,80}$/u.test(seller)) return res.status(400).json({ error: 'Seller nickname is required and may contain letters, numbers, dots, dashes, or underscores.' });
  if (date && !/^\d{6}$/.test(date)) return res.status(400).json({ error: 'Date must contain exactly six digits (YYMMDD).' });
  if (name.length > 100) return res.status(400).json({ error: 'Idol/name must be 100 characters or fewer.' });
  if (countText && (!/^\d{1,7}$/.test(countText) || Number(countText) < 1)) return res.status(400).json({ error: 'File count must be a positive whole number.' });
  if (!['posts', 'shop', 'both'].includes(source)) return res.status(400).json({ error: 'Source must be posts, shop, or both.' });
  if (!['exact', 'broad'].includes(mode)) return res.status(400).json({ error: 'Mode must be exact or broad.' });
  if (!date && !name && !countText) return res.status(400).json({ error: 'Enter at least a date, idol/name, or file count.' });

  const params: SearchParams = { seller, source, mode, includeInactive };
  if (date) params.date = date;
  if (name) params.name = name;
  if (countText) params.count = Number(countText);

  try {
    const userId = await resolveUserId(seller);
    const [posts, services] = await Promise.all([
      source === 'shop' ? Promise.resolve([]) : fetchPosts(userId),
      source === 'posts' ? Promise.resolve([]) : fetchServices(userId)
    ]);
    const results = searchRecords(posts, services, params);
    res.json({ seller, userId, resultCount: results.length, fetched: { posts: posts.length, shop: services.length }, results });
  } catch (error) {
    const status = error instanceof GankApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Unexpected search error.';
    res.status(status).json({ error: message });
  }
});

app.listen(port, () => console.log(`Gank search API listening on http://localhost:${port}`));
