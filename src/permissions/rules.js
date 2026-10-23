/**
 * Permission rules: parsing and matching.
 *
 * Rule syntax (Claude-Code compatible):
 *   toolName                 matches every call of that tool (globs allowed: `mcp_*`)
 *   toolName(specifier)      matches only calls whose arguments match the specifier
 *
 * Specifier semantics:
 *   - Shell tools (exec, exec_background; aliases Bash/shell):
 *       `npm test:*`  prefix match: "npm test" or "npm test <anything>"
 *       `git *`       glob match against the whole normalized command
 *       `npm run lint` exact match
 *     Compound commands (`a && b`, `a; b`, `a | b`) are split into segments.
 *     For ALLOW every segment must match; for DENY/ASK the whole command or
 *     any single segment matching is enough.
 *   - Path-bearing tools: glob against the path argument(s), relative to cwd
 *     (`src/**`, `*.md`). ALLOW requires all paths to match; DENY/ASK any path.
 *   - `domain:example.com` / `domain:*.example.com` matches a `url` argument host.
 *   - Otherwise: glob against the primary argument (url/query/name/action).
 */

import path from 'node:path';

/** Tools whose specifier is matched against a shell command string. */
export const COMMAND_TOOLS = new Set(['exec', 'exec_background']);

/** Claude-Code style aliases usable in rules (matched case-insensitively). */
export const RULE_TOOL_ALIASES = {
  bash: ['exec', 'exec_background'],
  shell: ['exec', 'exec_background'],
  read: ['read_file', 'read_files'],
  edit: ['edit_file', 'search_and_replace', 'multi_edit', 'apply_patch'],
  write: ['write_file', 'write_file_blocks'],
  webfetch: ['fetch_url', 'read_webpage'],
  websearch: ['web_search'],
};

const PATH_ARG_KEYS = ['path', 'filePath', 'file_path', 'file', 'source', 'destination', 'target', 'file1', 'file2'];
const PATH_ARRAY_KEYS = ['paths', 'files'];
const PRIMARY_ARG_KEYS = ['url', 'query', 'name', 'action', 'task', 'server', 'tool'];

const globCache = new Map();

/**
 * Convert a glob to a RegExp. Supports `**`, `*`, `?` and `{a,b}`.
 * `*` does not cross `/` unless `crossSeparators` is set (used for commands).
 * @param {string} glob
 * @param {{crossSeparators?: boolean, caseInsensitive?: boolean}} [opts]
 * @returns {RegExp}
 */
export function globToRegExp(glob, opts = {}) {
  const key = `${opts.crossSeparators ? 1 : 0}${opts.caseInsensitive ? 1 : 0}:${glob}`;
  const cached = globCache.get(key);
  if (cached) return cached;

  let re = '';
  let inBrace = false;
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more directories; bare `**` matches anything
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += opts.crossSeparators ? '.*' : '[^/]*';
      }
    } else if (ch === '?') {
      re += opts.crossSeparators ? '.' : '[^/]';
    } else if (ch === '{') {
      inBrace = true;
      re += '(?:';
    } else if (ch === '}' && inBrace) {
      inBrace = false;
      re += ')';
    } else if (ch === ',' && inBrace) {
      re += '|';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const regex = new RegExp(`^${re}$`, opts.caseInsensitive ? 'i' : '');
  globCache.set(key, regex);
  return regex;
}

/**
 * Glob match helper.
 * @param {string} pattern
 * @param {string} value
 * @param {object} [opts] - see globToRegExp
 */
export function matchGlob(pattern, value, opts = {}) {
  if (typeof value !== 'string') return false;
  return globToRegExp(pattern, opts).test(value);
}

/**
 * Parse a rule string like `exec(npm test:*)` or `git_push`.
 * @param {string} rule
 * @returns {{raw: string, tool: string, specifier: string|null}|null}
 */
