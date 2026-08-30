import { FormEvent, KeyboardEvent, useState, type CSSProperties } from 'react';

const defaultShops = ['idolxdata', 'kdatastudio', 'yoichi69', 'idollove', 'loveshakedata', 'datacoffeeshop'];
type Source = 'posts' | 'shop' | 'both' | 'all-shop';
type Result = {
  id: string; seller: string; source: 'Post' | 'Shop'; title: string; createdAt: string | null;
  fileCount: { value: number; approximate: boolean; raw: string } | null;
  status: 'active' | 'inactive' | 'sold-out' | 'unknown'; excerpt: string;
  postUrl: string | null; shopUrl: string | null; externalUrl: string | null;
  previewUrl: string | null; previewUnavailable: boolean; matchExplanation: string; rank: number;
};
type SearchPayload = { results: Result[]; fetched: { posts: number; shop: number } };

function initialShops() {
  try {
    const saved = JSON.parse(localStorage.getItem('gank-saved-shops') ?? '[]');
    return Array.isArray(saved) && saved.length ? [...new Set(saved.map(String))] : defaultShops;
  } catch { return defaultShops; }
}

function sellerColor(value: string) {
  let hash = 0;
  for (const character of value) hash = character.charCodeAt(0) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360} 72% 36%)`;
}

export default function App() {
  const [shops, setShops] = useState<string[]>(initialShops);
  const [seller, setSeller] = useState('loveshakedata');
  const [newShop, setNewShop] = useState('');
  const [addingShop, setAddingShop] = useState(false);
  const [shopMessage, setShopMessage] = useState('');
  const [date, setDate] = useState('260827');
  const [name, setName] = useState('chaewon');
  const [count, setCount] = useState('');
  const [source, setSource] = useState<Source>('both');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [mode, setMode] = useState<'exact' | 'broad'>('exact');
  const [results, setResults] = useState<Result[]>([]);
  const [fetched, setFetched] = useState<{ posts: number; shop: number } | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  function buildQuery(sellerName: string, requestSource: 'posts' | 'shop' | 'both') {
    const query = new URLSearchParams({ seller: sellerName, source: requestSource, mode, includeInactive: String(includeInactive) });
    if (date) query.set('date', date);
    if (name) query.set('name', name);
    if (count) query.set('count', count);
    return query;
  }

  async function requestSearch(sellerName: string, requestSource: 'posts' | 'shop' | 'both'): Promise<SearchPayload> {
    const response = await fetch(`/api/search?${buildQuery(sellerName, requestSource)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Search failed for ${sellerName}.`);
    return payload;
  }

  async function addShop() {
    const candidate = newShop.trim();
    setShopMessage('');
    if (!candidate) { setShopMessage('Enter a seller nickname first.'); return; }
    if (shops.some(shop => shop.toLocaleLowerCase() === candidate.toLocaleLowerCase())) {
      setSeller(shops.find(shop => shop.toLocaleLowerCase() === candidate.toLocaleLowerCase()) ?? candidate);
      setShopMessage('That shop is already saved.');
      return;
    }
    setAddingShop(true);
    try {
      const response = await fetch(`/api/sellers/resolve?seller=${encodeURIComponent(candidate)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Seller could not be found.');
      const updated = [...shops, payload.seller];
      setShops(updated); setSeller(payload.seller); setNewShop('');
      localStorage.setItem('gank-saved-shops', JSON.stringify(updated));
      setShopMessage(`Added @${payload.seller} · user ID ${payload.userId}`);
    } catch (caught) {
      setShopMessage(caught instanceof Error ? caught.message : 'Could not add this shop.');
    } finally { setAddingShop(false); }
  }

  function addShopOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') { event.preventDefault(); void addShop(); }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(''); setSearched(true); setResults([]); setFetched(null);
    const searchShops = source === 'all-shop' ? shops : [seller];
    setProgress({ completed: 0, total: searchShops.length });
    try {
      if (source !== 'all-shop') {
        const payload = await requestSearch(seller, source);
        setResults(payload.results); setFetched(payload.fetched); setProgress({ completed: 1, total: 1 });
        return;
      }

      const collected: Result[] = [];
      const totals = { posts: 0, shop: 0 };
      const failures: string[] = [];
      let nextIndex = 0;
      let completed = 0;
      async function worker() {
        while (nextIndex < searchShops.length) {
          const shop = searchShops[nextIndex++];
          if (!shop) continue;
          try {
            const payload = await requestSearch(shop, 'shop');
            collected.push(...payload.results);
            totals.posts += payload.fetched.posts;
            totals.shop += payload.fetched.shop;
          } catch { failures.push(shop); }
          completed += 1;
          setProgress({ completed, total: searchShops.length });
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, searchShops.length) }, worker));
      if (failures.length === searchShops.length) throw new Error('None of the saved shops could be searched.');
      const seen = new Set<string>();
      const unique = collected.filter(result => {
        const key = result.id || result.postUrl || result.shopUrl || `${result.seller}-${result.title}`;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      }).sort((a, b) => a.rank - b.rank || Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));
      setResults(unique); setFetched(totals);
      if (failures.length) setShopMessage(`Skipped ${failures.length} unavailable shop${failures.length === 1 ? '' : 's'}: ${failures.join(', ')}`);
    } catch (caught) {
      setResults([]); setFetched(null); setError(caught instanceof Error ? caught.message : 'Search failed.');
    } finally { setLoading(false); }
  }

  const progressPercent = Math.round((progress.completed / Math.max(progress.total, 1)) * 100);

  return <main>
    <header className="hero">
      <div className="eyebrow"><span className="pulse" /> Public API search</div>
      <h1>Find the set.<br /><em>Skip the scroll.</em></h1>
      <p>Search one seller—or every saved shop—by the clues you remember.</p>
    </header>

    <form className="search-panel" onSubmit={search}>
      <div className="field seller-field"><label htmlFor="seller">Seller nickname <span>{source === 'all-shop' ? 'All saved shops selected' : 'Single-shop search'}</span></label><input id="seller" value={seller} disabled={source === 'all-shop'} onChange={e => setSeller(e.target.value)} required /></div>
      <div className="saved-shops-label">Saved shops · {shops.length}</div>
      <div className="presets" aria-label="Saved shops">{shops.map(shop => <button className={seller === shop && source !== 'all-shop' ? 'active' : ''} type="button" key={shop} onClick={() => { setSeller(shop); if (source === 'all-shop') setSource('shop'); }}>{shop}</button>)}</div>
      <div className="add-shop">
        <div className="field"><label htmlFor="new-shop">Add a shop by nickname</label><input id="new-shop" value={newShop} onChange={e => setNewShop(e.target.value)} onKeyDown={addShopOnEnter} placeholder="seller nickname" /></div>
        <button type="button" disabled={addingShop} onClick={() => void addShop()}>{addingShop ? 'Checking…' : 'Add shop'} <span>＋</span></button>
      </div>
      {shopMessage && <p className="shop-message" role="status">{shopMessage}</p>}
      <div className="field-grid">
        <div className="field"><label htmlFor="date">Date <span>YYMMDD</span></label><input id="date" inputMode="numeric" pattern="\d{6}" maxLength={6} value={date} onChange={e => setDate(e.target.value)} placeholder="260827" /></div>
        <div className="field"><label htmlFor="name">Idol / name</label><input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="eunchae" /></div>
        <div className="field"><label htmlFor="count">Exact file count <span>optional</span></label><input id="count" type="number" min="1" value={count} onChange={e => setCount(e.target.value)} placeholder="2075" /></div>
      </div>
      <div className="controls">
        <fieldset><legend>Search source</legend><div className="segmented source-options">{(['posts', 'shop', 'both', 'all-shop'] as Source[]).map(item => <label key={item}><input type="radio" name="source" checked={source === item} onChange={() => setSource(item)} /><span>{item === 'shop' ? 'Shop' : item === 'all-shop' ? 'All shops' : item[0].toUpperCase() + item.slice(1)}</span></label>)}</div></fieldset>
        <fieldset><legend>Match mode</legend><div className="segmented"><label><input type="radio" name="mode" checked={mode === 'exact'} onChange={() => setMode('exact')} /><span>Exact</span></label><label><input type="radio" name="mode" checked={mode === 'broad'} onChange={() => setMode('broad')} /><span>Broad</span></label></div></fieldset>
        <label className="check"><input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} /><span>Include inactive / sold-out</span></label>
        <button className="submit" disabled={loading}>{loading ? 'Searching…' : source === 'all-shop' ? `Search ${shops.length} shops` : 'Search archive'}<span aria-hidden="true">↗</span></button>
      </div>
    </form>

    <section className="results" aria-live="polite">
      {loading && <div className="state loading-state"><div className="spinner" /><h2>{source === 'all-shop' ? 'Searching every saved shop' : 'Searching the full archive'}</h2><p>{source === 'all-shop' ? `${progress.completed} of ${progress.total} shops complete` : 'Fetching and checking every available page…'}</p><div className={`progress-track ${source === 'all-shop' ? 'determinate' : ''}`} role="progressbar" aria-label="Loading search results" aria-valuemin={0} aria-valuemax={100} aria-valuenow={source === 'all-shop' ? progressPercent : undefined}><span style={source === 'all-shop' ? { width: `${progressPercent}%` } : undefined} /></div><small>{source === 'all-shop' ? `${progressPercent}% complete` : 'Large seller archives can take a little longer'}</small></div>}
      {!loading && error && <div className="state error"><b>!</b><h2>Search hit a snag</h2><p>{error}</p></div>}
      {!loading && !error && searched && results.length === 0 && <div className="state"><b>0</b><h2>No matching sets</h2><p>Try Broad mode, remove the file count, or include inactive listings.</p></div>}
      {!loading && !error && results.length > 0 && <>
        <div className="results-head"><div><span>Search results</span><h2>{results.length} {results.length === 1 ? 'match' : 'matches'}</h2></div>{fetched && <p>Scanned {fetched.posts} posts + {fetched.shop} listings</p>}</div>
        <div className="result-list">{results.map((result, index) => <article key={`${result.seller}-${result.source}-${result.id}`}>
          <div className="rank">{String(index + 1).padStart(2, '0')}</div>
          <div className="result-body">
            <div className="badges"><span className={`source ${result.source.toLowerCase()}`}>{result.source}</span><span className={`status ${result.status}`}>{result.status}</span>{result.previewUnavailable && <span className="unavailable">preview unavailable / deleted</span>}</div>
            <h3>{result.title}</h3>
            <div className="meta"><span className="seller-label" style={{ '--seller-color': sellerColor(result.seller) } as CSSProperties}>@{result.seller}</span><span>{result.createdAt ? new Date(result.createdAt).toLocaleDateString() : 'Unknown date'}</span><span>{result.fileCount ? `${result.fileCount.value.toLocaleString()}${result.fileCount.approximate ? '+' : ''} files${result.fileCount.approximate ? ' (approx.)' : ''}` : 'Count not found'}</span></div>
            {result.excerpt && <p className="excerpt">{result.excerpt}</p>}
            <p className="why">{result.matchExplanation}</p>
            <div className="links">{result.postUrl && <a href={result.postUrl} target="_blank">{result.source === 'Shop' ? 'Preview post' : 'Open post'} ↗</a>}{result.shopUrl && <a href={result.shopUrl} target="_blank">Shop listing ↗</a>}{result.externalUrl && <a href={result.externalUrl} target="_blank">External store ↗</a>}</div>
          </div>
        </article>)}</div>
      </>}
      {!searched && <div className="hint"><span>01</span><p>Choose one seller or select All shops to search every saved catalog.</p><span>02</span><p>Use Broad mode when spacing or spelling may vary.</p><span>03</span><p>Add more shops by nickname; Gank resolves their public user IDs.</p></div>}
    </section>
    <footer>Gank Post Finder <span>•</span> Public data only <span>•</span> No authentication bypass</footer>
  </main>;
}
