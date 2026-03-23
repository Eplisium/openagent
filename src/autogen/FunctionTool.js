/**
 * 🧰 FunctionTool
 * AutoGen-style function wrapper with separate registration controls for LLM and execution.
 */

export class FunctionTool {
  /**
   * @param {Function} fn
   * @param {object} options
   */
  constructor(fn, options = {}) {
    if (typeof fn !== 'function') {
      throw new Error('FunctionTool requires a function as first argument');
    }

    this.fn = fn;
    this.name = options.name;
    this.description = options.description || '';
    this.parameters = options.parameters || { type: 'object', properties: {} };
    this.registerForLlm = options.registerForLlm !== false;
    this.registerForExecution = options.registerForExecution !== false;

    if (!this.name || typeof this.name !== 'string') {
      throw new Error('FunctionTool requires a non-empty name');
    }
  }

  /** @returns {{name:string, description:string, parameters:object}} */
  getSchema() {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    };
  }

  /** @param {object} args */
  async execute(args = {}) {
    return this.fn(args);
  }

  /** Convert to OpenAgent ToolRegistry format. */
  toToolRegistryFormat() {
    const self = this;
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      category: 'autogen',
      enabled: this.registerForExecution,
      async execute(args) {
        return self.execute(args);
      },
    };
  }
}

export default FunctionTool;
