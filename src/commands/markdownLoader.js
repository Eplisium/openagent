/**
 * 📝 Markdown command & agent loader
 *
 * Loads Claude-Code-compatible markdown definitions:
 *
 *   Custom slash commands  (name = relative path, subdirs joined with ':')
 *     project: <cwd>/.openagent/commands/**\/*.md
 *              <cwd>/.claude/commands/**\/*.md        (compatibility)
 *     user:    ~/.openagent/commands/**\/*.md
 *
 *   Subagents (name = frontmatter `name` or file basename)
 *     project: <cwd>/.openagent/agents/*.md, <cwd>/.claude/agents/*.md
 *     user:    ~/.openagent/agents/*.md
 *
 * Precedence (highest wins): project .openagent > project .claude > user.
 *
 * Command frontmatter: description, argument-hint, model, allowed-tools
 * Command body placeholders: $ARGUMENTS, $1..$9, @path/to/file (inlined)
 *
 * Agent frontmatter: name, description, tools (comma list or YAML list), model,
 *   maxIterations (optional). Body = system prompt.
 *
 * Results are cached; the cache is invalidated when any source directory's
 * file list or any file's mtime changes.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

const MAX_INCLUDE_BYTES = 256 * 1024;
const MAX_COMMAND_FILES = 500;

// ─── Frontmatter ────────────────────────────────────────────────────

function unquote(value) {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Minimal YAML frontmatter parser tuned for command/agent files.
 * Supports `key: value`, quoted values, `key: [a, b]` inline lists, `- item`
 * block lists, and `|` / `>` block scalars. Values like `[file] [focus]`
 * (argument hints) are kept as plain strings. Handles CRLF.
 * @param {string} content
 * @returns {{frontmatter: Record<string, any>, body: string}}
 */
export function parseFrontmatter(content) {
  const text = String(content ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const match = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: text.trim() };
  const lines = match[1].split('\n');
  const fm = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const raw = kv[2].trim();
    if (raw === '|' || raw === '>' || raw === '|-' || raw === '>-') {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === '')) {
        block.push(lines[++i].trim());
      }
      fm[key] = raw.startsWith('>') ? block.filter(Boolean).join(' ') : block.join('\n').trim();
    } else if (raw === '') {
      const items = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        items.push(unquote(lines[++i].replace(/^\s*-\s+/, '')));
      }
      fm[key] = items.length ? items : '';
    } else if (/^\[[^\]]*\]$/.test(raw)) {
      // Single inline list like [a, b] — but `[file]` alone stays a list of one.
      fm[key] = raw.slice(1, -1).split(',').map((s) => unquote(s)).filter(Boolean);
    } else {
      fm[key] = unquote(raw);
    }
  }
  return { frontmatter: fm, body: match[2].trim() };
}

/**
 * Normalize a tools field (comma string, YAML list, or "*") to an array or null (= all tools).
 * @param {unknown} value
 * @returns {string[]|null}
 */
export function parseToolList(value) {
  if (value == null || value === '') return null;
  const arr = Array.isArray(value) ? value : String(value).split(',');
  const list = arr.map((s) => String(s).trim()).filter(Boolean);
  if (list.length === 0 || list.includes('*')) return null;
  return list;
}

// ─── Source discovery ───────────────────────────────────────────────

function homeDir(options) {
  return options.homeDir || process.env.OPENAGENT_HOME_DIR || os.homedir();
}

/**
 * Ordered list of source dirs, lowest precedence first.
 * @param {'commands'|'agents'} kind
 */
export function getSourceDirs(kind, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const home = homeDir(options);
  return [
    { dir: path.join(home, '.openagent', kind), source: 'user' },
    { dir: path.join(cwd, '.claude', kind), source: 'project-claude' },
    { dir: path.join(cwd, '.openagent', kind), source: 'project' },
  ];
}

