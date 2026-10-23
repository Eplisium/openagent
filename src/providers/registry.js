/**
 * 🔌 Provider Registry
 *
 * Built-in LLM provider definitions plus user/project custom providers, and the
 * model-id routing rules that decide which provider serves a request.
 *
 * Routing scheme (see docs/PROVIDERS.md):
 *   1. `<id>-direct/<model>`  → always provider <id> (explicit, any non-OpenRouter provider).
 *   2. `<id>/<model>` where <id> is a known non-OpenRouter provider:
 *        - if <id> is ALSO an OpenRouter vendor namespace (openai, anthropic, deepseek),
 *          it stays on OpenRouter unless OPENAGENT_PROVIDER_<ID>=direct is set;
 *        - otherwise it routes to <id> when that provider is configured
 *          (API key present, or a local provider like ollama/lmstudio).
 *   3. Anything else → the default provider (OPENAGENT_DEFAULT_PROVIDER, default
 *      `openrouter`) with the whole id unchanged.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export const DEFAULT_PROVIDER_ID = 'openrouter';
export const DIRECT_SUFFIX = '-direct';
export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Built-in providers.
 * - kind: 'openai-compatible' (POST {baseURL}/chat/completions) or 'anthropic' (native Messages API)
 * - openrouterNamespace: id collides with an OpenRouter vendor prefix, so plain `<id>/model`
 *   keeps going to OpenRouter unless explicitly opted in.
 * - streamUsage: send stream_options.include_usage on streaming requests.
 */
export const BUILTIN_PROVIDERS = Object.freeze([
  {
    id: 'openrouter', name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY', kind: 'openai-compatible', headers: {},
    supportsModelsList: true, local: false, openrouterNamespace: false, streamUsage: false,
  },
  {
    id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY', kind: 'openai-compatible', headers: {},
    supportsModelsList: true, local: false, openrouterNamespace: true, streamUsage: true,
  },
  {
    id: 'anthropic', name: 'Anthropic', baseURL: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY', kind: 'anthropic', headers: { 'anthropic-version': ANTHROPIC_VERSION },
    supportsModelsList: true, local: false, openrouterNamespace: true, streamUsage: false,
  },
  {
    id: 'gemini', name: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY', kind: 'openai-compatible', headers: {},
    supportsModelsList: true, local: false, openrouterNamespace: false, streamUsage: true,
  },
  {
    id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY', kind: 'openai-compatible', headers: {},
    supportsModelsList: true, local: false, openrouterNamespace: false, streamUsage: true,
  },
  {
    id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY', kind: 'openai-compatible', headers: {},
    supportsModelsList: true, local: false, openrouterNamespace: true, streamUsage: true,
  },
  {
    id: 'xai', name: 'xAI', baseURL: 'https://api.x.ai/v1',
    apiKeyEnv: 'XAI_API_KEY', kind: 'openai-compatible', headers: {},
    supportsModelsList: true, local: false, openrouterNamespace: false, streamUsage: true,
  },
  {
    id: 'mistral', name: 'Mistral', baseURL: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY', kind: 'openai-compatible', headers: {},
    supportsModelsList: true, local: false, openrouterNamespace: false, streamUsage: false,
  },
  {
    id: 'together', name: 'Together AI', baseURL: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY', kind: 'openai-compatible', headers: {},
    supportsModelsList: true, local: false, openrouterNamespace: false, streamUsage: true,
  },
  {
    id: 'ollama', name: 'Ollama', baseURL: 'http://localhost:11434/v1',
    apiKeyEnv: null, kind: 'openai-compatible', headers: {},
    supportsModelsList: true, local: true, openrouterNamespace: false, streamUsage: true,
  },
  {
    id: 'lmstudio', name: 'LM Studio', baseURL: 'http://localhost:1234/v1',
    apiKeyEnv: null, kind: 'openai-compatible', headers: {},
    supportsModelsList: true, local: true, openrouterNamespace: false, streamUsage: false,
  },
]);

const VALID_KINDS = new Set(['openai-compatible', 'anthropic']);
const ID_RE = /^[a-z0-9][a-z0-9_.-]*$/;

let _cache = null; // { key, providers: Map }

