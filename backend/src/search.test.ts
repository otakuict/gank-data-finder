import { describe, expect, it } from 'vitest';
import { deduplicate, extractCounts, normalize, searchRecords } from './search.js';
import type { SearchParams, SearchResult } from './types.js';

const params: SearchParams = { seller: 'loveshakedata', date: '260827', name: 'chaewon', count: 2075, source: 'both', includeInactive: true, mode: 'exact' };

describe('search helpers', () => {
  it('extracts exact and approximate counts without calling approximate exact', () => {
    expect(extractCounts('1904 PICS, 2000 files, 2400+ FILES and 4099p')).toEqual([
      { value: 1904, approximate: false, raw: '1904 PICS' },
      { value: 2000, approximate: false, raw: '2000 files' },
      { value: 2400, approximate: true, raw: '2400+ FILES' },
      { value: 4099, approximate: false, raw: '4099p' }
    ]);
  });

  it('normalizes case, separators, unicode, and whitespace', () => {
    expect(normalize('  CHAEWON_data\nSet  ')).toBe('chaewon data set');
  });

  it('filters inactive listings when disabled', () => {
    const service = { uuid: 's1', name: '260827 CHAEWON 2075 files', description: 'PREVIEW', isActive: false };
    expect(searchRecords([], [service], { ...params, includeInactive: false })).toHaveLength(0);
    expect(searchRecords([], [service], params)).toHaveLength(1);
  });

  it('ranks exact, approximate, count-different, and broad matches', () => {
    const exact = { uuid: '1', title: '260827 chaewon 2075 files' };
    const approximate = { uuid: '2', title: '260827 chaewon 2075+ files' };
    const differs = { uuid: '3', title: '260827 chaewon 1904 pics' };
    const results = searchRecords([differs, approximate, exact], [], params);
    expect(results.map(r => [r.id, r.rank, r.matchExplanation])).toEqual([
      ['1', 1, 'exact date, name, and count'],
      ['2', 2, 'exact date and name; approximate count'],
      ['3', 3, 'exact date and name; count differs']
    ]);
    const broad = searchRecords([{ uuid: '4', title: '260827 Chae Won set' }], [], { ...params, name: 'chae won', count: undefined, mode: 'broad' });
    expect(broad[0]?.rank).toBe(3);
  });

  it('deduplicates by UUID or URL', () => {
    const base: SearchResult = { id: 'same', seller: 'x', source: 'Post', title: 'x', createdAt: null, fileCount: null, status: 'unknown', excerpt: '', postUrl: 'https://x', shopUrl: null, externalUrl: null, previewUrl: null, previewUnavailable: false, matchExplanation: '', rank: 3 };
    expect(deduplicate([base, { ...base, title: 'duplicate' }])).toHaveLength(1);
    expect(deduplicate([base, { ...base, id: 'other' }])).toHaveLength(1);
  });

});
