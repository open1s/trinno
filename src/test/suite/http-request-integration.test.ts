/**
 * Integration tests for httpRequest refactoring.
 * Tests that all paper sources work correctly after refactoring to use httpRequest.
 */

import { describe, it } from 'mocha';
import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { downloadPaper } from '../../papers/downloader';
import { searchOpenAlex } from '../../papers/search';
import { parseIdentifier, isResolvable } from '../../papers/identifier';
import { raceSources } from '../../papers/racer';
import { openalexSource } from '../../papers/sources/openalex';
import { zenodoSource } from '../../papers/sources/zenodo';
import { biorxivSource } from '../../papers/sources/biorxiv';
import { arxivSource } from '../../papers/sources/arxiv';
import { crossrefSource } from '../../papers/sources/crossref';
import { semanticScholarSource } from '../../papers/sources/semantic_scholar';
import { europePmcSource } from '../../papers/sources/europe_pmc';
import { UnpaywallSource } from '../../papers/sources/unpaywall';
import { publisherDirectSource } from '../../papers/sources/publisher_direct';
import { pubscholarSource } from '../../papers/sources/pubscholar';
import { directUrlSource } from '../../papers/sources/direct_url';
import { httpRequest } from '../../bos/infrastructure/http/http_client';
import type { ParsedIdentifier, PaperSource } from '../../papers/types';

describe('httpRequest integration: searchOpenAlex', function () {
  this.timeout(30_000);

  it('searches OpenAlex API and returns results', async () => {
    const hits = await searchOpenAlex('attention is all you need', 3);
    assert.ok(hits.length > 0, 'Expected at least 1 result');
    assert.ok(hits[0]!.title.length > 0, 'Expected title to be non-empty');
    assert.ok(hits[0]!.authors.length > 0, 'Expected authors to be non-empty');
  });
});

describe('httpRequest integration: openalexSource', function () {
  this.timeout(30_000);

  it('resolves a DOI via OpenAlex', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.48550/arXiv.1706.03762', doi: '10.48550/arXiv.1706.03762' };
    const candidate = await openalexSource.resolve(id);
    // May return null if no OA PDF available, but should not throw
    if (candidate) {
      assert.ok(candidate.pdfUrl.length > 0, 'Expected pdfUrl to be non-empty');
      assert.ok(candidate.meta?.title && candidate.meta.title.length > 0, 'Expected title to be non-empty');
    }
  });

  it('resolves an arXiv ID via OpenAlex', async () => {
    const id: ParsedIdentifier = { kind: 'arxiv', value: '1706.03762', arxivId: '1706.03762' };
    const candidate = await openalexSource.resolve(id);
    if (candidate) {
      assert.ok(candidate.pdfUrl.length > 0, 'Expected pdfUrl to be non-empty');
    }
  });
});

describe('httpRequest integration: biorxivSource', function () {
  this.timeout(30_000);

  it('resolves a bioRxiv DOI', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.1101/2023.01.01.522437', doi: '10.1101/2023.01.01.522437' };
    const candidate = await biorxivSource.resolve(id);
    // May return null if DOI doesn't exist, but should not throw
    if (candidate) {
      assert.ok(candidate.pdfUrl.length > 0, 'Expected pdfUrl to be non-empty');
      assert.ok(candidate.meta?.title && candidate.meta.title.length > 0, 'Expected title to be non-empty');
    }
  });
});

describe('httpRequest integration: arxivSource', function () {
  this.timeout(30_000);

  it('resolves an arXiv DOI', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.48550/arXiv.1706.03762', doi: '10.48550/arXiv.1706.03762' };
    const candidate = await arxivSource.resolve(id);
    if (candidate) {
      assert.ok(candidate.pdfUrl.length > 0, 'Expected pdfUrl to be non-empty');
      assert.ok(candidate.pdfUrl.includes('arxiv.org'), 'Expected arXiv URL');
    }
  });

  it('resolves a bare arXiv ID', async () => {
    const id: ParsedIdentifier = { kind: 'arxiv', value: '1706.03762', arxivId: '1706.03762' };
    const candidate = await arxivSource.resolve(id);
    if (candidate) {
      assert.ok(candidate.pdfUrl.length > 0, 'Expected pdfUrl to be non-empty');
      assert.ok(candidate.pdfUrl.includes('arxiv.org'), 'Expected arXiv URL');
    }
  });
});