export function parseRule(rule) {
  if (typeof rule !== 'string') return null;
  const raw = rule.trim();
  if (!raw) return null;
  const open = raw.indexOf('(');
  if (open > 0 && raw.endsWith(')')) {
    const tool = raw.slice(0, open).trim();
    const specifier = raw.slice(open + 1, -1).trim();
    return { raw, tool, specifier: specifier === '' || specifier === '*' ? null : specifier };
  }
  return { raw, tool: raw, specifier: null };
}

/**
 * Whether the rule's tool part targets `toolName` (exact, alias or glob).
 * @param {string} ruleTool
 * @param {string} toolName
 */
export function ruleToolMatches(ruleTool, toolName) {
  if (!ruleTool || !toolName) return false;
  if (ruleTool === '*' || ruleTool === toolName) return true;
  const alias = RULE_TOOL_ALIASES[ruleTool.toLowerCase()];
  if (alias && alias.includes(toolName)) return true;
  if (/[*?{]/.test(ruleTool)) return matchGlob(ruleTool, toolName, { crossSeparators: true });
  return false;
}

/** Collapse whitespace so `npm   test` and `npm test` compare equal. */
export function normalizeCommand(command) {
  return String(command ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Split a compound shell command into segments on `&&`, `||`, `;`, `|`
 * and newlines, ignoring separators inside quotes.
 * @param {string} command
 * @returns {string[]}
 */
export function splitCommand(command) {
  const src = String(command ?? '');
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      current += ch;
      if (ch === quote && src[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      segments.push(current);
      current = '';
      i++;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '\n' || ch === '&') {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments.map(normalizeCommand).filter(Boolean);
}

/**
 * Match a single (normalized) command against a specifier.
 * `prefix:*` → prefix match on a word boundary; globs → glob; else exact.
 * @param {string} specifier
 * @param {string} command
 */
export function matchCommandSpecifier(specifier, command) {
  const cmd = normalizeCommand(command);
  const spec = normalizeCommand(specifier);
  if (!spec) return true;
  if (spec.endsWith(':*')) {
    const prefix = spec.slice(0, -2).trim();
    if (!prefix) return true;
    return cmd === prefix || cmd.startsWith(`${prefix} `);
  }
  if (/[*?]/.test(spec)) return matchGlob(spec, cmd, { crossSeparators: true });
  return cmd === spec;
}

/**
 * Match a full command (possibly compound) against a specifier.
 * @param {string} specifier
 * @param {string} command
 * @param {'allow'|'deny'|'ask'} kind
 */
export function matchCommand(specifier, command, kind = 'allow') {
  const whole = normalizeCommand(command);
  const segments = splitCommand(command);
  if (kind === 'allow') {
    if (segments.length <= 1) return matchCommandSpecifier(specifier, whole);
    return segments.every(seg => matchCommandSpecifier(specifier, seg));
  }
  if (matchCommandSpecifier(specifier, whole)) return true;
  return segments.some(seg => matchCommandSpecifier(specifier, seg));
}

/** Convert a path to forward slashes for matching. */
function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

/**
 * Express `target` relative to `baseDir` (forward slashes). Paths outside
 * the base stay absolute so `src/**` cannot match them.
 */
export function relativizePath(target, baseDir) {
  const raw = String(target ?? '');
  if (!raw) return '';
  const base = path.resolve(baseDir || process.cwd());
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(base, raw);
  const rel = path.relative(base, abs);
  if (!rel) return '.';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return toPosix(abs);
  return toPosix(rel);
}

/**
 * Match a path against a glob specifier (relative globs resolve against baseDir).
 * Case-insensitive on Windows.
 */
export function matchPath(specifier, target, baseDir) {
  const caseInsensitive = process.platform === 'win32';
  let spec = toPosix(specifier.trim());
  if (spec.startsWith('./')) spec = spec.slice(2);
  const isAbsSpec = path.isAbsolute(specifier) || /^[a-zA-Z]:\//.test(spec) || spec.startsWith('/');
  const candidate = isAbsSpec
    ? toPosix(path.resolve(baseDir || process.cwd(), String(target)))
    : relativizePath(target, baseDir);
  if (matchGlob(spec, candidate, { caseInsensitive })) return true;
  // `src` also matches everything below it (directory rule)
  if (!/[*?]/.test(spec)) {
    return matchGlob(`${spec.replace(/\/$/, '')}/**`, candidate, { caseInsensitive });
  }
  return false;
}

/**
 * Collect path-like arguments from a tool call.
 * @param {object} args
 * @returns {string[]}
 */
export function extractPaths(args) {
  if (!args || typeof args !== 'object') return [];
  const out = [];
  for (const key of PATH_ARG_KEYS) {
    if (typeof args[key] === 'string' && args[key]) out.push(args[key]);
  }
  for (const key of PATH_ARRAY_KEYS) {
    const val = args[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') out.push(item);
        else if (item && typeof item.path === 'string') out.push(item.path);
      }
    }
  }
  if (Array.isArray(args.edits)) {
    for (const edit of args.edits) {
      if (edit && typeof edit.path === 'string') out.push(edit.path);
    }
  }
  return out;
}

/** Return the shell command string carried by a tool call, if any. */
export function extractCommand(toolName, args) {
  if (!args || typeof args !== 'object') return null;
  if (COMMAND_TOOLS.has(toolName) || typeof args.command === 'string') {
    return typeof args.command === 'string' ? args.command : null;
  }
  return null;
}

/** Host of a url argument, or null. */
function extractHost(args) {
  const url = args && typeof args.url === 'string' ? args.url : null;
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Does a parsed rule match a tool call?
 * @param {{tool: string, specifier: string|null}} rule
 * @param {string} toolName
 * @param {object} args
 * @param {{kind?: 'allow'|'deny'|'ask', baseDir?: string}} [ctx]
 * @returns {boolean}
 */
export function ruleMatches(rule, toolName, args, ctx = {}) {
  if (!rule || !ruleToolMatches(rule.tool, toolName)) return false;
  if (!rule.specifier) return true;
  const kind = ctx.kind || 'allow';
  const spec = rule.specifier;

  if (spec.toLowerCase().startsWith('domain:')) {
    const host = extractHost(args);
    if (!host) return false;
    const pattern = spec.slice(7).trim().toLowerCase();
    return host === pattern || matchGlob(pattern, host, { crossSeparators: true });
  }

  const command = extractCommand(toolName, args);
  if (command !== null) return matchCommand(spec, command, kind);

  const paths = extractPaths(args);
  if (paths.length > 0) {
    return kind === 'allow'
      ? paths.every(p => matchPath(spec, p, ctx.baseDir))
      : paths.some(p => matchPath(spec, p, ctx.baseDir));
  }

  for (const key of PRIMARY_ARG_KEYS) {
    if (typeof args?.[key] === 'string') {
      return matchGlob(spec, args[key], { crossSeparators: true });
    }
  }
  return false;
}

/**
 * Find the first matching rule string in a list.
 * @param {string[]} rules
 * @param {string} toolName
 * @param {object} args
 * @param {{kind?: string, baseDir?: string}} ctx
 * @returns {string|null}
 */
export function findMatchingRule(rules, toolName, args, ctx = {}) {
  for (const raw of rules || []) {
    const parsed = parseRule(raw);
    if (parsed && ruleMatches(parsed, toolName, args, ctx)) return parsed.raw;
  }
  return null;
}

/**
 * Build the rule string that an "always allow" answer should persist.
 * Shell commands become `exec(<first two words>:*)`; others the bare tool name.
 */
export function suggestRuleForCall(toolName, args) {
  const command = extractCommand(toolName, args);
  if (command !== null) {
    const words = normalizeCommand(splitCommand(command)[0] || command).split(' ');
    const prefix = words.slice(0, Math.min(2, words.length)).join(' ');
    return prefix ? `${toolName}(${prefix}:*)` : toolName;
  }
  return toolName;
}
