import type { ParsedIdentifier, IdentifierKind } from './types';

const DOI_RE = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i;
const ARXIV_OLD = /\barXiv:(\d{4}\.\d{4,5}(v\d+)?)\b/i;
const ARXIV_BARE = /^(\d{4}\.\d{4,5}(v\d+)?)$/;
const PMID_RE = /\bPMID:?\s*(\d{1,9})\b/i;

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
    const ax = trimmed.match(ARXIV_OLD);
    if (ax && ax[1]) {
      return { kind: 'arxiv', value: ax[1], arxivId: ax[1] };
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
