import { describe, it } from 'mocha';
import { strict as assert } from 'assert';
import { parseIdentifier, isResolvable } from '../../papers/identifier';
import { buildFilename, dedupeFilename } from '../../papers/filename';
import { raceSources } from '../../papers/racer';
import { toPaperMeta, hitToIdentifier } from '../../papers/search';
import { directUrlSource } from '../../papers/sources/direct_url';
import { pubscholarSource } from '../../papers/sources/pubscholar';
import { buildManualDownloadUrls } from '../../papers/downloader';
import type { SearchHit } from '../../papers/search';
import type { PaperSource, ParsedIdentifier, SourceCandidate, PaperMeta } from '../../papers/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('papers/identifier', () => {
  it('parses a bare DOI', () => {
    const id = parseIdentifier('10.1038/nature12373');
    assert.equal(id.kind, 'doi');
    assert.equal(id.doi, '10.1038/nature12373');
    assert.ok(isResolvable(id));
  });

  it('parses a doi.org URL', () => {
    const id = parseIdentifier('https://doi.org/10.1126/science.aec6396');
    assert.equal(id.kind, 'doi');
    assert.equal(id.doi, '10.1126/science.aec6396');
  });

  it('parses arXiv ID with prefix', () => {
    const id = parseIdentifier('arXiv:2401.01234');
    assert.equal(id.kind, 'arxiv');
    assert.equal(id.arxivId, '2401.01234');
  });

  it('parses bare arXiv ID', () => {
    const id = parseIdentifier('2401.01234');
    assert.equal(id.kind, 'arxiv');
    assert.equal(id.arxivId, '2401.01234');
  });

  it('parses arXiv DOI form', () => {
    const id = parseIdentifier('10.48550/arXiv.2401.01234');
    assert.equal(id.kind, 'doi');
    assert.equal(id.doi, '10.48550/arxiv.2401.01234');
  });

  it('parses PMID', () => {
    const id = parseIdentifier('PMID:12345678');
    assert.equal(id.kind, 'pmid');
    assert.equal(id.pmid, '12345678');
  });

  it('returns unknown for unrecognised input', () => {
    const id = parseIdentifier('hello world');
    assert.equal(id.kind, 'unknown');
    assert.equal(isResolvable(id), false);
  });

  it('parses a direct file URL as kind:url and is resolvable', () => {
    const id = parseIdentifier('https://file.scholarin.cn/preview2?file=editor_cj_abc.pdf');
    assert.equal(id.kind, 'url');
    assert.equal(id.value, 'https://file.scholarin.cn/preview2?file=editor_cj_abc.pdf');
    assert.ok(isResolvable(id));
  });

  it('parses a PubScholar article URL as kind:url', () => {
    const id = parseIdentifier('https://pubscholar.cn/articles/af1c6d1583347f229da8768f47a77bde');
    assert.equal(id.kind, 'url');
    assert.ok(isResolvable(id));
  });
});

