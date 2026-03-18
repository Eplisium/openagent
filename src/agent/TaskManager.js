/**
 * 📋 Task Manager v1.0
 * Handles task planning, decomposition, progress tracking, and verification
 * 
 * Inspired by Anthropic's "Effective harnesses for long-running agents":
 * - Feature list with passing/failing status
 * - Progress file for session continuity
 * - Incremental work on ONE feature at a time
 * - Clean state enforcement via git
 * - End-to-end verification requirements
 */

import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';

// ═══════════════════════════════════════════════════════════════════
// 📊 Feature Status
// ═══════════════════════════════════════════════════════════════════

const FeatureStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  PASSING: 'passing',
  FAILING: 'failing',
  BLOCKED: 'blocked',
  SKIPPED: 'skipped',
};

// ═══════════════════════════════════════════════════════════════════
// 🎯 Task Manager
// ═══════════════════════════════════════════════════════════════════

export class TaskManager {
  constructor(options = {}) {
    this.workingDir = options.workingDir || process.cwd();
    this.taskDir = options.taskDir || path.join(this.workingDir, '.openagent-tasks');
    this.progressFile = path.join(this.taskDir, 'progress.json');
    this.featuresFile = path.join(this.taskDir, 'features.json');
    this.planFile = path.join(this.taskDir, 'plan.md');
    this.sessionLog = [];
    this.verbose = options.verbose !== false;
  }

  /**
   * Initialize task environment (first run)
   */
  async initialize(task, options = {}) {
    await fs.ensureDir(this.taskDir);

    // Check if already initialized
    if (await fs.pathExists(this.featuresFile)) {
      if (this.verbose) {
        console.log(chalk.dim('   Task environment already initialized'));
      }
      return await this.loadState();
    }

    // Create initial progress file
    const progress = {
      task: task.substring(0, 500),
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      sessions: [],
      currentFeature: null,
      totalFeatures: 0,
      completedFeatures: 0,
      status: 'initialized',
    };

    await fs.writeJson(this.progressFile, progress, { spaces: 2 });

    if (this.verbose) {
      console.log(chalk.green('   ✓ Task environment initialized'));
      console.log(chalk.dim(`   📁 ${this.taskDir}`));
    }

    return progress;
  }

  /**
   * Create feature list from task decomposition
   */
  async createFeatureList(features) {
    const featureList = {
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      features: features.map((f, i) => ({
        id: `feature_${i + 1}`,
        category: f.category || 'functional',
        description: f.description,
        priority: f.priority || 5,
        steps: f.steps || [],
        status: FeatureStatus.PENDING,
        attempts: 0,
        lastAttempt: null,
        error: null,
        verificationSteps: f.verificationSteps || [],
        dependencies: f.dependencies || [],
      })),
    };

    await fs.writeJson(this.featuresFile, featureList, { spaces: 2 });

    // Update progress
    const progress = await this.loadProgress();
    progress.totalFeatures = featureList.features.length;
    progress.status = 'planning_complete';
    await this.saveProgress(progress);

    if (this.verbose) {
      console.log(chalk.green(`   ✓ Feature list created: ${featureList.features.length} features`));
    }

    return featureList;
  }

  /**
   * Get the next feature to work on
   */
  async getNextFeature() {
    const featureList = await this.loadFeatures();
    if (!featureList) return null;

    // Find highest priority pending feature with satisfied dependencies
    const pendingFeatures = featureList.features
      .filter(f => f.status === FeatureStatus.PENDING || f.status === FeatureStatus.FAILING)
      .filter(f => this.checkDependencies(f, featureList.features))
      .sort((a, b) => b.priority - a.priority);

    return pendingFeatures[0] || null;
  }

  /**
   * Check if feature dependencies are satisfied
   */
  checkDependencies(feature, allFeatures) {
    if (!feature.dependencies || feature.dependencies.length === 0) return true;
    
    return feature.dependencies.every(depId => {
      const dep = allFeatures.find(f => f.id === depId);
      return dep && dep.status === FeatureStatus.PASSING;
    });
  }

