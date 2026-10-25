import { FormEvent, KeyboardEvent, useRef, useState, type ClipboardEvent, type CSSProperties } from 'react';

const defaultShops = ['idolxdata', 'kdatastudio', 'yoichi69', 'idollove', 'loveshakedata', 'datacoffeeshop','girlskpopphoto','dubudatamaster'];
type Source = 'posts' | 'shop' | 'both' | 'all-shop';
type SearchSet = { id: number; date: string; name: string; count: string };
type Result = {
  id: string; seller: string; source: 'Post' | 'Shop'; title: string; createdAt: string | null;
  fileCount: { value: number; approximate: boolean; raw: string } | null;
  status: 'active' | 'inactive' | 'sold-out' | 'unknown'; excerpt: string;
  postUrl: string | null; shopUrl: string | null; externalUrl: string | null;
  previewUrl: string | null; previewUnavailable: boolean; matchExplanation: string; rank: number;
};
type Fetched = { posts: number; shop: number };
type StreamEvent = { type: 'result'; result: Result } | { type: 'done'; fetched: Fetched } | { type: 'error'; error: string };

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
  const [searchSets, setSearchSets] = useState<SearchSet[]>([{ id: 1, date: '260827', name: 'chaewon', count: '' }]);
  const nextSetId = useRef(2);
  const [source, setSource] = useState<Source>('both');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [mode, setMode] = useState<'exact' | 'broad'>('exact');
  const [results, setResults] = useState<Result[]>([]);
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchWarning, setSearchWarning] = useState('');
  const [searched, setSearched] = useState(false);

  function updateSearchSet(id: number, changes: Partial<SearchSet>) {
    setSearchSets(sets => sets.map(set => set.id === id ? { ...set, ...changes } : set));
  }

  function addSearchSet() {
    setSearchSets(sets => [...sets, { id: nextSetId.current++, date: '', name: '', count: '' }]);
  }

  function handleCluePaste(event: ClipboardEvent<HTMLInputElement>, id: number) {
    const pasted = event.clipboardData.getData('text').trim().replace(/\s+/g, ' ');
    const match = pasted.match(/^(\d{6})\s+(.+)$/);
    if (!match) return;
    event.preventDefault();
    updateSearchSet(id, { date: match[1], name: match[2] });
  }

  function buildQuery(sellerName: string, requestSource: 'posts' | 'shop' | 'both', set: SearchSet) {
    const query = new URLSearchParams({ seller: sellerName, source: requestSource, mode, includeInactive: String(includeInactive) });
    if (set.date) query.set('date', set.date);
    if (set.name) query.set('name', set.name);
    if (set.count) query.set('count', set.count);
    return query;
  }

  async function requestSearch(sellerName: string, requestSource: 'posts' | 'shop' | 'both', set: SearchSet, onResult: (result: Result) => void): Promise<Fetched> {
    const response = await fetch(`/api/search/stream?${buildQuery(sellerName, requestSource, set)}`);
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || `Search failed for ${sellerName}.`);
    }
    if (!response.body) throw new Error('Streaming search is unavailable in this browser.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fetched: Fetched | null = null;
    function handleLine(line: string) {
      if (!line.trim()) return;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === 'result') onResult(event.result);
      else if (event.type === 'done') fetched = event.fetched;
      else if (event.type === 'error') throw new Error(event.error);
    }
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
      if (done) break;
    }
    handleLine(buffer);
    if (!fetched) throw new Error('Search ended before completion.');
    return fetched;
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
    const activeSets = searchSets.filter(set => set.date.trim() || set.name.trim() || set.count.trim());
    setError(''); setSearchWarning(''); setSearched(true); setResults([]); setFetched(null);
    if (!activeSets.length) { setError('Enter a date, idol/name, or file count in at least one set.'); return; }

    const searchShops = source === 'all-shop' ? shops : [seller];
    const jobs = activeSets.flatMap(set => searchShops.map(shop => ({ set, shop })));
    setLoading(true);
    setProgress({ completed: 0, total: jobs.length });

    const collected = new Map<string, Result>();
    const totals = { posts: 0, shop: 0 };
    const failures: string[] = [];
    let nextIndex = 0;
    let completed = 0;
    let succeeded = 0;
    async function worker() {
      while (nextIndex < jobs.length) {
        const job = jobs[nextIndex++];
        try {
          const jobFetched = await requestSearch(job.shop, source === 'all-shop' ? 'both' : source, job.set, result => {
            const key = `${result.seller}:${result.source}:${result.id || result.postUrl || result.shopUrl || result.title}`;
            const previous = collected.get(key);
            collected.set(key, previous ? { ...(result.rank < previous.rank ? result : previous), previewUnavailable: previous.previewUnavailable || result.previewUnavailable } : result);
            setResults([...collected.values()].sort((a, b) => a.rank - b.rank || (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0)));
          });
          succeeded += 1;
          totals.posts += jobFetched.posts;
          totals.shop += jobFetched.shop;
          setFetched({ ...totals });
        } catch (caught) {
          failures.push(caught instanceof Error ? caught.message : 'Search failed.');
        } finally {
          completed += 1;
          setProgress({ completed, total: jobs.length });
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
      if (!succeeded && !collected.size) setError(jobs.length === 1 ? failures[0] : 'None of the searches could be completed.');
      else if (failures.length) setSearchWarning(`${failures.length} of ${jobs.length} searches could not be completed.`);
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
      <div className="search-sets">
        {searchSets.map((set, index) => <div className="search-set" key={set.id}>
          <div className="search-set-heading"><span>Set {String(index + 1).padStart(2, '0')}</span>{searchSets.length > 1 && <button type="button" onClick={() => setSearchSets(sets => sets.filter(item => item.id !== set.id))} aria-label={`Remove set ${index + 1}`}>Remove</button>}</div>
          <div className="field-grid">
            <div className="field"><label htmlFor={`date-${set.id}`}>Date <span>YYMMDD</span></label><input id={`date-${set.id}`} inputMode="numeric" pattern="\d{6}" maxLength={6} value={set.date} onChange={e => updateSearchSet(set.id, { date: e.target.value })} onPaste={e => handleCluePaste(e, set.id)} placeholder="260827" /></div>
            <div className="field"><label htmlFor={`name-${set.id}`}>Idol / name</label><input id={`name-${set.id}`} value={set.name} onChange={e => updateSearchSet(set.id, { name: e.target.value })} onPaste={e => handleCluePaste(e, set.id)} placeholder="eunchae" /></div>
            <div className="field"><label htmlFor={`count-${set.id}`}>Exact file count <span>optional</span></label><input id={`count-${set.id}`} type="number" min="1" value={set.count} onChange={e => updateSearchSet(set.id, { count: e.target.value })} placeholder="2075" /></div>
          </div>
        </div>)}
        <button className="add-set" type="button" onClick={addSearchSet}><span aria-hidden="true">＋</span> Add search set</button>
        <p className="paste-hint">Paste “261010 Kim Chaewon” into Date or Idol / name to fill both fields.</p>
      </div>
      <div className="controls">
        <fieldset><legend>Search source</legend><div className="segmented source-options">{(['posts', 'shop', 'both', 'all-shop'] as Source[]).map(item => <label key={item}><input type="radio" name="source" checked={source === item} onChange={() => setSource(item)} /><span>{item === 'shop' ? 'Shop' : item === 'all-shop' ? 'All shops' : item[0].toUpperCase() + item.slice(1)}</span></label>)}</div></fieldset>
        <fieldset><legend>Match mode</legend><div className="segmented"><label><input type="radio" name="mode" checked={mode === 'exact'} onChange={() => setMode('exact')} /><span>Exact</span></label><label><input type="radio" name="mode" checked={mode === 'broad'} onChange={() => setMode('broad')} /><span>Broad</span></label></div></fieldset>
        <label className="check"><input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} /><span>Include inactive / sold-out</span></label>
        <button className="submit" disabled={loading}>{loading ? 'Searching…' : source === 'all-shop' ? `Search ${shops.length} shops` : 'Search archive'}<span aria-hidden="true">↗</span></button>
      </div>
    </form>

    <section className="results" aria-live="polite">
      {loading && <div className="state loading-state"><div className="spinner" /><h2>Searching the archive</h2><p>{progress.completed} of {progress.total} searches complete · matches appear as they arrive</p><div className="progress-track determinate" role="progressbar" aria-label="Search progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}><span style={{ width: `${progressPercent}%` }} /></div><small>{progressPercent}% complete</small></div>}
      {!loading && error && <div className="state error"><b>!</b><h2>Search hit a snag</h2><p>{error}</p></div>}
      {searchWarning && <p className="search-warning" role="status">{searchWarning}</p>}
      {!loading && !error && searched && results.length === 0 && <div className="state"><b>0</b><h2>No matching sets</h2><p>Try Broad mode, remove the file count, or include inactive listings.</p></div>}
      {results.length > 0 && <>
        <div className="results-head"><div><span>Search results</span><h2>{results.length} {results.length === 1 ? 'match' : 'matches'}</h2></div>{fetched && <p>Scanned {fetched.posts} posts + {fetched.shop} listings</p>}</div>
        <div className="result-list">{results.map((result, index) => <article key={`${result.seller}-${result.source}-${result.id}`}>
          <div className="rank">{String(index + 1).padStart(2, '0')}</div>
          <div className="result-body">
            <div className="badges"><span className={`source ${result.source.toLowerCase()}`}>{result.source}</span><span className={`status ${result.status}`}>{result.status}</span>{result.previewUnavailable && <span className="unavailable">preview unavailable / deleted</span>}</div>
            <h3>{result.title}</h3>
            <div className="meta"><span className="seller-label" style={{ '--seller-color': sellerColor(result.seller) } as CSSProperties}>@{result.seller}</span><span>{result.createdAt ? new Date(result.createdAt).toLocaleDateString() : 'Unknown date'}</span><span>{result.fileCount ? `${result.fileCount.value.toLocaleString()}${result.fileCount.approximate ? '+' : ''} files${result.fileCount.approximate ? ' (approx.)' : ''}` : 'Count not found'}</span></div>
            {result.excerpt && <p className="excerpt">{result.excerpt}</p>}
            <p className="why">{result.matchExplanation}</p>
            <div className="links">{result.postUrl && <a href={result.postUrl} target="_blank">{result.source === 'Shop' ? 'Preview post' : 'Open post'} ↗</a>}{result.shopUrl && <a href={result.shopUrl} target="_blank">{result.shopUrl.endsWith('?tab=shop') ? 'Seller shop' : 'Shop listing'} ↗</a>}{result.externalUrl && <a href={result.externalUrl} target="_blank">External store ↗</a>}</div>
          </div>
        </article>)}</div>
      </>}
      {!searched && <div className="hint"><span>01</span><p>Choose one seller or select All shops to search every saved catalog.</p><span>02</span><p>Use Broad mode when spacing or spelling may vary.</p><span>03</span><p>Add more shops by nickname; Gank resolves their public user IDs.</p></div>}
    </section>
    <footer>Gank Post Finder <span>•</span> Public data only <span>•</span> No authentication bypass</footer>
  </main>;
}
