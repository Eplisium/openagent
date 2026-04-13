/**
 * First-run onboarding wizard for OpenAgent CLI
 * A polished first-run experience using @clack/prompts
 */

import chalk from '../utils/chalk-compat.js';
import boxen from 'boxen';
import gradient from 'gradient-string';
import * as prompts from '../utils/prompts.js';
import { CONFIG } from '../config.js';
import { gradients, boxStyles } from '../utils.js';

const g = gradients;
const box = boxStyles;

/**
 * Recommended models with descriptions
 */
const RECOMMENDED_MODELS = [
  { id: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4', hint: 'best all-around', context: 200000 },
  { id: 'openai/gpt-5.3', name: 'GPT-5.3', hint: 'fastest', context: 128000 },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', hint: 'best for code', context: 1000000 },
  { id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5', hint: 'budget-friendly', context: 128000 },
];

/**
 * Run the first-run onboarding wizard.
 * Shows a welcome message with quick-start tips.
 * @param {object} state - Mutable state object (will set firstRun = false)
 * @param {Function} saveState - Async function to persist state
 * @param {object} modelBrowser - Optional model browser instance
 */
export async function runOnboarding(state, saveState, modelBrowser = null) {
  console.clear();

  // Print welcome banner
  console.log(`\n ${g.title('╔═══════════════════════════════════════════════════════════════╗')}
 ${g.title('║')}                                                               ${g.title('║')}
 ${g.title('║')}   ${gradient.rainbow('🌙 Welcome to OpenAgent!')}                                ${g.title('║')}
 ${g.title('║')}                                                               ${g.title('║')}
 ${g.title('╚═══════════════════════════════════════════════════════════════╝')}
 `);

  prompts.intro(chalk.gray("Let's get you set up. This takes 30 seconds."));

  // Step 1: API Key
  const hasApiKey = CONFIG.API_KEY && CONFIG.API_KEY.length > 0;

  if (hasApiKey) {
    prompts.success('API key detected from .env');
  } else {
    prompts.warning('No API key found');
    console.log(chalk.gray('  Get one free at https://openrouter.ai/keys\n'));

    const apiKey = await prompts.password('Paste your API key:', {
      placeholder: 'sk-or-...',
      mask: '•',
    });

    // Save the API key to .env
    if (apiKey && apiKey.trim()) {
      try {
        const fs = await import('../utils/fs-compat.js');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const envPath = path.join(__dirname, '..', '.env');

        let envContent = '';
        try {
          envContent = await fs.readFile(envPath, 'utf-8');
        } catch { /* file doesn't exist yet */ }

        // Check if key already exists
        if (envContent.includes('OPENROUTER_API_KEY=')) {
          envContent = envContent.replace(/OPENROUTER_API_KEY=.*/g, `OPENROUTER_API_KEY=${apiKey.trim()}`);
        } else {
          envContent += `\nOPENROUTER_API_KEY=${apiKey.trim()}\n`;
        }

        await fs.writeFile(envPath, envContent.trim() + '\n');
        prompts.success('API key saved to .env');
      } catch (error) {
        console.log(chalk.red('  ✗ Could not save API key: ' + error.message));
      }
    }
  }

  // Step 2: Preferred Model
  const modelChoices = RECOMMENDED_MODELS.map(model => ({
    value: model.id,
    label: model.name,
    hint: model.hint,
  }));
  modelChoices.push({ value: 'browse', label: 'Browse all models...', hint: '400+ available' });

  const selectedModel = await prompts.select('Pick your default model:', modelChoices, {
    defaultValue: RECOMMENDED_MODELS[0].id,
  });

  let finalModel = selectedModel;

  if (selectedModel === 'browse' && modelBrowser) {
    console.log(chalk.gray('\n  Opening model browser...\n'));
    finalModel = await modelBrowser.pickModel();
  } else if (selectedModel === 'browse') {
    console.log(chalk.yellow('  ⚠ Model browser not available, using default'));
    finalModel = RECOMMENDED_MODELS[0].id;
  }

  // Get model info if possible
  let modelInfo = null;
  if (modelBrowser && finalModel) {
    modelInfo = modelBrowser.getModel(finalModel);
  }

  const selectedModelInfo = RECOMMENDED_MODELS.find(m => m.id === finalModel) || {
    name: finalModel.split('/').pop(),
    context: modelInfo?.contextLength || 128000
  };

  prompts.success(`Selected: ${selectedModelInfo.name}`);

  // Step 3: Preferences
  const streaming = await prompts.confirm('Enable streaming responses?', { defaultValue: true });
  const tokenUsage = await prompts.confirm('Show token usage in prompt?', { defaultValue: true });
  const renderMd = await prompts.confirm('Render markdown in responses?', { defaultValue: true });

  // Save preferences to state
  if (state) {
    state.firstRun = false;
    state.preferences = {
      ...state.preferences,
      streaming,
      showTokenUsage: tokenUsage,
      renderMarkdown: renderMd,
      defaultModel: finalModel,
    };
    await saveState();
  }

  // Completion message
  console.log(boxen(
    `${chalk.green("✅ You're all set!")}\n\n` +
    `${chalk.bold('Quick Start:')}\n` +
    `${chalk.green('•')} Type any message to run as an agentic task\n` +
    `${chalk.green('•')} Use /chat for simple conversations\n` +
    `${chalk.green('•')} Use /templates for common workflows\n` +
    `${chalk.green('•')} Type /help for all commands\n\n` +
    `${chalk.dim('This message will only show once.')}`,
    { ...box.default, title: '🎉 Ready!', titleAlignment: 'center' }
  ));

  prompts.outro(chalk.gray('Press Enter to continue...'));

  // Wait for user to press Enter
  await prompts.text('', { placeholder: 'Press Enter...' });

  console.clear();
}
