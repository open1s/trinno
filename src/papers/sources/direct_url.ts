import type { PaperSource, SourceCandidate, ParsedIdentifier } from '../types';

const SPA_ONLY_HOSTS = ['pubscholar.cn', 'www.pubscholar.cn'];

function isSpaOnlyHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SPA_ONLY_HOSTS.includes(host);
  } catch {
    return false;
  }
}

export const directUrlSource: PaperSource = {
  name: 'direct_url',
  rank: 0,
  timeoutMs: 5_000,
  async resolve(id: ParsedIdentifier, _signal?: AbortSignal): Promise<SourceCandidate | null> {
    if (id.kind !== 'url' || !id.value) return null;
    if (!/^https?:\/\//i.test(id.value)) return null;
    if (isSpaOnlyHost(id.value)) return null;
    return { source: 'direct_url', pdfUrl: id.value };
  },
};