  /**
   * Mark feature as in progress
   */
  async startFeature(featureId) {
    const featureList = await this.loadFeatures();
    const feature = featureList.features.find(f => f.id === featureId);
    
    if (!feature) {
      throw new Error(`Feature not found: ${featureId}`);
    }

    feature.status = FeatureStatus.IN_PROGRESS;
    feature.attempts++;
    feature.lastAttempt = new Date().toISOString();
    featureList.updated = new Date().toISOString();

    await fs.writeJson(this.featuresFile, featureList, { spaces: 2 });

    // Update progress
    const progress = await this.loadProgress();
    progress.currentFeature = featureId;
    progress.updated = new Date().toISOString();
    await this.saveProgress(progress);

    this.logSession('start_feature', { featureId, description: feature.description });

    if (this.verbose) {
      console.log(chalk.cyan(`   🎯 Starting feature: ${feature.description}`));
    }

    return feature;
  }

  /**
   * Mark feature as complete (passing)
   */
  async completeFeature(featureId, verification = {}) {
    const featureList = await this.loadFeatures();
    const feature = featureList.features.find(f => f.id === featureId);
    
    if (!feature) {
      throw new Error(`Feature not found: ${featureId}`);
    }

    feature.status = FeatureStatus.PASSING;
    feature.verification = verification;
    feature.completedAt = new Date().toISOString();
    featureList.updated = new Date().toISOString();

    await fs.writeJson(this.featuresFile, featureList, { spaces: 2 });

    // Update progress
    const progress = await this.loadProgress();
    progress.completedFeatures = featureList.features.filter(f => f.status === FeatureStatus.PASSING).length;
    progress.currentFeature = null;
    progress.updated = new Date().toISOString();
    
    // Check if all features complete
    const allComplete = featureList.features.every(f => 
      f.status === FeatureStatus.PASSING || f.status === FeatureStatus.SKIPPED
    );
    if (allComplete) {
      progress.status = 'complete';
    }
    
    await this.saveProgress(progress);

    this.logSession('complete_feature', { featureId, description: feature.description });

    if (this.verbose) {
      console.log(chalk.green(`   ✓ Feature complete: ${feature.description}`));
      console.log(chalk.dim(`   Progress: ${progress.completedFeatures}/${progress.totalFeatures}`));
    }

    return feature;
  }

  /**
   * Mark feature as failed
   */
  async failFeature(featureId, error) {
    const featureList = await this.loadFeatures();
    const feature = featureList.features.find(f => f.id === featureId);
    
    if (!feature) {
      throw new Error(`Feature not found: ${featureId}`);
    }

    feature.status = FeatureStatus.FAILING;
    feature.error = error;
    featureList.updated = new Date().toISOString();

    await fs.writeJson(this.featuresFile, featureList, { spaces: 2 });

    this.logSession('fail_feature', { featureId, description: feature.description, error });

    if (this.verbose) {
      console.log(chalk.red(`   ✗ Feature failed: ${feature.description}`));
      console.log(chalk.dim(`   Error: ${error.substring(0, 100)}`));
    }

    return feature;
  }

  /**
   * Log a session entry
   */
  logSession(action, data) {
    this.sessionLog.push({
      timestamp: new Date().toISOString(),
      action,
      ...data,
    });
  }

  /**
   * Save session log to progress
   */
  async saveSessionLog() {
    const progress = await this.loadProgress();
    progress.sessions.push({
      timestamp: new Date().toISOString(),
      entries: this.sessionLog,
    });
    
    // Keep only last 50 sessions
    if (progress.sessions.length > 50) {
      progress.sessions = progress.sessions.slice(-50);
    }
    
    await this.saveProgress(progress);
    this.sessionLog = [];
  }

  /**
   * Get current status summary
   */
  async getStatus() {
    const progress = await this.loadProgress();
    const featureList = await this.loadFeatures();

    if (!featureList) {
      return { status: 'not_initialized', progress: null, features: null };
    }

    const features = featureList.features;
    const statusCounts = {
      pending: features.filter(f => f.status === FeatureStatus.PENDING).length,
      in_progress: features.filter(f => f.status === FeatureStatus.IN_PROGRESS).length,
      passing: features.filter(f => f.status === FeatureStatus.PASSING).length,
      failing: features.filter(f => f.status === FeatureStatus.FAILING).length,
      blocked: features.filter(f => f.status === FeatureStatus.BLOCKED).length,
      skipped: features.filter(f => f.status === FeatureStatus.SKIPPED).length,
    };

    const currentFeature = features.find(f => f.status === FeatureStatus.IN_PROGRESS);
    const nextFeature = await this.getNextFeature();

    return {
      status: progress.status,
      task: progress.task,
      created: progress.created,
      updated: progress.updated,
      progress: {
        total: features.length,
        completed: statusCounts.passing,
        percentage: features.length > 0 
          ? Math.round((statusCounts.passing / features.length) * 100) 
          : 0,
      },
      statusCounts,
      currentFeature: currentFeature ? {
        id: currentFeature.id,
        description: currentFeature.description,
        attempts: currentFeature.attempts,
      } : null,
      nextFeature: nextFeature ? {
        id: nextFeature.id,
        description: nextFeature.description,
        priority: nextFeature.priority,
      } : null,
      recentSessions: progress.sessions.slice(-5),
    };
  }

