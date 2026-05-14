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
  const sessionId = data.sessionId || data.targetId || null;
  const iteration = Number.isFinite(data.iteration) ? data.iteration : null;

  return {
    ...data,
    type,
    sessionId,
    iteration,
    timestamp: data.timestamp || new Date().toISOString(),
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