function walkMarkdown(dir, recursive, out = [], base = dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_COMMAND_FILES) break;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (recursive && !e.name.startsWith('.')) walkMarkdown(full, recursive, out, base);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(full).mtimeMs;
      } catch {
        continue;
      }
      out.push({ file: full, rel: path.relative(base, full), mtimeMs });
    }
  }
  return out;
}

function fingerprint(files) {
  return files.map((f) => `${f.file}|${f.mtimeMs}`).join('\n');
}

// ─── Custom commands ────────────────────────────────────────────────

const commandCache = new Map();

/** Convert a relative markdown path into a command name ("git/commit.md" → "git:commit"). */
export function commandNameFromPath(rel) {
  return rel
    .replace(/\.md$/i, '')
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, '-'))
    .join(':');
}

/**
 * Load all custom commands. Higher-precedence sources override lower ones.
 * @param {{cwd?: string, homeDir?: string}} [options]
 * @returns {Map<string, {name:string, description:string, argumentHint:string, model:string|null, allowedTools:string[]|null, body:string, file:string, source:string}>}
 */
export function loadCustomCommands(options = {}) {
  const sources = getSourceDirs('commands', options);
  const scanned = sources.map((s) => ({ ...s, files: walkMarkdown(s.dir, true) }));
  const key = sources.map((s) => s.dir).join('|');
  const fp = scanned.map((s) => fingerprint(s.files)).join('\n#\n');
  const cached = commandCache.get(key);
  if (cached && cached.fp === fp) return cached.commands;

  const commands = new Map();
  for (const src of scanned) {
    for (const f of src.files) {
      let content;
      try {
        content = fs.readFileSync(f.file, 'utf-8');
      } catch {
        continue;
      }
      const { frontmatter, body } = parseFrontmatter(content);
      const name = commandNameFromPath(f.rel);
      if (!name) continue;
      const hint = frontmatter['argument-hint'];
      commands.set(name, {
        name,
        description: String(frontmatter.description || firstLine(body) || `Custom command (${src.source})`),
        argumentHint: Array.isArray(hint) ? hint.map((h) => `[${h}]`).join(' ') : String(hint || ''),
        model: frontmatter.model ? String(frontmatter.model) : null,
        allowedTools: parseToolList(frontmatter['allowed-tools']),
        body,
        file: f.file,
        source: src.source,
      });
    }
  }
  commandCache.set(key, { fp, commands });
  return commands;
}

function firstLine(body) {
  const line = String(body || '').split('\n').find((l) => l.trim());
  return line ? line.replace(/^#+\s*/, '').trim().slice(0, 80) : '';
}

/**
 * Split an argument string shell-style (supports "double" and 'single' quotes).
 * @param {string} argsString
 * @returns {string[]}
 */
export function splitArgs(argsString) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(argsString || ''))) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

