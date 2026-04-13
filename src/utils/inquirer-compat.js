/**
 * inquirer-compatible wrapper around @inquirer/prompts.
 * Supports: inquirer.prompt([{ type: 'confirm', message, default }])
 * Returns: { confirm: true/false } or { [name]: value }
 */

import { confirm as inquirerConfirm, input as inquirerInput, select as inquirerSelect } from '@inquirer/prompts';

const PROMPT_MAP = {
  confirm: inquirerConfirm,
  input: inquirerInput,
  list: inquirerSelect,
  select: inquirerSelect,
};

export default {
  async prompt(questions) {
    const results = {};
    const list = Array.isArray(questions) ? questions : [questions];

    for (const q of list) {
      const type = q.type || 'input';
      const handler = PROMPT_MAP[type];

      if (!handler) {
        throw new Error(`Unsupported prompt type: ${type}`);
      }

      const opts = {
        message: q.message,
      };

      if (type === 'confirm') {
        opts.default = q.default ?? false;
      } else if (type === 'input') {
        opts.default = q.default;
      } else if (type === 'list' || type === 'select') {
        opts.choices = q.choices;
        opts.default = q.default;
      }

      const name = q.name || 'confirm';
      results[name] = await handler(opts);
    }

    return results;
  },
};
