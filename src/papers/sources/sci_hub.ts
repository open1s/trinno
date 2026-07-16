import type { PaperSource, SourceCandidate, ParsedIdentifier, PaperMeta } from '../types';
import { httpRequest } from '../../bos/infrastructure/http/http_client.js';

const SCIHUB_DOMAINS = ['sci-hub.st', 'sci-hub.ru', 'sci-hub.se', 'sci-hub.ee'];

function getDownloadUrl(parsed: ParsedIdentifier): string | null {
  if (parsed.kind === 'doi' && parsed.doi) {
    return `https://sci-hub.st/${parsed.doi}`;
  }
  if (parsed.kind === 'url' && parsed.value) {
    const match = parsed.value.match(/(10\.[\d]{4,}\/[^\s"'?#]+)/);
    if (match) return `https://sci-hub.st/${match[1]}`;
    return `https://sci-hub.st/${encodeURIComponent(parsed.value)}`;
  }
  if (parsed.kind === 'pmid' && parsed.pmid) {
    return `https://sci-hub.st/pmid/${parsed.pmid}`;
  }
  return null;
}

export const sciHubSource: PaperSource = {
  name: 'sci-hub',
  rank: 6,
  timeoutMs: 25_000,
  async resolve(id: ParsedIdentifier, signal?: AbortSignal): Promise<SourceCandidate | null> {
    const url = getDownloadUrl(id);
    if (!url) return null;

    for (const domain of SCIHUB_DOMAINS) {
      const domainUrl = url.replace('sci-hub.st', domain);

      try {
        const res = await httpRequest({
          url: domainUrl,
          signal,
          timeoutMs: 15_000,
          maxRetries: 0,
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/pdf,*/*',
          },
        });

        if (res.status < 200 || res.status >= 300) continue;

        if (res.contentType?.includes('application/pdf') || res.contentType?.includes('application/octet-stream')) {
          return { source: 'sci-hub', pdfUrl: domainUrl };
        }

        if (res.contentType?.includes('text/html')) {
          const htmlText = res.body.toString('utf-8');
          if (!htmlText) continue;

          if (htmlText.includes('DDoS-Guard') || htmlText.includes('ddos-guard') ||
              htmlText.includes('Just a moment...') || htmlText.includes('cf-browser-verify')) {
            continue;
          }

          const iframeMatch = htmlText.match(/(?:iframe|embed)\s+[^>]*?src=["']([^"']+)/i) ||
            htmlText.match(/src=["']([^"']+\.pdf[^"']*)["']/i);

          if (iframeMatch) {
            let pdfUrl = iframeMatch[1]!;
            if (pdfUrl.startsWith('//')) pdfUrl = 'https:' + pdfUrl;
            else if (pdfUrl.startsWith('/')) {
              pdfUrl = `https://${domain}${pdfUrl}`;
            }
            return { source: 'sci-hub', pdfUrl };
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  },
};