import type { ParsedIdentifier, IdentifierKind } from './types';

const DOI_RE = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i;
const ARXIV_OLD = /\barXiv:(\d{4}\.\d{4,5}(v\d+)?)\b/i;
const ARXIV_BARE = /^(\d{4}\.\d{4,5}(v\d+)?)$/;
const PMID_RE = /\bPMID:?\s*(\d{1,9})\b/i;
// Host-specific URL forms — without these, arxiv.org/abs/… and pubmed.ncbi…
// fall through to the slow generic 'url' HTML-scrape path.
const ARXIV_URL_RE = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?/i;
const PMID_URL_RE = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,9})\b/i;

function cleanDoi(raw: string): string {
  return raw.replace(/[)\].,;]+$/, '').toLowerCase();
}

export function parseIdentifier(input: string): ParsedIdentifier {
  const trimmed = input.trim();
  if (!trimmed) return { kind: 'unknown', value: '' };

  if (/^https?:\/\//i.test(trimmed)) {
    const doi = trimmed.match(DOI_RE);
    if (doi && doi[1]) {
      return { kind: 'doi', value: cleanDoi(doi[1]), doi: cleanDoi(doi[1]) };
    }
    const axUrl = trimmed.match(ARXIV_URL_RE);
    if (axUrl && axUrl[1]) {
      const value = axUrl[1] + (axUrl[2] || '');
      return { kind: 'arxiv', value, arxivId: value };
    }
    const ax = trimmed.match(ARXIV_OLD);
    if (ax && ax[1]) {
      return { kind: 'arxiv', value: ax[1], arxivId: ax[1] };
    }
    const pmUrl = trimmed.match(PMID_URL_RE);
    if (pmUrl && pmUrl[1]) {
      return { kind: 'pmid', value: pmUrl[1], pmid: pmUrl[1] };
    }
    const pm = trimmed.match(PMID_RE);
    if (pm && pm[1]) {
      return { kind: 'pmid', value: pm[1], pmid: pm[1] };
    }
    return { kind: 'url', value: trimmed };
  }

  const doi = trimmed.match(DOI_RE);
  if (doi && doi[1]) {
    const cleaned = cleanDoi(doi[1]);
    return { kind: 'doi', value: cleaned, doi: cleaned };
  }

  const axOld = trimmed.match(ARXIV_OLD);
  if (axOld && axOld[1]) {
    return { kind: 'arxiv', value: axOld[1], arxivId: axOld[1] };
  }
  if (ARXIV_BARE.test(trimmed)) {
    return { kind: 'arxiv', value: trimmed, arxivId: trimmed };
  }

  const pm = trimmed.match(PMID_RE);
  if (pm && pm[1]) {
    return { kind: 'pmid', value: pm[1], pmid: pm[1] };
  }

  return { kind: 'unknown' as IdentifierKind, value: trimmed };
}

export function isResolvable(id: ParsedIdentifier): boolean {
  return id.kind === 'doi' || id.kind === 'arxiv' || id.kind === 'pmid' || id.kind === 'url';
}
