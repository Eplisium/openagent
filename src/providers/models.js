/**
 * 📚 Provider model discovery + auth header helpers.
 *
 * fetchProviderModels() calls `GET {baseURL}/models` with a short timeout and
 * caches results in memory. Failures resolve to [] (never throw) so a stopped
 * local server or a bad key can't break the model browser.
 */

import { getApiKey, getProviders, isConfigured, routingPrefixFor, DEFAULT_PROVIDER_ID } from './registry.js';

const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 30 * 1000;
const _modelsCache = new Map(); // providerId|baseURL -> { at, ttl, models }

/**
 * Auth + provider headers for a request.
 * @param {object} provider
 * @param {string} apiKey
 * @param {object} [extra] - headers merged first (provider headers win for auth)
 */
export function buildProviderHeaders(provider, apiKey, extra = {}) {
  const headers = { ...extra, ...(provider?.headers || {}) };
  if (provider?.kind === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey;
    if (!headers['anthropic-version']) headers['anthropic-version'] = '2023-06-01';
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

/** Path for chat requests on a provider. */
export function chatPathFor(provider) {
  return provider?.kind === 'anthropic' ? '/messages' : '/chat/completions';
}

export function clearModelsCache() {
  _modelsCache.clear();
}

function normalizeModelEntry(provider, raw, prefix) {
  const id = typeof raw === 'string' ? raw : (raw?.id || raw?.name || raw?.model);
  if (!id || typeof id !== 'string') return null;
  const cleanId = id.replace(/^models\//, ''); // Gemini returns "models/gemini-..."
  const label = raw?.display_name || (raw?.name && raw.name !== id ? raw.name : cleanId);
  return {
    id: `${prefix}${cleanId}`,
    rawId: cleanId,
    name: `${provider.name || provider.id}: ${label}`,
    providerId: provider.id,
    local: Boolean(provider.local),
    contextLength: raw?.context_length || raw?.context_window || raw?.max_context_length || 0,
    created: typeof raw?.created === 'number' ? raw.created : (raw?.created_at ? Math.floor(Date.parse(raw.created_at) / 1000) || undefined : undefined),
  };
}

/**
 * List models for one provider. Resolves to [] on any failure.
 * @param {object} provider
 * @param {object} [options] - { timeoutMs, env, force, fetchImpl }
 */
export async function fetchProviderModels(provider, options = {}) {
  if (!provider || !provider.supportsModelsList) return [];
  const env = options.env || process.env;
  const timeoutMs = options.timeoutMs ?? (provider.local ? 1500 : 4000);
  const key = `${provider.id}|${provider.baseURL}`;
  const cached = _modelsCache.get(key);
  if (!options.force && cached && Date.now() - cached.at < cached.ttl) return cached.models;

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let models = [];
  let ok = false;
  try {
    const apiKey = getApiKey(provider, env);
    const query = provider.kind === 'anthropic' ? '?limit=1000' : '';
    const res = await fetchImpl(`${provider.baseURL}/models${query}`, {
      method: 'GET',
      headers: buildProviderHeaders(provider, apiKey, { Accept: 'application/json' }),
      signal: controller.signal,
    });
    if (res && res.ok) {
      const body = await res.json();
      const list = Array.isArray(body) ? body : (Array.isArray(body?.data) ? body.data : (Array.isArray(body?.models) ? body.models : []));
      const prefix = routingPrefixFor(provider, env);
      models = list.map((m) => normalizeModelEntry(provider, m, prefix)).filter(Boolean);
      ok = true;
    }
  } catch (_e) {
    models = []; // unreachable / timeout / bad JSON → silent
  } finally {
    clearTimeout(timer);
  }
  _modelsCache.set(key, { at: Date.now(), ttl: ok ? MODELS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS, models });
  return models;
}

/**
 * Models from every configured non-OpenRouter provider, ids prefixed for routing.
 * @param {object} [options] - { providers, env, timeoutMs, includeRemote }
 */
export async function fetchDirectProviderModels(options = {}) {
  const env = options.env || process.env;
  const includeRemote = options.includeRemote !== false;
  const providers = (options.providers || getProviders())
    .filter((p) => p.id !== DEFAULT_PROVIDER_ID && p.supportsModelsList)
    .filter((p) => (p.local ? true : includeRemote && isConfigured(p, env)));
  const results = await Promise.all(providers.map((p) => fetchProviderModels(p, { ...options, env })));
  return results.flat();
}

export default { buildProviderHeaders, chatPathFor, fetchProviderModels, fetchDirectProviderModels, clearModelsCache };