/** Env-var friendly form of a provider id: 'lm-studio' → 'LM_STUDIO'. */
export function envKeyFor(id) {
  return String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/** Paths searched for custom provider files (user first, project second — project wins). */
export function getCustomProviderPaths({ cwd = process.cwd(), home = null } = {}) {
  const userDir = home || process.env.OPENAGENT_HOME || path.join(os.homedir(), '.openagent');
  return [
    { source: 'user', file: path.join(userDir, 'providers.json') },
    { source: 'project', file: path.join(cwd, '.openagent', 'providers.json') },
  ];
}

/**
 * Validate + normalize one custom provider entry. Returns null if invalid.
 * Accepted shape: { id, baseURL, apiKeyEnv?, kind?, headers?, local?, name?, supportsModelsList?, openrouterNamespace?, streamUsage? }
 */
export function normalizeCustomProvider(entry, source = 'custom', base = null) {
  if (!entry || typeof entry !== 'object') return null;
  const id = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : '';
  if (!ID_RE.test(id) || id === DEFAULT_PROVIDER_ID || id.endsWith(DIRECT_SUFFIX)) return null;
  const baseURL = typeof entry.baseURL === 'string' && entry.baseURL.trim()
    ? entry.baseURL.trim().replace(/\/+$/, '')
    : base?.baseURL;
  if (!baseURL || !/^https?:\/\//i.test(baseURL)) return null;
  const kind = VALID_KINDS.has(entry.kind) ? entry.kind : (base?.kind || 'openai-compatible');
  const apiKeyEnv = typeof entry.apiKeyEnv === 'string' && entry.apiKeyEnv.trim()
    ? entry.apiKeyEnv.trim()
    : (entry.apiKeyEnv === null ? null : (base?.apiKeyEnv ?? null));
  const headers = {
    ...(base?.headers || {}),
    ...(entry.headers && typeof entry.headers === 'object' ? entry.headers : {}),
  };
  if (kind === 'anthropic' && !headers['anthropic-version']) headers['anthropic-version'] = ANTHROPIC_VERSION;
  const isLocalUrl = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(baseURL);
  return {
    id,
    name: typeof entry.name === 'string' && entry.name ? entry.name : (base?.name || id),
    baseURL,
    apiKeyEnv,
    kind,
    headers,
    supportsModelsList: entry.supportsModelsList ?? base?.supportsModelsList ?? true,
    local: typeof entry.local === 'boolean' ? entry.local : (base?.local ?? (isLocalUrl || !apiKeyEnv)),
    openrouterNamespace: entry.openrouterNamespace ?? base?.openrouterNamespace ?? false,
    streamUsage: entry.streamUsage ?? base?.streamUsage ?? false,
    source,
  };
}

function readProviderFile(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.providers)) return raw.providers;
    if (raw && typeof raw === 'object') {
      // Map form: { "myprov": { baseURL, ... } }
      return Object.entries(raw).map(([id, cfg]) => ({ id, ...(cfg && typeof cfg === 'object' ? cfg : {}) }));
    }
  } catch (_e) {
    // Malformed providers.json must never break startup; ignore it.
  }
  return [];
}

/**
 * Build the provider map: built-ins → user providers.json → project providers.json.
 * Custom entries with a built-in id override that built-in's fields.
 * Base URLs can also be overridden per provider with OPENAGENT_<ID>_BASE_URL.
 */
