import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getLogger } from '../logging/logger.js';

const log = getLogger();

let proxyInitialized = false;

function ensureProxy(): void {
  if (proxyInitialized) return;
  proxyInitialized = true;
  try {
    const { setupProxy } = require('../search/proxy_fetch.js');
    setupProxy();
  } catch { }
}

export interface HttpRequestOptions {
  /** URL to fetch */
  url: string;
  /** Request method (default: 'GET') */
  method?: string;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body (for POST/PUT) */
  requestBody?: string | Buffer;
  /** AbortSignal for cancellation */
  signal?: AbortSignal | undefined;
  /** Total timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Max redirects to follow (default: 20) */
  maxRedirects?: number;
  /** Accept header — if not provided, defaults to broad Accept */
  accept?: string;
  /** User-Agent string */
  userAgent?: string;
  /** Max retries on transient failures (default: 3) */
  maxRetries?: number;
  /** Retry backoff base ms (default: 500) */
  retryBackoffMs?: number;
  /** Retry on HTTP status codes in this list */
  retryOnStatus?: number[];
  /** Allow downloading to resume (sets Range header) */
  resumeFrom?: number;
  /** Path to cookie jar file for persistence */
  cookieJarPath?: string;
  /** If true, follow redirects; if false, manual; if 'auto', use built-in (default: 'auto') */
  redirect?: 'auto' | 'manual' | false;
  /** Disable TLS certificate verification */
  insecureTls?: boolean;
}

export interface HttpResponse {
  /** Final URL after redirects */
  url: string;
  /** HTTP status code */
  status: number;
  /** Response headers (lowercase keys) */
  headers: Record<string, string>;
  /** Response body as Buffer */
  body: Buffer;
  /** Content-Type (cleaned, no params) */
  contentType: string | null;
  /** Content-Length in bytes */
  contentLength: number | null;
  /** Set-Cookie headers collected */
  cookies: Array<{ name: string; value: string }>;
}

const DEFAULT_UA = 'trinno-research/1.0 (mailto:trinno-research@example.com)';
const DEFAULT_ACCEPT = 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip,application/epub+zip,application/octet-stream,text/html,text/plain,image/*;q=0.8,*/*;q=0.5';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function resolveCookieJarPath(): string | null {
  return path.join(os.homedir(), '.trinno', 'cookie-jar.json');
}

function loadCookieJar(filePath: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  const p = filePath || resolveCookieJarPath();
  if (!p) return jar;
  try {
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry?.name && entry?.value) jar.set(entry.name, entry.value);
        }
      }
    }
  } catch {
    log.warn({ cookieJarPath: p }, 'failed to load cookie jar');
  }
  return jar;
}

function saveCookieJar(jar: Map<string, string>, filePath: string | undefined): void {
  const p = filePath || resolveCookieJarPath();
  if (!p) return;
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const entries = Array.from(jar.entries()).map(([name, value]) => ({ name, value }));
    fs.writeFileSync(p, JSON.stringify(entries), 'utf-8');
  } catch {
    log.warn({ cookieJarPath: p }, 'failed to save cookie jar');
  }
}

function parseSetCookie(header: string): { name: string; value: string } | null {
  const eq = header.indexOf('=');
  if (eq <= 0) return null;
  const name = header.substring(0, eq).trim();
  const semicolon = header.indexOf(';', eq);
  const value = semicolon >= 0 ? header.substring(eq + 1, semicolon).trim() : header.substring(eq + 1).trim();
  return name ? { name, value } : null;
}

function mergeCookies(jar: Map<string, string>, setCookies: string[]): void {
  for (const cs of setCookies) {
    const parsed = parseSetCookie(cs);
    if (parsed) jar.set(parsed.name, parsed.value);
  }
}

