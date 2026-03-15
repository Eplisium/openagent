/**
 * 📚 Model Browser
 * Dynamic model fetching from OpenRouter with favorites, sorting, and caching
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import inquirer from 'inquirer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '../.model-cache.json');
const FAVORITES_FILE = path.join(__dirname, '../.model-favorites.json');
const RECENTS_FILE = path.join(__dirname, '../.model-recents.json');

const CACHE_TTL = 1000 * 60 * 60; // 1 hour

export class ModelBrowser {
  constructor(client) {
    this.client = client;
    this.models = [];
    this.favorites = [];
    this.recents = [];
    this.loaded = false;
  }

  /**
   * Initialize - load favorites, recents, and fetch/cache models
   */
  async init() {
    await this.loadFavorites();
    await this.loadRecents();
    await this.loadModels();
    this.loaded = true;
  }

  /**
   * Load models from API or cache
   */
  async loadModels() {
    // Check cache first
    try {
      if (await fs.pathExists(CACHE_FILE)) {
        const cache = await fs.readJson(CACHE_FILE);
        if (Date.now() - cache.timestamp < CACHE_TTL) {
          this.models = cache.models;
          return;
        }
      }
    } catch (e) {
      // Cache read failed, fetch fresh
    }

    // Fetch from API
    try {
      const rawModels = await this.client.getModels();
      
      this.models = rawModels.map(m => ({
        id: m.id,
        name: m.name || m.id,
        provider: this.extractProvider(m.id, m.name),
        contextLength: m.context_length || m.top_provider?.context_length || 0,
        maxOutput: m.top_provider?.max_completion_tokens || 4096,
        inputPrice: parseFloat(m.pricing?.prompt || 0) * 1000000, // per million tokens
        outputPrice: parseFloat(m.pricing?.completion || 0) * 1000000,
        modality: m.architecture?.modality || 'text->text',
        inputModalities: m.architecture?.input_modalities || ['text'],
        supportsTools: (m.supported_parameters || []).includes('tools'),
        supportsVision: (m.architecture?.input_modalities || []).includes('image'),
        created: m.created,
      }));

      // Sort by provider then name
      this.models.sort((a, b) => {
        const providerCompare = a.provider.localeCompare(b.provider);
        if (providerCompare !== 0) return providerCompare;
        return a.name.localeCompare(b.name);
      });

      // Cache it
      await fs.writeJson(CACHE_FILE, {
        timestamp: Date.now(),
        models: this.models,
      });

    } catch (error) {
      console.log(chalk.yellow(`⚠ Failed to fetch models: ${error.message}`));
      this.models = [];
    }
  }

  /**
   * Extract provider name from model ID or name
   */
  extractProvider(id, name) {
    // Try from name first (e.g., "OpenAI: GPT-5.4")
    if (name && name.includes(':')) {
      return name.split(':')[0].trim();
    }
    // Fall back to ID prefix (e.g., "openai/gpt-5.4")
    const parts = id.split('/');
    if (parts.length > 1) {
      const provider = parts[0];
      // Capitalize nicely
      return provider.charAt(0).toUpperCase() + provider.slice(1);
    }
    return 'Other';
  }

  /**
   * Get unique providers
   */
  getProviders() {
    const providers = new Set(this.models.map(m => m.provider));
    return Array.from(providers).sort();
  }

  /**
   * Filter models
   */
  filterModels({ provider = null, search = null, toolsOnly = false, visionOnly = false } = {}) {
    let filtered = [...this.models];

    if (provider) {
      filtered = filtered.filter(m => m.provider === provider);
    }

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(m => 
        m.id.toLowerCase().includes(q) || 
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
      );
    }

    if (toolsOnly) {
      filtered = filtered.filter(m => m.supportsTools);
    }

    if (visionOnly) {
      filtered = filtered.filter(m => m.supportsVision);
    }

    return filtered;
  }

  /**
   * Interactive model picker
   */
  async pickModel({ currentModel = null } = {}) {
    const { sortMode } = await inquirer.prompt([{
      type: 'list',
      name: 'sortMode',
      message: 'Browse models by:',
      choices: [
        { name: '⭐ Favorites', value: 'favorites' },
        { name: '🕐 Recently Used', value: 'recents' },
        { name: '🏢 Company', value: 'provider' },
        { name: '🔍 Search', value: 'search' },
        { name: '📋 All Models', value: 'all' },
        new inquirer.Separator(),
        { name: '❌ Cancel', value: 'cancel' },
      ],
    }]);

    if (sortMode === 'cancel') return null;

    if (sortMode === 'favorites') {
      return await this.pickFromFavorites(currentModel);
    }

    if (sortMode === 'recents') {
      return await this.pickFromRecents(currentModel);
    }

    if (sortMode === 'search') {
      return await this.pickBySearch(currentModel);
    }

    if (sortMode === 'provider') {
      return await this.pickByProvider(currentModel);
    }

    // All models
    return await this.pickFromList(this.models, currentModel);
  }

  /**
   * Pick from favorites
   */
  async pickFromFavorites(currentModel) {
    if (this.favorites.length === 0) {
      console.log(chalk.gray('\nNo favorites yet. Use a model and it can be favorited.'));
      return null;
    }

    const favModels = this.favorites
      .map(id => this.models.find(m => m.id === id))
      .filter(Boolean);

    if (favModels.length === 0) {
      console.log(chalk.gray('\nNo favorite models found in current list.'));
      return null;
    }

    return await this.pickFromList(favModels, currentModel, '⭐ Favorites');
  }

  /**
   * Pick from recents
   */
  async pickFromRecents(currentModel) {
    if (this.recents.length === 0) {
      console.log(chalk.gray('\nNo recent models yet.'));
      return null;
    }

    const recentModels = this.recents
      .map(id => this.models.find(m => m.id === id))
      .filter(Boolean);

    return await this.pickFromList(recentModels, currentModel, '🕐 Recent');
  }

  /**
   * Pick by search
   */
  async pickBySearch(currentModel) {
    const { query } = await inquirer.prompt([{
      type: 'input',
      name: 'query',
      message: 'Search models:',
    }]);

    if (!query.trim()) return null;

    const results = this.filterModels({ search: query });
    
    if (results.length === 0) {
      console.log(chalk.gray(`\nNo models found for "${query}"`));
      return null;
    }

    return await this.pickFromList(results, currentModel, `🔍 "${query}"`);
  }

  /**
   * Pick by provider
   */
  async pickByProvider(currentModel) {
    const providers = this.getProviders();
    
    const { provider } = await inquirer.prompt([{
      type: 'list',
      name: 'provider',
      message: 'Select company:',
      choices: [
        ...providers.map(p => ({ name: `${this.getProviderEmoji(p)} ${p}`, value: p })),
        new inquirer.Separator(),
        { name: '← Back', value: 'back' },
      ],
      pageSize: 20,
    }]);

    if (provider === 'back') return this.pickModel({ currentModel });

    const providerModels = this.filterModels({ provider });
    return await this.pickFromList(providerModels, currentModel, `🏢 ${provider}`);
  }

  /**
   * Pick from a list of models
   */
  async pickFromList(models, currentModel, title = 'Models') {
    const choices = models.map(m => {
      const isFav = this.favorites.includes(m.id);
      const isCurrent = m.id === currentModel;
      const contextStr = this.formatContext(m.contextLength);
      const priceStr = m.inputPrice < 0.01 ? 'free' : `$${m.inputPrice.toFixed(2)}/M`;
      
      let prefix = '';
      if (isFav) prefix += '⭐';
      if (isCurrent) prefix += ' ✓';
      
      const label = `${prefix} ${chalk.cyan(m.id)} ${chalk.gray(`[${contextStr} · ${priceStr}]`)}`;
      
      return {
        name: label,
        value: m.id,
        short: m.id,
      };
    });

    choices.push(new inquirer.Separator());
    choices.push({ name: '← Back', value: 'back' });

    const { modelId } = await inquirer.prompt([{
      type: 'list',
      name: 'modelId',
      message: `${title} (${models.length}):`,
      choices,
      pageSize: 20,
    }]);

    if (modelId === 'back') return this.pickModel({ currentModel });

    // Show model details and confirm
    const selected = this.models.find(m => m.id === modelId);
    if (selected) {
      this.printModelDetails(selected);
      
      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'Action:',
        choices: [
          { name: '✓ Use this model', value: 'use' },
          this.favorites.includes(modelId)
            ? { name: '⭐ Remove from favorites', value: 'unfav' }
            : { name: '☆ Add to favorites', value: 'fav' },
          { name: '← Back to list', value: 'back' },
        ],
      }]);

      if (action === 'fav') {
        await this.addFavorite(modelId);
        console.log(chalk.green(`✓ Added ${modelId} to favorites`));
        return modelId;
      }
      if (action === 'unfav') {
        await this.removeFavorite(modelId);
        console.log(chalk.green(`✓ Removed ${modelId} from favorites`));
        return modelId;
      }
      if (action === 'back') {
        return this.pickFromList(models, currentModel, title);
      }
    }

    return modelId;
  }

  /**
   * Print model details
   */
  printModelDetails(model) {
    const isFav = this.favorites.includes(model.id);
    
    console.log(boxen(
      `${chalk.bold(model.name)}\n\n` +
      `${chalk.gray('ID:')} ${chalk.cyan(model.id)}\n` +
      `${chalk.gray('Provider:')} ${model.provider}\n` +
      `${chalk.gray('Context:')} ${this.formatContext(model.contextLength)}\n` +
      `${chalk.gray('Max Output:')} ${this.formatContext(model.maxOutput)}\n` +
      `${chalk.gray('Input Price:')} $${model.inputPrice.toFixed(2)}/M tokens\n` +
      `${chalk.gray('Output Price:')} $${model.outputPrice.toFixed(2)}/M tokens\n` +
      `${chalk.gray('Vision:')} ${model.supportsVision ? '✓' : '✗'}\n` +
      `${chalk.gray('Tools:')} ${model.supportsTools ? '✓' : '✗'}\n` +
      `${chalk.gray('Favorite:')} ${isFav ? '⭐' : '✗'}`,
      { padding: 1, borderStyle: 'round', borderColor: 'cyan' }
    ));
  }

  /**
   * Format context length nicely
   */
  formatContext(n) {
    if (!n) return 'N/A';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'K';
    return n.toString();
  }

  /**
   * Get provider emoji
   */
  getProviderEmoji(provider) {
    const emojis = {
      'Openai': '🟢',
      'Anthropic': '🟠',
      'Google': '🔵',
      'Meta': '🟣',
      'Mistral': '🔴',
      'Deepseek': '🟡',
      'Z-ai': '⚪',
      'Qwen': '🟤',
    };
    return emojis[provider] || '🔘';
  }

  /**
   * Add model to recents
   */
  async addRecent(modelId) {
    this.recents = [modelId, ...this.recents.filter(id => id !== modelId)].slice(0, 20);
    await fs.writeJson(RECENTS_FILE, this.recents);
  }

  /**
   * Load recents
   */
  async loadRecents() {
    try {
      if (await fs.pathExists(RECENTS_FILE)) {
        this.recents = await fs.readJson(RECENTS_FILE);
      }
    } catch (e) {
      this.recents = [];
    }
  }

  /**
   * Add to favorites
   */
  async addFavorite(modelId) {
    if (!this.favorites.includes(modelId)) {
      this.favorites.push(modelId);
      await fs.writeJson(FAVORITES_FILE, this.favorites);
    }
  }

  /**
   * Remove from favorites
   */
  async removeFavorite(modelId) {
    this.favorites = this.favorites.filter(id => id !== modelId);
    await fs.writeJson(FAVORITES_FILE, this.favorites);
  }

  /**
   * Load favorites
   */
  async loadFavorites() {
    try {
      if (await fs.pathExists(FAVORITES_FILE)) {
        this.favorites = await fs.readJson(FAVORITES_FILE);
      }
    } catch (e) {
      this.favorites = [];
    }
  }

  /**
   * Get context length for a model
   */
  getContextLength(modelId) {
    const model = this.models.find(m => m.id === modelId);
    return model?.contextLength || 128000;
  }

  /**
   * Get model info
   */
  getModel(modelId) {
    return this.models.find(m => m.id === modelId);
  }
}

export default ModelBrowser;