export function loadProviders({ cwd = process.cwd(), home = null, env = process.env } = {}) {
  const map = new Map();
  for (const p of BUILTIN_PROVIDERS) {
    map.set(p.id, { ...p, headers: { ...p.headers }, source: 'builtin' });
  }
  if (env.OPENROUTER_BASE_URL) map.get('openrouter').baseURL = env.OPENROUTER_BASE_URL.replace(/\/+$/, '');

  for (const { source, file } of getCustomProviderPaths({ cwd, home })) {
    for (const entry of readProviderFile(file)) {
      const id = typeof entry?.id === 'string' ? entry.id.trim().toLowerCase() : '';
      const normalized = normalizeCustomProvider(entry, source, map.get(id) || null);
      if (normalized) map.set(normalized.id, normalized);
    }
  }

  for (const p of map.values()) {
    const override = env[`OPENAGENT_${envKeyFor(p.id)}_BASE_URL`];
    if (override && /^https?:\/\//i.test(override)) p.baseURL = override.replace(/\/+$/, '');
  }
  return map;
}

/** Cached provider map (re-read when cwd changes). */
export function getProviderMap(options = {}) {
  const cwd = options.cwd || process.cwd();
  const key = `${cwd}|${options.home || ''}`;
  if (!options.env && _cache && _cache.key === key) return _cache.providers;
  const providers = loadProviders({ ...options, cwd });
  if (!options.env) _cache = { key, providers };
  return providers;
}

/** Drop the cached provider map (tests, or after editing providers.json). */
export function resetProviderCache() {
  _cache = null;
}

export function getProviders(options = {}) {
  return [...getProviderMap(options).values()];
}

export function getProvider(id, options = {}) {
  if (!id) return null;
  return getProviderMap(options).get(String(id).toLowerCase()) || null;
}

/** Read the API key for a provider from env (apiKeyEnv may be a string or an array of names). */
export function getApiKey(provider, env = process.env) {
  if (!provider?.apiKeyEnv) return '';
  const names = Array.isArray(provider.apiKeyEnv) ? provider.apiKeyEnv : [provider.apiKeyEnv];
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** A provider is usable when it is local/keyless or its API key is present. */
export function isConfigured(provider, env = process.env) {
  if (!provider) return false;
  if (provider.local || !provider.apiKeyEnv) return true;
  return Boolean(getApiKey(provider, env));
}

/** Whether OPENAGENT_PROVIDER_<ID>=direct opts a namespace-colliding provider into plain-prefix routing. */
export function isDirectOptIn(provider, env = process.env) {
  return String(env[`OPENAGENT_PROVIDER_${envKeyFor(provider.id)}`] || '').toLowerCase() === 'direct';
}

/** The model-id prefix that routes to `provider` (used by the model browser). */
export function routingPrefixFor(provider, env = process.env) {
  if (!provider || provider.id === DEFAULT_PROVIDER_ID) return '';
  if (provider.openrouterNamespace && !isDirectOptIn(provider, env)) return `${provider.id}${DIRECT_SUFFIX}/`;
  return `${provider.id}/`;
}

export function getDefaultProviderId(env = process.env) {
  return String(env.OPENAGENT_DEFAULT_PROVIDER || DEFAULT_PROVIDER_ID).trim().toLowerCase() || DEFAULT_PROVIDER_ID;
}

/**
 * Resolve which provider serves `modelId`.
 * @returns {{ provider: object, model: string, originalModel: string, direct: boolean, explicit: boolean, configured: boolean }}
 */
export function resolveModel(modelId, options = {}) {
  const env = options.env || process.env;
  const map = options.providers instanceof Map ? options.providers : getProviderMap(options);
  const defaultId = options.defaultProvider || getDefaultProviderId(env);
  const fallback = map.get(defaultId) || map.get(DEFAULT_PROVIDER_ID);
  const original = typeof modelId === 'string' ? modelId : '';

  const viaDefault = () => ({
    provider: fallback,
    model: original,
    originalModel: original,
    direct: fallback.id !== DEFAULT_PROVIDER_ID,
    explicit: false,
    configured: isConfigured(fallback, env),
  });

  const slash = original.indexOf('/');
  if (slash <= 0) return viaDefault();
  const prefix = original.slice(0, slash).toLowerCase();
  const rest = original.slice(slash + 1);
  if (!rest) return viaDefault();

  // 1) Explicit `<id>-direct/model`
  if (prefix.endsWith(DIRECT_SUFFIX)) {
    const id = prefix.slice(0, -DIRECT_SUFFIX.length);
    const provider = id !== DEFAULT_PROVIDER_ID ? map.get(id) : null;
    if (provider) {
      return { provider, model: rest, originalModel: original, direct: true, explicit: true, configured: isConfigured(provider, env) };
    }
    return viaDefault();
  }

  // 2) Plain `<id>/model`
  const provider = prefix !== DEFAULT_PROVIDER_ID ? map.get(prefix) : null;
  if (!provider) return viaDefault();
  if (provider.openrouterNamespace && !isDirectOptIn(provider, env)) return viaDefault();
  if (!isConfigured(provider, env)) return viaDefault();
  return { provider, model: rest, originalModel: original, direct: true, explicit: false, configured: true };
}

export default {
  BUILTIN_PROVIDERS,
  loadProviders,
  getProviders,
  getProvider,
  getApiKey,
  isConfigured,
  resolveModel,
  routingPrefixFor,
  resetProviderCache,
};
