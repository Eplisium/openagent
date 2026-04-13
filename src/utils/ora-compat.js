/**
 * ora-compatible wrapper around nanospinner.
 * Supports: ora({ text, spinner, color }).start()
 *           spinner.text = 'new text'
 *           spinner.succeed(), spinner.fail(), spinner.stop()
 */

import { createSpinner as ns } from 'nanospinner';

export default function ora(options = {}) {
  const text = typeof options === 'string' ? options : (options.text || '');
  const spinner = ns(text);

  // Wrap to support .start() chaining (ora pattern)
  const wrapper = {
    _spinner: spinner,
    _text: text,

    get text() { return this._text; },
    set text(val) {
      this._text = val;
      this._spinner.update({ text: val });
    },

    start(newText) {
      if (newText) {
        this._text = newText;
        this._spinner.start({ text: newText });
      } else {
        this._spinner.start({ text: this._text });
      }
      return this;
    },

    succeed(text) {
      this._spinner.success({ text: text || this._text });
      return this;
    },

    fail(text) {
      this._spinner.error({ text: text || this._text });
      return this;
    },

    warn(text) {
      this._spinner.warn({ text: text || this._text });
      return this;
    },

    info(text) {
      this._spinner.info({ text: text || this._text });
      return this;
    },

    stop() {
      this._spinner.stop();
      return this;
    },

    clear() {
      this._spinner.clear();
      return this;
    },

    update(options) {
      if (typeof options === 'string') {
        this._text = options;
        this._spinner.update({ text: options });
      } else if (options?.text) {
        this._text = options.text;
        this._spinner.update({ text: options.text });
      }
      return this;
    },
  };

  return wrapper;
}
