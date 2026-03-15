/**
 * 💬 Interactive Chat Interface
 * A beautiful CLI chat experience with OpenRouter
 */

import { OpenRouterClient } from '../src/OpenRouterClient.js';
import { MODELS, MODEL_CATEGORIES } from '../src/config.js';
import * as ui from '../src/utils.js';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.join(__dirname, '../.chat-history.json');

class InteractiveChat {
  constructor() {
    this.client = new OpenRouterClient();
    this.messages = [];
    this.currentModel = MODELS.GPT_5_4;
    this.streaming = true;
    this.saveHistory = true;
    this.sessionStartTime = Date.now();
  }

  async start() {
    ui.clearScreen();
    ui.printTitle('💬 OPENROUTER INTERACTIVE CHAT');
    
    // Load previous history
    await this.loadHistory();
    
    ui.printBox(
      `${ui.gradients.success('Welcome to Interactive Chat!')}\n\n` +
      `Current Model: ${ui.colors.primary(this.currentModel)}\n` +
      `Streaming: ${this.streaming ? ui.colors.success('ON') : ui.colors.warning('OFF')}\n\n` +
      `${ui.colors.muted('Commands:')}\n` +
      `  /model    - Change model\n` +
      `  /stream   - Toggle streaming\n` +
      `  /clear    - Clear conversation\n` +
      `  /save     - Save conversation\n` +
      `  /history  - Show conversation stats\n` +
      `  /help     - Show all commands\n` +
      `  /exit     - Quit`,
      'info'
    );
    
    // Add system message
    this.messages.push({
      role: 'system',
      content: 'You are a helpful, friendly AI assistant. Be concise but thorough.'
    });
    
    await this.chatLoop();
  }

  async chatLoop() {
    while (true) {
      const { input } = await inquirer.prompt([{
        type: 'input',
        name: 'input',
        message: ui.colors.primary('You:'),
        prefix: '👤',
      }]);
      
      const trimmed = input.trim();
      
      // Handle commands
      if (trimmed.startsWith('/')) {
        const shouldContinue = await this.handleCommand(trimmed);
        if (!shouldContinue) break;
        continue;
      }
      
      if (!trimmed) continue;
      
      // Add user message
      this.messages.push({ role: 'user', content: trimmed });
      
      // Get AI response
      await this.getAIResponse();
    }
    
    await this.saveHistory();
    ui.printSuccess('Chat history saved. Goodbye! 👋');
  }

  async getAIResponse() {
    try {
      if (this.streaming) {
        await this.getStreamingResponse();
      } else {
        await this.getStandardResponse();
      }
    } catch (error) {
      ui.printError(`Error: ${error.message}`);
      // Remove the failed user message
      this.messages.pop();
    }
  }

  async getStandardResponse() {
    const spinner = ui.createSpinner('Thinking...');
    spinner.start();
    
    const result = await this.client.chat(this.messages, {
      model: this.currentModel,
    });
    
    spinner.stop();
    
    // Display response
    console.log('\n' + ui.formatMessage('assistant', result.content));
    
    // Add to conversation
    this.messages.push({
      role: 'assistant',
      content: result.content,
    });
    
    // Show usage
    if (result.usage) {
      ui.printInfo(`Tokens: ${result.usage.total_tokens} | Time: ${result.duration}ms`);
    }
  }

  async getStreamingResponse() {
    process.stdout.write('\n🤖 ');
    
    const stream = this.client.chatStream(this.messages, {
      model: this.currentModel,
    });
    
    let fullContent = '';
    
    for await (const chunk of stream) {
      if (chunk.type === 'content') {
        process.stdout.write(ui.colors.secondary(chunk.content));
        fullContent += chunk.content;
      } else if (chunk.type === 'done') {
        console.log('\n');
        if (chunk.usage) {
          ui.printInfo(`Tokens: ${chunk.usage.total_tokens}`);
        }
      }
    }
    
    // Add to conversation
    this.messages.push({
      role: 'assistant',
      content: fullContent,
    });
  }

  async handleCommand(cmd) {
    const [command, ...args] = cmd.slice(1).split(' ');
    
    switch (command.toLowerCase()) {
      case 'exit':
      case 'quit':
        return false;
        
      case 'model':
        await this.changeModel();
        break;
        
      case 'stream':
        this.streaming = !this.streaming;
        ui.printSuccess(`Streaming ${this.streaming ? 'enabled' : 'disabled'}`);
        break;
        
      case 'clear':
        this.messages = [this.messages[0]]; // Keep system message
        ui.printSuccess('Conversation cleared');
        break;
        
      case 'save':
        await this.saveConversation();
        break;
        
      case 'history':
        this.showHistory();
        break;
        
      case 'stats':
        this.showStats();
        break;
        
      case 'help':
        this.showHelp();
        break;
        
      case 'system':
        this.updateSystemMessage(args.join(' '));
        break;
        
      default:
        ui.printWarning(`Unknown command: /${command}`);
    }
    
    return true;
  }