  /**
   * Generate progress report for agent context
   */
  async generateProgressReport() {
    const status = await this.getStatus();
    
    if (status.status === 'not_initialized') {
      return 'No task initialized. This is the first session.';
    }

    let report = `## Task Progress Report\n\n`;
    report += `**Task**: ${status.task}\n`;
    report += `**Status**: ${status.status}\n`;
    report += `**Progress**: ${status.progress.completed}/${status.progress.total} features (${status.progress.percentage}%)\n\n`;

    report += `### Feature Status\n`;
    report += `- ✅ Passing: ${status.statusCounts.passing}\n`;
    report += `- 🔄 In Progress: ${status.statusCounts.in_progress}\n`;
    report += `- ⏳ Pending: ${status.statusCounts.pending}\n`;
    report += `- ❌ Failing: ${status.statusCounts.failing}\n`;
    report += `- 🚫 Blocked: ${status.statusCounts.blocked}\n\n`;

    if (status.currentFeature) {
      report += `### Currently Working On\n`;
      report += `- **${status.currentFeature.description}** (attempt ${status.currentFeature.attempts})\n\n`;
    }

    if (status.nextFeature) {
      report += `### Next Up\n`;
      report += `- **${status.nextFeature.description}** (priority: ${status.nextFeature.priority})\n\n`;
    }

    // List all features with status
    const featureList = await this.loadFeatures();
    if (featureList) {
      report += `### All Features\n`;
      for (const f of featureList.features) {
        const icon = {
          [FeatureStatus.PASSING]: '✅',
          [FeatureStatus.IN_PROGRESS]: '🔄',
          [FeatureStatus.PENDING]: '⏳',
          [FeatureStatus.FAILING]: '❌',
          [FeatureStatus.BLOCKED]: '🚫',
          [FeatureStatus.SKIPPED]: '⏭️',
        }[f.status] || '❓';
        
        report += `- ${icon} **${f.id}**: ${f.description}`;
        if (f.error) {
          report += ` (last error: ${f.error.substring(0, 80)})`;
        }
        report += `\n`;
      }
    }

    return report;
  }

  /**
   * Load progress from disk
   */
  async loadProgress() {
    try {
      if (await fs.pathExists(this.progressFile)) {
        return await fs.readJson(this.progressFile);
      }
    } catch (error) {
      // Ignore read errors
    }
    return {
      status: 'not_initialized',
      sessions: [],
      currentFeature: null,
      totalFeatures: 0,
      completedFeatures: 0,
    };
  }

  /**
   * Save progress to disk
   */
  async saveProgress(progress) {
    await fs.writeJson(this.progressFile, progress, { spaces: 2 });
  }

  /**
   * Load features from disk
   */
  async loadFeatures() {
    try {
      if (await fs.pathExists(this.featuresFile)) {
        return await fs.readJson(this.featuresFile);
      }
    } catch (error) {
      // Ignore read errors
    }
    return null;
  }

  /**
   * Load full state
   */
  async loadState() {
    const progress = await this.loadProgress();
    const features = await this.loadFeatures();
    return { progress, features };
  }

  /**
   * Reset task (clear all progress)
   */
  async reset() {
    if (await fs.pathExists(this.taskDir)) {
      await fs.remove(this.taskDir);
    }
    this.sessionLog = [];
  }

  /**
   * Get features summary for system prompt
   */
  async getFeaturesSummary() {
    const featureList = await this.loadFeatures();
    if (!featureList) return null;

    return {
      total: featureList.features.length,
      pending: featureList.features.filter(f => f.status === FeatureStatus.PENDING).length,
      passing: featureList.features.filter(f => f.status === FeatureStatus.PASSING).length,
      failing: featureList.features.filter(f => f.status === FeatureStatus.FAILING).length,
      features: featureList.features.map(f => ({
        id: f.id,
        description: f.description,
        status: f.status,
        priority: f.priority,
      })),
    };
  }
}

export { FeatureStatus };
export default TaskManager;