describe('httpRequest integration: pubscholarSource', function () {
  this.timeout(30_000);

  it('returns null for non-PubScholar URLs', async () => {
    const id: ParsedIdentifier = {
      kind: 'url',
      value: 'https://example.com/some-article',
    };
    const candidate = await pubscholarSource.resolve(id);
    assert.equal(candidate, null, 'Expected null for non-PubScholar URL');
  });

  it('returns null for non-URL kinds', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.1/test', doi: '10.1/test' };
    const candidate = await pubscholarSource.resolve(id);
    assert.equal(candidate, null, 'Expected null for non-URL kind');
  });
});

describe('httpRequest integration: directUrlSource', function () {
  this.timeout(30_000);

  it('resolves a direct file URL', async () => {
    const id: ParsedIdentifier = {
      kind: 'url',
      value: 'https://file.scholarin.cn/preview2?file=editor_cj_test.pdf',
    };
    const candidate = await directUrlSource.resolve(id);
    if (candidate) {
      assert.equal(candidate.source, 'direct_url', 'Expected direct_url source');
      assert.ok(candidate.pdfUrl.length > 0, 'Expected pdfUrl to be non-empty');
    }
  });

  it('returns null for pubscholar.cn hosts', async () => {
    const id: ParsedIdentifier = {
      kind: 'url',
      value: 'https://pubscholar.cn/articles/af1c6d1583347f229da8768f47a77bde',
    };
    const candidate = await directUrlSource.resolve(id);
    assert.equal(candidate, null, 'Expected null for pubscholar host');
  });

  it('returns null for non-URL kinds', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.1/test', doi: '10.1/test' };
    const candidate = await directUrlSource.resolve(id);
    assert.equal(candidate, null, 'Expected null for non-URL kind');
  });

  it('allows both HTTP and HTTPS URLs', async () => {
    const id: ParsedIdentifier = {
      kind: 'url',
      value: 'http://example.com/file.pdf',
    };
    const candidate = await directUrlSource.resolve(id);
    // directUrlSource accepts both HTTP and HTTPS
    if (candidate) {
      assert.equal(candidate.source, 'direct_url', 'Expected direct_url source');
      assert.ok(candidate.pdfUrl.length > 0, 'Expected pdfUrl to be non-empty');
    }
  });
});

describe('httpRequest integration: zenodoSource', function () {
  this.timeout(30_000);

  it('resolves a Zenodo DOI', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.5281/zenodo.1234567', doi: '10.5281/zenodo.1234567' };
    const candidate = await zenodoSource.resolve(id);
    // May return null if record doesn't exist, but should not throw
    if (candidate) {
      assert.ok(candidate.pdfUrl.length > 0, 'Expected pdfUrl to be non-empty');
    }
  });
});

describe('httpRequest integration: crossrefSource', function () {
  this.timeout(30_000);

  it('resolves a DOI via Crossref', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.1038/nature12373', doi: '10.1038/nature12373' };
    const candidate = await crossrefSource.resolve(id);
    // May return null if no PDF link available, but should not throw
    if (candidate) {
      assert.ok(candidate.pdfUrl.length > 0, 'Expected pdfUrl to be non-empty');
      assert.ok(candidate.meta?.title && candidate.meta.title.length > 0, 'Expected title to be non-empty');
    }
  });
});

describe('httpRequest integration: semanticScholarSource', function () {
  this.timeout(30_000);

  it('resolves a DOI via Semantic Scholar', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.48550/arXiv.1706.03762', doi: '10.48550/arXiv.1706.03762' };
    const candidate = await semanticScholarSource.resolve(id);
    // May return null if no OA PDF, but should not throw
    if (candidate) {
      assert.ok(candidate.pdfUrl.length > 0, 'Expected pdfUrl to be non-empty');
      assert.ok(candidate.meta?.title && candidate.meta.title.length > 0, 'Expected title to be non-empty');
    }
  });
});