  async changeModel() {
    const categories = {
      'GPT Models': [MODELS.GPT_5_4, MODELS.GPT_5_2, MODELS.GPT_5_MINI],
      'Claude Models': [MODELS.CLAUDE_OPUS_4, MODELS.CLAUDE_SONNET_4, MODELS.CLAUDE_HAIKU_3],
      'Gemini Models': [MODELS.GEMINI_2_5_PRO, MODELS.GEMINI_2_FLASH],
      'Llama Models': [MODELS.LLAMA_4_MAVERICK, MODELS.LLAMA_4_SCOUT],
      'Other': [MODELS.DEEPSEEK_V3, MODELS.MISTRAL_LARGE],
    };
    
    const choices = [];
    for (const [category, models] of Object.entries(categories)) {
      choices.push(new inquirer.Separator(`── ${category} ──`));
      models.forEach(m => choices.push({ name: m, value: m }));
    }
    
    const { model } = await inquirer.prompt([{
      type: 'list',
      name: 'model',
      message: 'Select a model:',
      choices,
      pageSize: 15,
    }]);
    
    this.currentModel = model;
    ui.printSuccess(`Model changed to ${ui.colors.primary(model)}`);
  }

  async saveConversation() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `conversation-${timestamp}.json`;
    const filepath = path.join(__dirname, '../', filename);
    
    const data = {
      timestamp: new Date().toISOString(),
      model: this.currentModel,
      messages: this.messages,
    };
    
    await fs.writeJson(filepath, data, { spaces: 2 });
    ui.printSuccess(`Conversation saved to ${filename}`);
  }

  showHistory() {
    const userMessages = this.messages.filter(m => m.role === 'user');
    const assistantMessages = this.messages.filter(m => m.role === 'assistant');
    
    ui.printBox(
      `${ui.colors.bold('Conversation Statistics')}\n\n` +
      `Total Messages: ${this.messages.length}\n` +
      `User Messages: ${userMessages.length}\n` +
      `AI Responses: ${assistantMessages.length}\n` +
      `Current Model: ${this.currentModel}\n` +
      `Session Duration: ${ui.formatDuration(Date.now() - this.sessionStartTime)}`,
      'info'
    );
  }

  showStats() {
    const stats = this.client.getStats();
    
    ui.printBox(
      `${ui.colors.bold('API Statistics')}\n\n` +
      `Total Requests: ${stats.requestCount}\n` +
      `Estimated Cost: ${stats.estimatedTotalCost}\n` +
      `Recent Requests: ${stats.recentRequests.length}`,
      'info'
    );
  }

  showHelp() {
    ui.printBox(
      `${ui.colors.bold('Available Commands')}\n\n` +
      `/model    - Change the AI model\n` +
      `/stream   - Toggle streaming mode\n` +
      `/clear    - Clear conversation history\n` +
      `/save     - Save conversation to file\n` +
      `/history  - Show conversation stats\n` +
      `/stats    - Show API usage stats\n` +
      `/system   - Update system message\n` +
      `/help     - Show this help\n` +
      `/exit     - Exit the chat`,
      'info'
    );
  }

  updateSystemMessage(content) {
    if (!content) {
      ui.printWarning('Please provide a system message');
      return;
    }
    
    // Update existing system message or add new one
    const systemIndex = this.messages.findIndex(m => m.role === 'system');
    if (systemIndex >= 0) {
      this.messages[systemIndex].content = content;
    } else {
      this.messages.unshift({ role: 'system', content });
    }
    
    ui.printSuccess('System message updated');
  }

  async loadHistory() {
    try {
      if (await fs.pathExists(HISTORY_FILE)) {
        const data = await fs.readJson(HISTORY_FILE);
        // Could restore previous conversation here
      }
    } catch (e) {
      // Ignore load errors
    }
  }

  async saveHistory() {
    try {
      const data = {
        lastSession: new Date().toISOString(),
        messageCount: this.messages.length,
        model: this.currentModel,
      };
      await fs.writeJson(HISTORY_FILE, data);
    } catch (e) {
      // Ignore save errors
    }
  }
}

// Start the chat
const chat = new InteractiveChat();
chat.start().catch(error => {
  ui.printError(`Fatal error: ${error.message}`);
  process.exit(1);
});
