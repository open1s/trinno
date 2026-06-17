import { setGlobalDispatcher, ProxyAgent } from 'undici';
import * as jsbos from '@open1s/jsbos';
import { createModuleLogger } from '../logging/logger.js';

const log = createModuleLogger('proxy');

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

    log.info({ proxyUrl }, 'Global fetch proxy set');
  } catch (err) {
    log.warn({ err }, 'Failed to load proxy config');
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