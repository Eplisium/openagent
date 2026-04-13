/**
 * 🖥️ Console Output Adapter — Routes output to process.stdout (current CLI behavior)
 */

import chalk from '../utils/chalk-compat.js';
import { OutputAdapter } from './OutputAdapter.js';

export class ConsoleSink extends OutputAdapter {
  constructor(options = {}) {
    super();
    this.verbose = options.verbose || false;
    this.silent = options.silent || false;
  }

  write(content, metadata = {}) {
    if (this.silent) return;
    
    const type = metadata.type || 'text';
    
    switch (type) {
      case 'error':
        console.error(chalk.red(content));
        break;
      case 'warning':
        console.warn(chalk.yellow(content));
        break;
      case 'status':
        console.log(chalk.dim(content));
        break;
      case 'tool_start':
        if (this.verbose) {
          console.log(chalk.cyan(`🔧 ${metadata.tool || 'tool'}: ${content}`));
        }
        break;
      case 'tool_end':
        if (this.verbose) {
          const status = metadata.success ? chalk.green('✓') : chalk.red('✗');
          console.log(`${status} ${metadata.tool || 'tool'} (${metadata.duration || '0ms'})`);
        }
        break;
      default:
        console.log(content);
    }
  }

  writeEvent(eventType, data = {}) {
    if (this.silent) return;
    
    if (this.verbose) {
      console.log(chalk.dim(`[${eventType}]`), JSON.stringify(data).slice(0, 200));
    }
  }

  get channelType() {
    return 'console';
  }
}

export default ConsoleSink;