async function inlineFileIncludes(text, cwd) {
  // @path tokens: at start or after whitespace/paren; must look like a path.
  const re = /(^|[\s(])@((?:"[^"]+")|(?:[\w./\\~:-]+[\w/\\-]))/g;
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return text;
  const replacements = new Map();
  for (const m of matches) {
    const token = m[2];
    if (replacements.has(token)) continue;
    const rawPath = token.startsWith('"') ? token.slice(1, -1) : token;
    // Skip things that are clearly not files (emails, npm scopes without extension/slash).
    if (!/[./\\]/.test(rawPath)) continue;
    const expanded = rawPath.startsWith('~') ? path.join(os.homedir(), rawPath.slice(1)) : rawPath;
    const abs = path.resolve(cwd, expanded);
    try {
      const st = await fsp.stat(abs);
      if (!st.isFile()) continue;
      let content;
      if (st.size > MAX_INCLUDE_BYTES) {
        const fh = await fsp.open(abs, 'r');
        try {
          const buf = Buffer.alloc(MAX_INCLUDE_BYTES);
          await fh.read(buf, 0, MAX_INCLUDE_BYTES, 0);
          content = `${buf.toString('utf-8')}\n... [truncated: ${st.size} bytes total]`;
        } finally {
          await fh.close();
        }
      } else {
        content = await fsp.readFile(abs, 'utf-8');
      }
      const lang = path.extname(abs).slice(1);
      replacements.set(token, `\n\n<file path="${rawPath}">\n\`\`\`${lang}\n${content.replace(/\s+$/, '')}\n\`\`\`\n</file>\n`);
    } catch {
      // Missing file: leave the @reference untouched.
    }
  }
  if (replacements.size === 0) return text;
  return text.replace(re, (full, pre, token) => (replacements.has(token) ? `${pre}@${token}${replacements.get(token)}` : full));
}

/**
 * Expand a command template with arguments and inline @file includes.
 * @param {{body:string}} command
 * @param {string} argsString
 * @param {{cwd?: string}} [options]
 * @returns {Promise<string>}
 */
export async function expandCommand(command, argsString = '', options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const argText = String(argsString || '').trim();
  const args = splitArgs(argText);
  let text = String(command.body || '');
  const usesPlaceholders = /\$ARGUMENTS|\$[1-9]/.test(text);
  text = text.replace(/\$ARGUMENTS/g, argText);
  text = text.replace(/\$([1-9])(?!\d)/g, (_, n) => args[Number(n) - 1] ?? '');
  if (!usesPlaceholders && argText) {
    // Like Claude Code: if the template never references args, append them.
    text = `${text}\n\nARGUMENTS: ${argText}`;
  }
  text = await inlineFileIncludes(text, cwd);
  return text.trim();
}

// ─── Markdown agents ────────────────────────────────────────────────

const agentCache = new Map();

/**
 * Load markdown subagent definitions as specialization objects.
 * @param {{cwd?: string, homeDir?: string}} [options]
 * @returns {Record<string, {name:string, description:string, systemPrompt:string, maxIterations:number, tools:string[]|null, model:string|null, source:string, file:string, markdown:true}>}
 */
export function loadMarkdownAgents(options = {}) {
  const sources = getSourceDirs('agents', options);
  const scanned = sources.map((s) => ({ ...s, files: walkMarkdown(s.dir, false) }));
  const key = sources.map((s) => s.dir).join('|');
  const fp = scanned.map((s) => fingerprint(s.files)).join('\n#\n');
  const cached = agentCache.get(key);
  if (cached && cached.fp === fp) return cached.agents;

  const agents = {};
  for (const src of scanned) {
    for (const f of src.files) {
      let content;
      try {
        content = fs.readFileSync(f.file, 'utf-8');
      } catch {
        continue;
      }
      const { frontmatter, body } = parseFrontmatter(content);
      if (!body) continue;
      const id = normalizeAgentId(frontmatter.name || path.basename(f.file, path.extname(f.file)));
      if (!id) continue;
      const maxIter = Number(frontmatter.maxIterations ?? frontmatter['max-iterations']);
      agents[id] = {
        name: `🧩 ${frontmatter.name || id}`,
        description: String(frontmatter.description || firstLine(body) || 'Custom markdown subagent'),
        systemPrompt: `${body}\n\nYou are a SUBAGENT — complete your specific task and return results. Do not ask questions.`,
        maxIterations: Number.isFinite(maxIter) && maxIter > 0 ? maxIter : 30,
        tools: parseToolList(frontmatter.tools),
        model: frontmatter.model && frontmatter.model !== 'inherit' ? String(frontmatter.model) : null,
        source: src.source,
        file: f.file,
        markdown: true,
      };
    }
  }
  agentCache.set(key, { fp, agents });
  return agents;
}

/** Normalize an agent name into a specialization id ("Code Reviewer" → "code-reviewer"). */
export function normalizeAgentId(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_:-]/g, '');
}

/** Clear loader caches (tests / hot reload). */
export function clearMarkdownCaches() {
  commandCache.clear();
  agentCache.clear();
}