describe('papers/filename', () => {
  it('builds AuthorYear_Title.pdf for a paper', () => {
    const name = buildFilename({
      title: 'Attention Is All You Need',
      authors: ['Vaswani, Ashish', 'Shazeer, Noam', 'Polosukhin, Illia'],
      year: 2017,
    });
    assert.ok(name.startsWith('Vaswani et al (2017)'));
    assert.ok(name.endsWith('.pdf'));
    assert.ok(name.includes('Attention Is All You Need'));
  });

  it('falls back to "et al" for >3 authors', () => {
    const name = buildFilename({
      title: 'A Study',
      authors: ['A', 'B', 'C', 'D'],
      year: 2020,
    });
    assert.ok(name.includes('A et al'));
  });

  it('sanitizes illegal characters', () => {
    const name = buildFilename({
      title: 'A/B\\C:D*E?F',
      authors: ['Smith'],
      year: 2021,
    });
    assert.ok(!name.includes('/'));
    assert.ok(!name.includes('\\'));
    assert.ok(!name.includes(':'));
    assert.ok(!name.includes('*'));
    assert.ok(!name.includes('?'));
  });

  it('uses "n.d." when year is missing', () => {
    const name = buildFilename({ title: 'Untitled', authors: [] });
    assert.ok(name.includes('(n.d.)'));
  });

  it('dedupes against existing files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-test-'));
    try {
      const base = 'Author (2024) Title.pdf';
      fs.writeFileSync(path.join(tmp, base), 'x');
      const next = dedupeFilename(tmp, base);
      assert.equal(next, 'Author (2024) Title (1).pdf');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('papers/racer', () => {
  const make = (name: string, rank: number, delayMs: number, ok: boolean): PaperSource => ({
    name,
    rank,
    timeoutMs: 1000,
    async resolve(_id: ParsedIdentifier, _signal?: AbortSignal): Promise<SourceCandidate | null> {
      await new Promise((r) => setTimeout(r, delayMs));
      if (!ok) return null;
      return { source: name, pdfUrl: `https://example.com/${name}.pdf` };
    },
  });

  const parsed: ParsedIdentifier = { kind: 'doi', value: '10.1/test', doi: '10.1/test' };

  it('returns the fastest successful source', async () => {
    const sources = [make('slow', 5, 50, true), make('fast', 1, 5, true), make('medium', 3, 20, true)];
    const result = await raceSources({ identifier: parsed, sources });
    assert.ok(result);
    assert.equal(result!.candidates[0]!.source, 'fast');
  });

  it('falls back when the fastest source fails', async () => {
    const broken: PaperSource = {
      name: 'broken',
      rank: 1,
      timeoutMs: 1000,
      async resolve(): Promise<SourceCandidate | null> {
        await new Promise((r) => setTimeout(r, 5));
        throw new Error('upstream 500');
      },
    };
    const sources = [broken, make('ok', 2, 30, true)];
    const result = await raceSources({ identifier: parsed, sources });
    assert.ok(result);
    assert.equal(result!.candidates[0]!.source, 'ok');
    assert.equal(result!.failures.length, 1);
    assert.equal(result!.failures[0]!.source, 'broken');
    assert.match(result!.failures[0]!.error, /upstream 500/);
  });

  it('returns null when all sources fail', async () => {
    const sources = [make('a', 1, 5, false), make('b', 2, 5, false)];
    const result = await raceSources({ identifier: parsed, sources });
    assert.equal(result, null);
  });
});

describe('papers/search', () => {
  function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
    return {
      title: 'Attention is all you need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      year: 2017,
      doi: '10.48550/arXiv.1706.03762',
      arxivId: '1706.03762',
      venue: 'NeurIPS',
      pdfUrl: 'https://arxiv.org/pdf/1706.03762',
      abstract: 'We propose a new simple network architecture.',
      openalexId: 'W2963274047',
      ...overrides,
    };
  }

  describe('hitToIdentifier', () => {
    it('prefers DOI over arXiv ID when both present', () => {
      const id = hitToIdentifier(makeHit());
      assert.ok(id);
      assert.equal(id!.kind, 'doi');
      assert.equal(id!.doi, '10.48550/arXiv.1706.03762');
    });

    it('falls back to arXiv ID when DOI is missing', () => {
      const id = hitToIdentifier(makeHit({ doi: undefined }));
      assert.ok(id);
      assert.equal(id!.kind, 'arxiv');
      assert.equal(id!.arxivId, '1706.03762');
    });

    it('returns null when neither DOI nor arXiv ID present', () => {
      const id = hitToIdentifier(makeHit({ doi: undefined, arxivId: undefined }));
      assert.equal(id, null);
    });
  });

  describe('toPaperMeta', () => {
    it('converts a hit with all fields', () => {
      const meta = toPaperMeta(makeHit());
      assert.equal(meta.title, 'Attention is all you need');
      assert.deepEqual(meta.authors, ['Ashish Vaswani', 'Noam Shazeer']);
      assert.equal(meta.year, 2017);
      assert.equal(meta.doi, '10.48550/arXiv.1706.03762');
      assert.equal(meta.arxivId, '1706.03762');
      assert.equal(meta.venue, 'NeurIPS');
    });

    it('handles missing optional fields', () => {
      const meta = toPaperMeta(makeHit({
        year: undefined,
        doi: undefined,
        arxivId: '2401.01234',
        venue: undefined,
        abstract: undefined,
      }));
      assert.equal(meta.year, undefined);
      assert.equal(meta.doi, undefined);
      assert.equal(meta.arxivId, '2401.01234');
      assert.equal(meta.venue, undefined);
    });
  });
});

describe('papers/sources/direct_url', () => {
  it('resolves a file.scholarin.cn direct URL', async () => {
    const id: ParsedIdentifier = {
      kind: 'url',
      value: 'https://file.scholarin.cn/preview2?file=editor_cj_abc.pdf',
    };
    const candidate = await directUrlSource.resolve(id);
    assert.ok(candidate);
    assert.equal(candidate!.source, 'direct_url');
    assert.equal(candidate!.pdfUrl, id.value);
  });

  it('skips pubscholar.cn hosts (let pubscholar source handle)', async () => {
    const id: ParsedIdentifier = {
      kind: 'url',
      value: 'https://pubscholar.cn/articles/af1c6d1583347f229da8768f47a77bde',
    };
    const candidate = await directUrlSource.resolve(id);
    assert.equal(candidate, null);
  });

  it('returns null for non-URL kinds', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.1/test', doi: '10.1/test' };
    const candidate = await directUrlSource.resolve(id);
    assert.equal(candidate, null);
  });
});

