/**
 * First-run onboarding wizard for OpenAgent CLI
 * A polished first-run experience using @clack/prompts
 */

import chalk from '../utils/chalk-compat.js';
import * as prompts from '../utils/prompts.js';
import { CONFIG } from '../config.js';
import { themes } from './themes.js';

const theme = themes.luna || themes.catppuccin;
const accent = chalk.hex(theme.accent);
const success = chalk.hex(theme.success);
const errorColor = chalk.hex(theme.error);
const warning = chalk.hex(theme.warning);
const muted = chalk.hex(theme.muted);

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
  const width = Math.min(process.stdout.columns || 80, 60);
  const line = '─'.repeat(width);
  console.log('');
  console.log(muted(`  ${line}`));
  console.log(`  ${accent.bold('Luna')} ${muted('@')} ${accent('OpenAgent')}`);
  console.log(muted(`  ${line}`));
  console.log('');

  prompts.intro(muted("Hey there! I'm Luna. Let's get you set up — this takes 30 seconds."));

  // Step 1: API Key
  const hasApiKey = CONFIG.API_KEY && CONFIG.API_KEY.length > 0;

  if (hasApiKey) {
    prompts.success('API key detected from .env');
  } else {
    prompts.warning('No API key found');
    console.log(muted('  Get one free at https://openrouter.ai/keys\n'));

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
        console.log(errorColor('  ✗ Could not save API key: ' + error.message));
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
    console.log(muted('\n  Opening model browser...\n'));
    finalModel = await modelBrowser.pickModel();
  } else if (selectedModel === 'browse') {
    console.log(warning('  Model browser not available, using default'));
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
  const panelWidth = Math.min(process.stdout.columns || 80, 72);
  const readyRule = muted(`  ── ready ${'─'.repeat(Math.max(1, panelWidth - 11))}`);
  const closeRule = muted(`  ${'─'.repeat(panelWidth)}`);
  console.log('');
  console.log(readyRule);
  console.log(`  ${success('✓')} ${chalk.bold("You're all set! I'll be here whenever you need me.")}`);
  console.log('');
  console.log(`  ${chalk.bold('Quick Start:')}`);
  console.log(`  ${success('•')} Type any message to run as an agentic task`);
  console.log(`  ${success('•')} Use /chat for simple conversations`);
  console.log(`  ${success('•')} Use /templates for common workflows`);
  console.log(`  ${success('•')} Type /help for all commands`);
  console.log('');
  console.log(`  ${muted('See you around! This welcome only shows once.')}`);
  console.log(closeRule);

  prompts.outro(muted('Press Enter to continue...'));

  // Wait for user to press Enter
  await prompts.text('', { placeholder: 'Press Enter...' });

  console.clear();
}
