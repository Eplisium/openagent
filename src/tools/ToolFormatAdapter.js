/**
 * 🔄 Universal Tool Format Adapter
 * 
 * Converts tool definitions and normalizes tool call responses between
 * different LLM provider formats so ANY model can use the tool system.
 * 
 * Supported formats:
 * - OpenAI (default): { type: 'function', function: { name, description, parameters } }
 * - Anthropic/Claude: { name, description, input_schema }
 * - Google Gemini: { function_declarations: [{ name, description, parameters }] }
 * - Mistral: Same as OpenAI but may need description at top level
 * - XML-based: For models that output XML tool calls (handled by xmlToolParser.js)
 * 
 * OpenRouter normalizes most responses to OpenAI format, so the adapter primarily
 * handles tool DEFINITION formatting and edge cases in response parsing.
 */

/**
 * Known provider patterns mapped to their identifiers.
 * Order matters: more specific patterns should come first.
 */
const PROVIDER_PATTERNS = [
  { pattern: /^anthropic\//i, provider: 'anthropic' },
  { pattern: /^claude[.-]/i, provider: 'anthropic' },
  { pattern: /^google\//i, provider: 'google' },
  { pattern: /^gemini/i, provider: 'google' },
  { pattern: /^mistralai\//i, provider: 'mistral' },
  { pattern: /^mistral[.-]/i, provider: 'mistral' },
  { pattern: /^meta-llama\//i, provider: 'meta' },
  { pattern: /^llama[.-]/i, provider: 'meta' },
  { pattern: /^qwen\//i, provider: 'qwen' },
  { pattern: /^deepseek\//i, provider: 'deepseek' },
  { pattern: /^cohere\//i, provider: 'cohere' },
  { pattern: /^openai\//i, provider: 'openai' },
  { pattern: /^gpt[.-]/i, provider: 'openai' },
  { pattern: /^o[1-9]/i, provider: 'openai' },
  { pattern: /^x-ai\//i, provider: 'openai' },
  { pattern: /^grok/i, provider: 'openai' },
];

/**
 * Tool choice mappings per provider.
 * Each provider handles tool_choice slightly differently.
 */
const TOOL_CHOICE_MAP = {
  openai:    { auto: 'auto', any: 'required', none: 'none' },
  anthropic: { auto: 'auto', any: 'any',      none: 'auto' },
  google:    { auto: 'AUTO', any: 'ANY',       none: 'NONE' },
  mistral:   { auto: 'auto', any: 'any',       none: 'none' },
  meta:      { auto: 'auto', any: 'any',       none: 'none' },
  qwen:      { auto: 'auto', any: 'any',       none: 'none' },
  deepseek:  { auto: 'auto', any: 'any',       none: 'none' },
  cohere:    { auto: 'auto', any: 'required',  none: 'none' },
};

export class ToolFormatAdapter {
  /**
   * Detect the provider from a model string.
   * 
   * @param {string} model - Model identifier (e.g., 'anthropic/claude-3.5-sonnet', 'gpt-4o')
   * @returns {string} Provider name ('openai', 'anthropic', 'google', 'mistral', 'meta', 'qwen', 'deepseek', 'cohere')
   */
  static detectProvider(model) {
    if (!model || typeof model !== 'string') return 'openai';

    // Strip provider prefix that OpenRouter uses (e.g., 'anthropic/claude-3.5-sonnet')
    // The full string is checked against patterns since some patterns match the prefix
    // and some match the model name itself.
    for (const { pattern, provider } of PROVIDER_PATTERNS) {
      if (pattern.test(model)) return provider;
    }

    return 'openai';
  }

  /**
   * Convert tool definitions from internal format to provider-specific format.
   * 
   * Internal format (OpenAI-style simplified):
   *   { name, description, parameters: { type: 'object', properties: {...}, required: [...] } }
   * 
   * @param {Array<Object>} tools - Tool definitions in internal format
   * @param {string} provider - Target provider name
   * @returns {Array<Object>|Object} Tools in provider-specific format
   */
  static formatToolDefinitions(tools, provider) {
    if (!tools || !Array.isArray(tools) || tools.length === 0) return tools || [];

    switch (provider) {
      case 'anthropic':
        return ToolFormatAdapter._formatAnthropic(tools);
      case 'google':
        return ToolFormatAdapter._formatGoogle(tools);
      case 'mistral':
        return ToolFormatAdapter._formatMistral(tools);
      default:
        // OpenAI, meta, qwen, deepseek, cohere — all use OpenAI format
        return ToolFormatAdapter._formatOpenAI(tools);
    }
  }

  /**
   * Normalize a tool call from any provider format to the internal standard.
   * 
   * Internal standard: { id: string, name: string, arguments: Object }
   * 
   * @param {Object} toolCall - Raw tool call from API response
   * @param {string} provider - Source provider name
   * @returns {{ id: string, name: string, arguments: Object }} Normalized tool call
   */
  static normalizeToolCall(toolCall, _provider) {
    if (!toolCall) return null;

    // Already in internal standard format (from XML parser or previous normalization)
    if (toolCall.name && toolCall.arguments && typeof toolCall.arguments === 'object' && !toolCall.function) {
      return {
        id: toolCall.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: toolCall.name,
        arguments: toolCall.arguments,
      };
    }

    // OpenAI format: { id, type: 'function', function: { name, arguments: JSON_STRING } }
    if (toolCall.function) {
      const name = toolCall.function.name;
      let args = {};

      if (typeof toolCall.function.arguments === 'string') {
        args = ToolFormatAdapter._parseArguments(toolCall.function.arguments);
      } else if (typeof toolCall.function.arguments === 'object') {
        args = toolCall.function.arguments || {};
      }

      return {
        id: toolCall.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        arguments: args,
      };
    }

    // Anthropic format: { id, name, input: {...} } or { id, name, arguments: {...} }
    if (toolCall.name && (toolCall.input || toolCall.arguments)) {
      const rawArgs = toolCall.input || toolCall.arguments;
      const args = typeof rawArgs === 'string'
        ? ToolFormatAdapter._parseArguments(rawArgs)
        : (rawArgs || {});

      return {
        id: toolCall.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: toolCall.name,
        arguments: args,
      };
    }

    // Google Gemini format: { functionCall: { name, args } }
    if (toolCall.functionCall) {
      const fc = toolCall.functionCall;
      const args = typeof fc.args === 'string'
        ? ToolFormatAdapter._parseArguments(fc.args)
        : (fc.args || {});

      return {
        id: toolCall.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: fc.name,
        arguments: args,
      };
    }

    // Fallback: try to extract whatever we can
    const name = toolCall.name || toolCall.function?.name || 'unknown';
    let args = toolCall.arguments || toolCall.input || toolCall.function?.arguments || {};
    if (typeof args === 'string') {
      args = ToolFormatAdapter._parseArguments(args);
    }

    return {
      id: toolCall.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      arguments: args || {},
    };
  }

  /**
   * Get the optimal tool_choice value for a provider.
   * 
   * @param {string} provider - Target provider name
   * @param {string} mode - Choice mode: 'auto' | 'any' | 'none'
   * @returns {string} Provider-specific tool_choice value
   */
  static getToolChoice(provider, mode = 'auto') {
    const mapping = TOOL_CHOICE_MAP[provider] || TOOL_CHOICE_MAP.openai;
    return mapping[mode] || mapping.auto;
  }

  // ─── Private formatters ───────────────────────────────────────────

  /**
   * Format tools for OpenAI-compatible providers.
   * @param {Array<Object>} tools
   * @returns {Array<Object>}
   */
  static _formatOpenAI(tools) {
    return tools.map(t => {
      // If already in OpenAI wrapped format, return as-is
      if (t.type === 'function' && t.function) return t;

      return {
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.parameters || { type: 'object', properties: {} },
        },
      };
    });
  }

  /**
   * Format tools for Anthropic Claude.
   * Anthropic uses: { name, description, input_schema }
   * @param {Array<Object>} tools
   * @returns {Array<Object>}
   */
  static _formatAnthropic(tools) {
    return tools.map(t => {
      // Extract from OpenAI wrapper if present
      const name = t.function?.name || t.name;
      const description = t.function?.description || t.description || '';
      const parameters = t.function?.parameters || t.parameters || { type: 'object', properties: {} };

      return {
        name,
        description,
        input_schema: parameters,
      };
    });
  }

  /**
   * Format tools for Google Gemini.
   * Gemini uses: { function_declarations: [{ name, description, parameters }] }
   * Note: Gemini's parameters use a subset of JSON Schema.
   * @param {Array<Object>} tools
   * @returns {Object} Single object with function_declarations array
   */
  static _formatGoogle(tools) {
    const declarations = tools.map(t => {
      const name = t.function?.name || t.name;
      const description = t.function?.description || t.description || '';
      const parameters = t.function?.parameters || t.parameters || { type: 'object', properties: {} };

      // Gemini doesn't support all JSON Schema features — strip unsupported fields
      const cleanParams = ToolFormatAdapter._cleanSchemaForGemini(parameters);

      return {
        name,
        description,
        parameters: cleanParams,
      };
    });

    return { function_declarations: declarations };
  }

  /**
   * Format tools for Mistral.
   * Mistral uses OpenAI format but may benefit from description at top level.
   * @param {Array<Object>} tools
   * @returns {Array<Object>}
   */
  static _formatMistral(tools) {
    return tools.map(t => {
      if (t.type === 'function' && t.function) return t;

      return {
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.parameters || { type: 'object', properties: {} },
        },
      };
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────

  /**
   * Parse JSON arguments with robust error handling.
   * @param {string} str - JSON string to parse
   * @returns {Object} Parsed arguments or error wrapper
   */
  static _parseArguments(str) {
    if (!str || typeof str !== 'string') return {};

    try {
      const parsed = JSON.parse(str);
      return typeof parsed === 'object' && parsed !== null ? parsed : { value: parsed };
    } catch {
      // Try to fix common JSON issues
      try {
        let fixed = str.trim();
        // Remove trailing commas
        fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
        // Ensure closing brace
        if (!fixed.endsWith('}') && !fixed.endsWith(']')) fixed += '}';
        const parsed = JSON.parse(fixed);
        return typeof parsed === 'object' && parsed !== null ? parsed : { value: parsed };
      } catch {
        return { _raw: str, _error: 'Could not parse arguments' };
      }
    }
  }

  /**
   * Clean a JSON Schema for Gemini compatibility.
   * Gemini doesn't support: $ref, $defs, allOf, oneOf, anyOf at parameter level,
   * additionalProperties, patternProperties, etc.
   * @param {Object} schema - JSON Schema object
   * @returns {Object} Cleaned schema
   */
  static _cleanSchemaForGemini(schema) {
    if (!schema || typeof schema !== 'object') return schema;

    const cleaned = { ...schema };

    // Remove unsupported top-level fields
    delete cleaned.$ref;
    delete cleaned.$defs;
    delete cleaned.$schema;
    delete cleaned.allOf;
    delete cleaned.oneOf;
    delete cleaned.anyOf;
    delete cleaned.additionalProperties;
    delete cleaned.patternProperties;

    // Recursively clean properties
    if (cleaned.properties && typeof cleaned.properties === 'object') {
      const cleanProps = {};
      for (const [key, prop] of Object.entries(cleaned.properties)) {
        cleanProps[key] = ToolFormatAdapter._cleanSchemaForGemini(prop);
      }
      cleaned.properties = cleanProps;
    }

    // Clean items for array types
    if (cleaned.items) {
      cleaned.items = ToolFormatAdapter._cleanSchemaForGemini(cleaned.items);
    }

    return cleaned;
  }
}

export default ToolFormatAdapter;
