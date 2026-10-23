/**
 * 🩺 Provider status — backing data for a future `/providers` command.
 */

import { getProviders, isConfigured, routingPrefixFor, getDefaultProviderId, getApiKey } from './registry.js';
import { buildProviderHeaders } from './models.js';

/**
 * Probe a provider's `/models` endpoint. Any HTTP response (even 401) means reachable.
 * @returns {Promise<boolean>}
 */
export async function probeProvider(provider, { timeoutMs = 1500, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${provider.baseURL}/models`, {
      method: 'GET',
      headers: buildProviderHeaders(provider, getApiKey(provider, env), { Accept: 'application/json' }),
      signal: controller.signal,
    });
    return Boolean(res && typeof res.status === 'number');
  } catch (_e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * List all known providers with their configuration state.
 * @param {object} [options]
 * @param {boolean} [options.probe=false] - also check reachability (local providers by default; all with probe:'all')
 * @param {number} [options.timeoutMs=1500]
 * @param {object} [options.env]
 * @param {Array} [options.providers] - override provider list (tests)
 * @returns {Promise<Array<{id, name, kind, baseURL, configured, local, isDefault, source, apiKeyEnv, modelPrefix, reachable?}>>}
 */
export async function listProviders(options = {}) {
  const env = options.env || process.env;
  const providers = options.providers || getProviders();
  const defaultId = getDefaultProviderId(env);
  const rows = providers.map((p) => ({
    id: p.id,
    name: p.name || p.id,
    kind: p.kind,
    baseURL: p.baseURL,
    configured: isConfigured(p, env),
    local: Boolean(p.local),
    isDefault: p.id === defaultId,
    source: p.source || 'builtin',
    apiKeyEnv: p.apiKeyEnv || null,
    modelPrefix: routingPrefixFor(p, env),
  }));
  if (!options.probe) return rows;

  await Promise.all(rows.map(async (row, i) => {
    const shouldProbe = options.probe === 'all' ? row.configured : row.local;
    if (!shouldProbe) return;
    row.reachable = await probeProvider(providers[i], { timeoutMs: options.timeoutMs ?? 1500, env, fetchImpl: options.fetchImpl });
  }));
  return rows;
}

export default { listProviders, probeProvider };