describe('papers/sources/pubscholar', () => {
  it('returns null for non-PubScholar URLs', async () => {
    const id: ParsedIdentifier = {
      kind: 'url',
      value: 'https://example.com/some-article',
    };
    const candidate = await pubscholarSource.resolve(id);
    assert.equal(candidate, null);
  });

  it('returns null for non-URL kinds', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.1/test', doi: '10.1/test' };
    const candidate = await pubscholarSource.resolve(id);
    assert.equal(candidate, null);
  });

  it('attempts to resolve a pubscholar.cn/articles/ URL by probing the CDN', async function () {
    this.timeout(15_000);
    const id: ParsedIdentifier = {
      kind: 'url',
      value: 'https://pubscholar.cn/articles/0000000000000000000000000000000000000000000000000000000000000000',
    };
    const candidate = await pubscholarSource.resolve(id);
    assert.equal(candidate, null);
  });
});

describe('papers/buildManualDownloadUrls', () => {
  it('builds publisher + ScienceDirect URLs for an Elsevier DOI', () => {
    const parsed: ParsedIdentifier = {
      kind: 'doi', value: '10.1016/0967-0661(94)90625-4', doi: '10.1016/0967-0661(94)90625-4',
    };
    const urls = buildManualDownloadUrls(parsed);
    const labels = urls.map(u => u.label);
    assert.ok(labels.includes('Publisher (DOI)'), `expected Publisher (DOI), got ${labels.join(', ')}`);
    assert.ok(labels.includes('ScienceDirect'), `expected ScienceDirect, got ${labels.join(', ')}`);
    assert.ok(labels.includes('Google Scholar'));
    assert.ok(labels.includes('Semantic Scholar'));
    assert.ok(labels.includes('ResearchGate'));
    const sci = urls.find(u => u.label === 'ScienceDirect')!;
    assert.ok(sci.url.includes('sciencedirect.com/science/article/pii/'));
    const doi = urls.find(u => u.label === 'Publisher (DOI)')!;
    assert.equal(doi.url, 'https://doi.org/10.1016/0967-0661(94)90625-4');
  });

  it('adds Wiley, IEEE, ACM, Springer direct links when DOI matches', () => {
    const wiley = buildManualDownloadUrls({ kind: 'doi', value: '10.1002/abc.123', doi: '10.1002/abc.123' });
    assert.ok(wiley.some(u => u.label === 'Wiley Online'));
    const ieee = buildManualDownloadUrls({ kind: 'doi', value: '10.1109/abc.123', doi: '10.1109/abc.123' });
    assert.ok(ieee.some(u => u.label === 'IEEE Xplore'));
    const acm = buildManualDownloadUrls({ kind: 'doi', value: '10.1145/abc.123', doi: '10.1145/abc.123' });
    assert.ok(acm.some(u => u.label === 'ACM Digital Library'));
    const springer = buildManualDownloadUrls({ kind: 'doi', value: '10.1007/abc.123', doi: '10.1007/abc.123' });
    assert.ok(springer.some(u => u.label === 'SpringerLink'));
  });

  it('adds arXiv abstract URL for arXiv IDs', () => {
    const urls = buildManualDownloadUrls({ kind: 'arxiv', value: '2401.01234', arxivId: '2401.01234' });
    assert.ok(urls.some(u => u.label === 'arXiv abstract' && u.url.endsWith('/abs/2401.01234')));
  });

  it('adds PubMed URL for PMIDs', () => {
    const urls = buildManualDownloadUrls({ kind: 'pmid', value: '12345678', pmid: '12345678' });
    assert.ok(urls.some(u => u.label === 'PubMed' && u.url.includes('12345678')));
  });

  it('adds Chinese sources (Baidu Scholar, CNKI, Wanfang) when meta has CJK text', () => {
    const parsed: ParsedIdentifier = { kind: 'doi', value: '10.x/test', doi: '10.x/test' };
    const meta: PaperMeta = {
      title: '模糊控制机器人导航',
      authors: ['张三'],
      year: 2010,
      doi: '10.x/test',
    };
    const urls = buildManualDownloadUrls(parsed, meta);
    const labels = urls.map(u => u.label);
    assert.ok(labels.includes('Baidu Scholar (百度学术)'));
    assert.ok(labels.includes('CNKI (知网)'));
    assert.ok(labels.includes('Wanfang (万方)'));
  });

  it('omits Chinese sources for English-only meta', () => {
    const parsed: ParsedIdentifier = { kind: 'doi', value: '10.x/test', doi: '10.x/test' };
    const meta: PaperMeta = {
      title: 'Fuzzy control of mobile robots',
      authors: ['Smith, John'],
      year: 2010,
      doi: '10.x/test',
    };
    const urls = buildManualDownloadUrls(parsed, meta);
    assert.ok(!urls.some(u => u.label === 'Baidu Scholar (百度学术)'));
  });

  it('dedupes identical URLs', () => {
    const parsed: ParsedIdentifier = { kind: 'doi', value: '10.1016/abc', doi: '10.1016/abc' };
    const urls = buildManualDownloadUrls(parsed);
    const unique = new Set(urls.map(u => u.url));
    assert.equal(unique.size, urls.length);
  });
});
