/**
 * @fileoverview Graph state management — schema definition and state operations.
 *
 * Design decisions:
 * - GraphState is a thin factory that returns a GraphStateSchema instance.
 *   This mirrors the LangGraph pattern of `Annotation.Root({...})`.
 * - GraphStateSchema is the workhorse: it knows how to create, update, and
 *   serialize state objects according to the user-defined field schemas.
 * - Reducers allow custom merge logic (e.g., append-to-array instead of
 *   replace). The default reducer is last-write-wins.
 * - Serialization is JSON-safe: Dates become ISO strings, undefined is
 *   dropped, and Symbols are not supported in state values.
 */

import { GraphStateError } from './errors.js';

// ---------------------------------------------------------------------------
// Default reducer: last-write-wins
// ---------------------------------------------------------------------------
const DEFAULT_REDUCER = (_current, next) => next;

// ---------------------------------------------------------------------------
// GraphStateSchema
// ---------------------------------------------------------------------------

/**
 * Manages the schema for a graph's state object.
 * Instances are created by `GraphState.define()` and consumed by
 * `WorkflowGraph` and `CompiledGraph`.
 */
export class GraphStateSchema {
  /**
   * @param {Record<string, FieldSchema>} fieldSchemas
   *   Map of field name → schema definition.
   *   Each definition may have:
   *   - `default` — initial value (or a zero-arg factory function)
   *   - `reducer` — `(currentValue, update) => newValue` merge function
   *   - `validate` — `(value) => void` throws if invalid
   */
  constructor(fieldSchemas) {
    /** @type {Record<string, NormalizedFieldSchema>} */
    this._fields = {};

    for (const [name, schema] of Object.entries(fieldSchemas)) {
      this._fields[name] = {
        // Support factory functions as defaults (e.g., `default: () => []`)
        default: schema.default,
        reducer: typeof schema.reducer === 'function' ? schema.reducer : DEFAULT_REDUCER,
        validate: typeof schema.validate === 'function' ? schema.validate : null,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Returns the set of known field names.
   * @returns {Set<string>}
   */
  get fields() {
    return new Set(Object.keys(this._fields));
  }

  /**
   * Creates an initial state object by merging schema defaults with the
   * provided input values.
   *
   * @param {Record<string, unknown>} [input={}] - Initial values (take precedence over defaults)
   * @returns {Record<string, unknown>} Initial state
   * @throws {GraphStateError} If input contains unknown fields
   */
  createInitialState(input = {}) {
    // Validate input fields
    this._validateKeys(input, 'createInitialState input');

    const state = {};
    for (const [name, schema] of Object.entries(this._fields)) {
      // Resolve default: support factory functions
      let defaultValue;
      if (typeof schema.default === 'function') {
        defaultValue = schema.default();
      } else if (schema.default !== undefined) {
        // Deep-clone plain-object/array defaults to prevent shared references
        defaultValue = _deepClone(schema.default);
      } else {
        defaultValue = undefined;
      }

      // Input overrides default
      const value = name in input ? input[name] : defaultValue;

      // Run validation if provided
      if (schema.validate && value !== undefined) {
        try {
          schema.validate(value);
        } catch (err) {
          throw new GraphStateError(
            `Initial state validation failed for field "${name}": ${err.message}`,
            { field: name, value }
          );
        }
      }

      state[name] = value;
    }

    return state;
  }

  /**
   * Applies a partial update to the current state using each field's reducer.
   * Unknown fields in `update` cause an error (fail-fast to catch bugs early).
   *
   * @param {Record<string, unknown>} currentState
   * @param {Record<string, unknown>} update - Partial state returned by a node
   * @returns {Record<string, unknown>} New merged state (does not mutate currentState)
   * @throws {GraphStateError} If update contains unknown fields or validation fails
   */
  applyUpdate(currentState, update) {
    if (!update || typeof update !== 'object') {
      // Nodes that return null/undefined produce no state change
      return { ...currentState };
    }

    // Validate update fields
    this._validateKeys(update, 'node update');

    const newState = { ...currentState };

    for (const [name, newValue] of Object.entries(update)) {
      const schema = this._fields[name];
      const reduced = schema.reducer(newState[name], newValue);

      // Run validation on the result
      if (schema.validate && reduced !== undefined) {
        try {
          schema.validate(reduced);
        } catch (err) {
          throw new GraphStateError(
            `State validation failed for field "${name}" after update: ${err.message}`,
            { field: name, value: reduced }
          );
        }
      }

      newState[name] = reduced;
    }

    return newState;
  }

  /**
   * Serializes a state object to a plain JSON-safe object.
   * Strips `undefined` values; does NOT support Symbol values.
   *
   * @param {Record<string, unknown>} state
   * @returns {Record<string, unknown>} JSON-serializable object
   */
  serialize(state) {
    return _deepClone(state);
  }

  /**
   * Deserializes a raw (JSON-parsed) object back into a state object.
   * Applies schema defaults for any missing fields.
   *
   * @param {Record<string, unknown>} raw
   * @returns {Record<string, unknown>} Deserialized state
   */
  deserialize(raw) {
    const state = this.createInitialState({}); // start from defaults
    for (const name of Object.keys(this._fields)) {
      if (name in raw) {
        state[name] = raw[name];
      }
    }
    return state;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Throws if any key in `obj` is not in the schema.
   * @param {object} obj
   * @param {string} context - Label for error messages
   * @private
   */
  _validateKeys(obj, context) {
    const unknown = Object.keys(obj).filter(k => !(k in this._fields));
    if (unknown.length > 0) {
      throw new GraphStateError(
        `Unknown state fields in ${context}: ${unknown.map(k => `"${k}"`).join(', ')}. ` +
        `Known fields: ${Object.keys(this._fields).map(k => `"${k}"`).join(', ')}`,
        { unknownFields: unknown }
      );
    }
  }
}

// ---------------------------------------------------------------------------
// GraphState factory
// ---------------------------------------------------------------------------

/**
 * Factory class for defining graph state schemas.
 *
 * @example
 * const schema = GraphState.define({
 *   messages: { default: () => [], reducer: (cur, upd) => [...cur, ...upd] },
 *   status:   { default: 'idle' },
 *   count:    { default: 0, validate: v => { if (v < 0) throw new Error('Must be >= 0'); } },
 * });
 */
export class GraphState {
  /**
   * Defines a state schema and returns a `GraphStateSchema` instance.
   *
   * @param {Record<string, {
   *   default?: unknown | (() => unknown),
   *   reducer?: (current: unknown, update: unknown) => unknown,
   *   validate?: (value: unknown) => void
   * }>} schema - Field definitions
   * @returns {GraphStateSchema}
   * @throws {TypeError} If schema is not a plain object
   */
  static define(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      throw new TypeError('GraphState.define() expects a plain object schema');
    }
    return new GraphStateSchema(schema);
  }
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/**
 * JSON replacer that converts undefined → omitted, Date → ISO string.
 * Symbols in values will be silently dropped by JSON.stringify already.
 * @private
 */
function _jsonReplacer(_key, value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

/**
 * Fast deep clone using structuredClone (Node 18+).
 * Falls back to JSON round-trip for non-cloneable values.
 * @param {unknown} value
 * @returns {unknown}
 * @private
 */
function _deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    // Non-cloneable values (functions, symbols, etc.) — fallback to JSON round-trip
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

/**
 * @typedef {object} FieldSchema
 * @property {unknown | (() => unknown)} [default] - Default value or factory
 * @property {function} [reducer] - `(current, update) => merged` merge function
 * @property {function} [validate] - `(value) => void` throws on invalid value
 */

/**
 * @typedef {object} NormalizedFieldSchema
 * @property {unknown | (() => unknown) | undefined} default
 * @property {function} reducer
 * @property {function | null} validate
 */
