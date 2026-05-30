export type IdentifierKind = 'doi' | 'arxiv' | 'pmid' | 'url' | 'unknown';

export interface ParsedIdentifier {
  kind: IdentifierKind;
  value: string;
  doi?: string;
  arxivId?: string;
  pmid?: string;
}

export interface PaperMeta {
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  pmid?: string;
  venue?: string;
  abstract?: string;
  url?: string;
}

export interface SourceCandidate {
  source: string;
  pdfUrl: string;
  format?: string;
  meta?: PaperMeta;
  license?: string;
}

export interface ManualUrl {
  label: string;
  url: string;
}

export interface DownloadResult {
  ok: boolean;
  source?: string;
  filePath?: string;
  bytes?: number;
  format?: string;
  meta?: PaperMeta;
  error?: string;
  attempts?: { source: string; error: string }[];
  manualUrls?: ManualUrl[];
}

export interface DownloadOptions {
  outputDir: string;
  identifier: string;
  sources?: PaperSource[];
  email?: string;
  signal?: AbortSignal;
  onSourceStart?: (source: string) => void;
  onSourceFail?: (source: string, error: string) => void;
}

export interface PaperSource {
  name: string;
  resolve(identifier: ParsedIdentifier, signal?: AbortSignal): Promise<SourceCandidate | null>;
  rank: number;
  timeoutMs: number;
}