function buildCookieHeader(jar: Map<string, string>): string | undefined {
  if (jar.size === 0) return undefined;
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

function isRetryableStatus(status: number, extraStatuses?: number[]): boolean {
  if (RETRYABLE_STATUS.has(status)) return true;
  if (extraStatuses && extraStatuses.includes(status)) return true;
  return false;
}

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return true;
  if (msg.includes('abort') || msg.includes('aborted')) return false;
  if (msg.includes('econnreset') || msg.includes('econnrefused')) return true;
  if (msg.includes('enotfound') || msg.includes('enetunreach')) return true;
  if (msg.includes('socket') || msg.includes('network')) return true;
  if (msg.includes('fetch failed')) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function httpRequest(opts: HttpRequestOptions): Promise<HttpResponse> {
  ensureProxy();

  const {
    url,
    method = 'GET',
    headers = {},
    requestBody,
    signal,
    timeoutMs = 30_000,
    maxRedirects = 20,
    accept = DEFAULT_ACCEPT,
    userAgent = DEFAULT_UA,
    maxRetries = 3,
    retryBackoffMs = 500,
    retryOnStatus,
    resumeFrom,
    cookieJarPath,
    redirect = 'auto',
    insecureTls,
  } = opts;

  const cookieJar = loadCookieJar(cookieJarPath);

  const prevTls = process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
  const needsTlsRestore = insecureTls && prevTls !== '0';
  try {
    if (needsTlsRestore) process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new Error('Request aborted');

    try {
      if (attempt > 0) {
        const delay = retryBackoffMs * Math.pow(2, attempt - 1) + Math.random() * 100;
        await sleep(delay);
      }

      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      try {
        let currentUrl = url;
        const collectedCookies: Array<{ name: string; value: string }> = [];
        let finalResponse: { body: Buffer; contentType: string | null; url: string; status: number; headers: Record<string, string>; contentLength: number | null } | null = null;

        const doRedirect = redirect !== false && redirect !== 'manual';

        for (let hop = 0; hop <= maxRedirects; hop++) {
          const cookieHeader = doRedirect ? undefined : buildCookieHeader(cookieJar);
          const reqHeaders: Record<string, string> = {
            'User-Agent': userAgent,
            'Accept': accept,
            ...headers,
            ...(doRedirect ? {} : (cookieHeader ? { 'Cookie': cookieHeader } : {})),
          };

          if (resumeFrom !== undefined && resumeFrom > 0 && hop === 0) {
            reqHeaders['Range'] = `bytes=${resumeFrom}-`;
          }

          const fetchRes = await fetch(currentUrl, {
            method,
            signal: ctrl.signal,
            redirect: 'manual', // Always use manual to avoid Node.js fetch hang with large files
            headers: reqHeaders,
            ...(requestBody ? { body: requestBody } : {}),
          });

          if (!doRedirect) {
            const setCookies = fetchRes.headers.getSetCookie();
            mergeCookies(cookieJar, setCookies);
            for (const cs of setCookies) {
              const parsed = parseSetCookie(cs);
              if (parsed) collectedCookies.push(parsed);
            }
          }

          if (fetchRes.status >= 300 && fetchRes.status < 400) {
            const location = fetchRes.headers.get('location');
            if (!location) throw new Error(`Redirect ${fetchRes.status} without Location header`);
            currentUrl = new URL(location, currentUrl).href;
            if (doRedirect) continue;
            // When redirect is 'auto', we still need to follow manually
            // because we need to handle cookies and the body
            continue;
          }

          // Clear timeout before reading body (large files take time to download)
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);

          const ab = await fetchRes.arrayBuffer();
          const body = Buffer.from(ab);
          const contentType = (fetchRes.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase() || null;
          const contentLength = fetchRes.headers.get('content-length');
          const resHeaders: Record<string, string> = {};
          fetchRes.headers.forEach((v, k) => { resHeaders[k.toLowerCase()] = v; });

          finalResponse = { body, contentType, url: currentUrl, status: fetchRes.status, headers: resHeaders, contentLength: contentLength ? parseInt(contentLength, 10) : null };
          break;
        }

        if (!finalResponse) {
          throw new Error(`Too many redirects (${maxRedirects})`);
        }

        if (isRetryableStatus(finalResponse.status, retryOnStatus)) {
          throw new Error(`HTTP ${finalResponse.status}`);
        }

        saveCookieJar(cookieJar, cookieJarPath);

        return {
          url: finalResponse.url,
          status: finalResponse.status,
          headers: finalResponse.headers,
          body: finalResponse.body,
          contentType: finalResponse.contentType,
          contentLength: finalResponse.contentLength,
          cookies: collectedCookies,
        };
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    } catch (e: unknown) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (signal?.aborted) throw lastError;
      if (!isRetryableError(lastError)) throw lastError;
      if (attempt >= maxRetries) throw lastError;
    }
  }

  throw lastError || new Error('Unknown fetch error');
  } finally {
  if (needsTlsRestore) process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = prevTls;
}}
