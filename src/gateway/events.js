import { renderMarkdown } from '../cli/markdown.js';

const DEFAULT_PREVIEW_CHARS = 500;

export const GATEWAY_EVENT_TYPES = Object.freeze({
  CONNECTED: 'connected',
  STATE_RECOVERY: 'state_recovery',
  ITERATION_START: 'iteration_start',
  ITERATION_END: 'iteration_end',
  CONTENT_DELTA: 'content_delta',
  TOOL_CALL_START: 'tool_call_start',
  TOOL_CALL_END: 'tool_call_end',
  THINKING: 'thinking',
  STATUS: 'status',
  CHECKPOINT: 'checkpoint',
  DONE: 'done',
  ERROR: 'error',
  RESPONSE: 'response',
});

export function createGatewayEvent(type, data = {}) {
  data = data || {};
  const sessionId = data.sessionId || data.targetId || null;
  const iteration = Number.isFinite(data.iteration) ? data.iteration : null;
  const enriched = enrichEvent(type, data);

  return {
    ...enriched,
    type,
    sessionId,
    iteration,
    message_role: enriched.message_role || inferMessageRole(type),
    timestamp: data.timestamp || new Date().toISOString(),
  };
}

function enrichEvent(type, data) {
  data = data || {};
  switch (type) {
    case GATEWAY_EVENT_TYPES.CONTENT_DELTA:
      return {
        ...data,
        message_role: data.message_role || 'assistant',
        rendered_markdown: renderTerminalMarkdown(data.content || data.delta || ''),
        content_block: data.content_block || detectMarkdownBlock(data.content || data.delta || ''),
      };
    case GATEWAY_EVENT_TYPES.TOOL_CALL_START:
      return {
        ...data,
        message_role: data.message_role || 'assistant',
        tool_category: data.tool_category || categorizeTool(data.toolName || data.tool || data.name),
        arg_summary: data.arg_summary || summarizeArgs(data.args || data.input || data.arguments || data.argsPreview),
        estimated_duration: data.estimated_duration || estimateDuration(data.toolName || data.tool || data.name),
      };
    case GATEWAY_EVENT_TYPES.TOOL_CALL_END:
      return {
        ...data,
        message_role: data.message_role || 'assistant',
        result_type: data.result_type || inferResultType(data),
        result_preview: data.result_preview || previewValue(data.result ?? data.preview ?? data.content ?? data.error ?? '', 200),
        line_diff: data.line_diff || computeLineDiff(data),
      };
    case GATEWAY_EVENT_TYPES.DONE:
      return {
        ...data,
        message_role: data.message_role || 'assistant',
        summary: data.summary || buildDoneSummary(data),
      };
    case GATEWAY_EVENT_TYPES.ERROR:
    case GATEWAY_EVENT_TYPES.STATUS:
    case GATEWAY_EVENT_TYPES.CHECKPOINT:
    case GATEWAY_EVENT_TYPES.CONNECTED:
    case GATEWAY_EVENT_TYPES.STATE_RECOVERY:
      return { ...data, message_role: data.message_role || 'system' };
    default:
      return { ...data, message_role: data.message_role || inferMessageRole(type) };
  }
}

function inferMessageRole(type) {
  if (type === GATEWAY_EVENT_TYPES.CONTENT_DELTA || type === GATEWAY_EVENT_TYPES.RESPONSE || type === GATEWAY_EVENT_TYPES.DONE) return 'assistant';
  return 'system';
}

function renderTerminalMarkdown(content) {
  if (!content) return '';
  try {
    return renderMarkdown(String(content));
  } catch {
    return String(content);
  }
}

function detectMarkdownBlock(content) {
  const text = String(content || '');
  if (/^```/.test(text) || /```/.test(text)) return 'code_block';
  if (/^\s{0,3}#{1,6}\s/m.test(text)) return 'heading';
  if (/^\s{0,3}>\s/m.test(text)) return 'blockquote';
  if (/^\s*[-*+]\s/m.test(text) || /^\s*\d+\.\s/m.test(text)) return 'list';
  if (/\|.+\|/.test(text)) return 'table';
  return 'paragraph';
}

function categorizeTool(toolName = '') {
  const name = String(toolName).toLowerCase();
  if (/(research|scholar|paper|arxiv|pubmed|semantic|citation)/.test(name)) return 'research';
  if (/(read|write|edit|file|directory|ls|glob)/.test(name)) return 'file_ops';
  if (/(exec|shell|terminal|command)/.test(name)) return 'shell';
  if (/(search|grep|rg|find)/.test(name)) return 'search';
  if (/(web|url|http|fetch|browser)/.test(name)) return 'web';
  if (/git/.test(name)) return 'git';
  return 'other';
}

function summarizeArgs(args) {
  if (!args) return '';
  if (typeof args === 'string') return previewValue(args, 160);
  const path = args.path || args.file || args.filePath;
  if (path) return String(path);
  if (args.command) return String(args.command);
  if (args.query) return `"${previewValue(args.query, 120)}"`;
  if (args.url) return String(args.url);
  return previewValue(args, 160);
}

function estimateDuration(toolName = '') {
  const category = categorizeTool(toolName);
  if (category === 'file_ops' || category === 'git') return 'fast';
  if (category === 'shell' || category === 'search') return 'medium';
  if (category === 'web') return 'slow';
  return 'unknown';
}

function inferResultType(data) {
  if (data.success === false || data.error) return 'error';
  const result = data.result ?? data.preview ?? data.content;
  if (result == null || result === '') return 'empty';
  return 'content';
}

function computeLineDiff(data) {
  data = data || {};
  const result = data.result || {};
  if (Number.isFinite(result.additions) || Number.isFinite(result.deletions)) {
    return { additions: result.additions || 0, deletions: result.deletions || 0 };
  }
  if (Number.isFinite(result.linesAdded) || Number.isFinite(result.linesRemoved) ||
      Number.isFinite(data.linesAdded) || Number.isFinite(data.linesRemoved)) {
    return {
      additions: result.linesAdded ?? data.linesAdded ?? 0,
      deletions: result.linesRemoved ?? data.linesRemoved ?? 0,
    };
  }
  if (Number.isFinite(result.linesWritten) || Number.isFinite(result.linesDeleted) || Number.isFinite(result.linesModified)) {
    return {
      additions: result.linesWritten || result.linesModified || 0,
      deletions: result.linesDeleted || 0,
    };
  }
  return null;
}

function buildDoneSummary(data) {
  const stats = data.stats || {};
  const performance = data.performance || {};
  return {
    iterations: data.iterations ?? data.iteration ?? null,
    toolExecutions: stats.toolExecutions ?? data.toolExecutions ?? null,
    totalTokens: stats.totalTokensUsed ?? data.totalTokens ?? null,
    duration: data.duration ?? data.durationMs ?? performance.duration ?? null,
    model: data.model || null,
    contextPercent: data.contextPercent ?? null,
    cost: performance.totalCost ?? data.cost ?? null,
  };
}

export function previewValue(value, maxChars = DEFAULT_PREVIEW_CHARS) {
  let text;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }

  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}... [${text.length - maxChars} chars omitted]`;
}

export function summarizeToolResult(result, maxChars = DEFAULT_PREVIEW_CHARS) {
  if (!result) {
    return { success: false, preview: '' };
  }

  const success = result.success !== false;
  const preview = previewValue(result, maxChars);
  return {
    success,
    preview,
    error: success ? undefined : result.error || 'Tool failed',
  };
}
