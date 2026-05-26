import { setGlobalDispatcher, ProxyAgent } from 'undici';
import * as jsbos from '@open1s/jsbos';

let bootstrapped = false;

export function setupProxy(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  try {
    const loader = new jsbos.ConfigLoader();
    loader.discover();
    const configJson = loader.loadSync();
    const config = JSON.parse(configJson);

    const proxyConfig = config?.proxy as Record<string, string> | undefined;
    if (!proxyConfig) return;

    const proxyUrl = proxyConfig.http_proxy || proxyConfig.https_proxy || '';
    if (!proxyUrl) return;

    const agent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(agent);

    console.log(`[proxy] Global fetch proxy set to ${proxyUrl}`);
  } catch (err) {
    console.warn(`[proxy] Failed to load proxy config: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function isProxyConfigured(): boolean {
  try {
    const loader = new jsbos.ConfigLoader();
    loader.discover();
    const config = JSON.parse(loader.loadSync());
    return !!(config?.proxy?.http_proxy || config?.proxy?.https_proxy);
  } catch {
    return false;
  }
}