describe('httpRequest integration: europePmcSource', function () {
  this.timeout(30_000);

  it('resolves a DOI via Europe PMC', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.1038/nature12373', doi: '10.1038/nature12373' };
    const candidate = await europePmcSource.resolve(id);
    // May return null if not in Europe PMC, but should not throw
    if (candidate) {
      assert.ok(candidate.pdfUrl.length > 0, 'Expected pdfUrl to be non-empty');
    }
  });
});

describe('httpRequest integration: unpaywallSource', function () {
  this.timeout(30_000);

  it('resolves a DOI via Unpaywall', async () => {
    const unpaywall = new UnpaywallSource({ email: 'test@example.com' });
    const id: ParsedIdentifier = { kind: 'doi', value: '10.48550/arXiv.1706.03762', doi: '10.48550/arXiv.1706.03762' };
    const candidate = await unpaywall.resolve(id);
    // May return null if no OA PDF, but should not throw
    if (candidate) {
      assert.ok(candidate.pdfUrl.length > 0, 'Expected pdfUrl to be non-empty');
    }
  });
});

describe('httpRequest integration: publisherDirectSource', function () {
  this.timeout(30_000);

  it('resolves a Frontiers DOI', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.3389/fnins.2023.1234567', doi: '10.3389/fnins.2023.1234567' };
    const candidate = await publisherDirectSource.resolve(id);
    // May return null if article doesn't exist, but should not throw
    if (candidate) {
      assert.ok(candidate.pdfUrl.length > 0, 'Expected pdfUrl to be non-empty');
    }
  });

  it('resolves an MDPI DOI', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.3390/s24010234', doi: '10.3390/s24010234' };
    const candidate = await publisherDirectSource.resolve(id);
    // May return null if article doesn't exist, but should not throw
    if (candidate) {
      assert.ok(candidate.pdfUrl.length > 0, 'Expected pdfUrl to be non-empty');
    }
  });
});

describe('httpRequest integration: downloadPaper (end-to-end)', function () {
  this.timeout(60_000);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trinno-test-'));

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves zenodo paper source (integration test)', async () => {
    const result = await downloadPaper({ identifier: '10.5281/zenodo.12345', outputDir: tmpDir });
    if (result.ok) {
      assert.ok(result.filePath && result.filePath.length > 0, 'Expected filePath to be non-empty');
      assert.ok(result.bytes && result.bytes > 0, 'Expected bytes to be > 0');
      console.log(`Downloaded zenodo paper: ${result.filePath} (${result.bytes} bytes)`);
    } else {
      console.log(`Download failed: ${result.error}`);
      assert.ok(result.attempts && result.attempts.length > 0, 'Expected at least one source attempt');
    }
  });

  it('resolves DOI paper source (integration test)', async () => {
    const result = await downloadPaper({ identifier: '10.5281/zenodo.7020', outputDir: tmpDir });
    if (result.ok) {
      assert.ok(result.filePath && result.filePath.length > 0, 'Expected filePath to be non-empty');
      assert.ok(result.bytes && result.bytes > 0, 'Expected bytes to be > 0');
      console.log(`Downloaded DOI paper: ${result.filePath} (${result.bytes} bytes)`);
    } else {
      console.log(`Download failed: ${result.error}`);
      assert.ok(result.attempts && result.attempts.length > 0, 'Expected at least one source attempt');
    }
  });
});

describe('httpRequest wrapper tests', function () {
  this.timeout(30_000);

  it('handles JSON response correctly', async () => {
    const res = await httpRequest({
      url: 'https://api.openalex.org/works?search=test&per_page=1',
      timeoutMs: 15000,
      maxRetries: 0,
    });
    assert.ok(res.status >= 200 && res.status < 300, 'Expected 2xx status');
    assert.ok(res.body.length > 0, 'Expected non-empty body');
    const data = JSON.parse(res.body.toString('utf-8'));
    assert.ok(data.results, 'Expected results array in response');
  });

  it('handles redirect with redirect:auto', async () => {
    // arxiv.org redirects from /pdf/xxx.pdf to /pdf/xxx
    const res = await httpRequest({
      url: 'https://arxiv.org/pdf/1706.03762v7.pdf',
      timeoutMs: 15000,
      redirect: 'auto',
      maxRetries: 0,
    });
    // Should either succeed or return a redirect status (301/302)
    assert.ok(res.status >= 200 && res.status < 400, 'Expected success or redirect status');
  });

  it('handles non-200 status without throwing', async () => {
    const res = await httpRequest({
      url: 'https://api.openalex.org/works?invalid_param=test',
      timeoutMs: 15000,
      maxRetries: 0,
    });
    // Should return the response without throwing
    assert.ok(res.status > 0, 'Expected a status code');
  });

  it('returns correct content-type', async () => {
    const res = await httpRequest({
      url: 'https://api.openalex.org/works?search=test&per_page=1',
      timeoutMs: 15000,
      maxRetries: 0,
      accept: 'application/json',
    });
    assert.ok(res.contentType, 'Expected content-type header');
    assert.ok(res.contentType.includes('json'), 'Expected JSON content-type');
  });

  it('handles signal for cancellation', async () => {
    const ctrl = new AbortController();
    // Abort immediately
    ctrl.abort();
    
    try {
      await httpRequest({
        url: 'https://api.openalex.org/works?search=test',
        signal: ctrl.signal,
        timeoutMs: 10000,
        maxRetries: 0,
      });
      assert.fail('Expected error to be thrown');
    } catch (e: any) {
      assert.ok(e.message.includes('abort') || e.message.includes('cancelled'), 'Expected abort error');
    }
  });
});

describe('parseIdentifier integration', function () {
  it('parses DOI correctly', () => {
    const id = parseIdentifier('10.1038/nature12373');
    assert.equal(id.kind, 'doi');
    assert.equal(id.doi, '10.1038/nature12373');
    assert.ok(isResolvable(id));
  });

  it('parses arXiv ID correctly', () => {
    const id = parseIdentifier('1706.03762');
    assert.equal(id.kind, 'arxiv');
    assert.equal(id.arxivId, '1706.03762');
    assert.ok(isResolvable(id));
  });

  it('parses DOI URL correctly', () => {
    const id = parseIdentifier('https://doi.org/10.1038/nature12373');
    assert.equal(id.kind, 'doi');
    assert.equal(id.doi, '10.1038/nature12373');
    assert.ok(isResolvable(id));
  });

  it('parses PMID correctly', () => {
    const id = parseIdentifier('PMID:12345678');
    assert.equal(id.kind, 'pmid');
    assert.equal(id.pmid, '12345678');
    assert.ok(isResolvable(id));
  });
});

describe('raceSources integration', function () {
  this.timeout(30_000);

  it('resolves paper via fastest source', async () => {
    const id = parseIdentifier('10.48550/arXiv.1706.03762');
    const sources: PaperSource[] = [arxivSource, openalexSource];
    
    const result = await raceSources({ identifier: id, sources });
    assert.ok(result, 'Expected race result');
    assert.ok(result!.candidates.length > 0, 'Expected at least one candidate');
    assert.ok(result!.candidates[0]!.pdfUrl.length > 0, 'Expected pdfUrl in first candidate');
  });

  it('handles all sources failing gracefully', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.9999/invalid', doi: '10.9999/invalid' };
    const sources: PaperSource[] = [openalexSource, crossrefSource];
    
    const result = await raceSources({ identifier: id, sources });
    // Should still return a result (possibly with failures)
    assert.ok(result !== undefined, 'Expected race to complete');
  });

  it('collects failures from sources', async () => {
    const id: ParsedIdentifier = { kind: 'doi', value: '10.9999/nonexistent', doi: '10.9999/nonexistent' };
    const sources: PaperSource[] = [openalexSource];
    
    const result = await raceSources({ identifier: id, sources });
    // Even if no candidates found, failures should be tracked
    if (result) {
      // Failures array should exist
      assert.ok(Array.isArray(result.failures), 'Expected failures array');
    }
  });
});