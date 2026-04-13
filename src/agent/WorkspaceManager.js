import fs from '../utils/fs-compat.js';
import path from 'path';
import {
  createWorkspaceName,
  getDefaultSessionSaveDir,
  getDefaultTaskStateDir,
  getOpenAgentHome,
  getWorkspaceRoot,
} from '../paths.js';

export class WorkspaceManager {
  constructor(options = {}) {
    this.workingDir = path.resolve(options.workingDir || process.cwd());
    this.openAgentDir = getOpenAgentHome(this.workingDir, options.openAgentDir);
    this.sessionsDir = path.resolve(
      options.saveDir || getDefaultSessionSaveDir(this.workingDir, this.openAgentDir)
    );
    this.taskStateDir = path.resolve(
      options.taskDir || getDefaultTaskStateDir(this.workingDir, { openAgentDir: this.openAgentDir })
    );
    this.workspacesDir = path.resolve(
      options.workspaceRoot || getWorkspaceRoot(this.workingDir, this.openAgentDir)
    );
    this.verbose = options.verbose !== false;
  }

  async ensureBaseDirs() {
    await fs.ensureDir(this.openAgentDir);
    await fs.ensureDir(this.sessionsDir);
    await fs.ensureDir(this.workspacesDir);
    await fs.ensureDir(this.taskStateDir);
  }

  async readManifest(workspaceDir) {
    const manifestPath = path.join(workspaceDir, 'manifest.json');
    if (await fs.pathExists(manifestPath)) {
      return fs.readJson(manifestPath);
    }
    return null;
  }

  async prepareTaskWorkspace(task, options = {}) {
    await this.ensureBaseDirs();

    const workspaceDir = path.resolve(
      options.workspaceDir || path.join(this.workspacesDir, createWorkspaceName(task, options.timestamp))
    );

    const notesDir = path.join(workspaceDir, 'notes');
    const artifactsDir = path.join(workspaceDir, 'artifacts');
    const scratchDir = path.join(workspaceDir, 'scratch');
    const manifestPath = path.join(workspaceDir, 'manifest.json');

    await fs.ensureDir(workspaceDir);
    await fs.ensureDir(notesDir);
    await fs.ensureDir(artifactsDir);
    await fs.ensureDir(scratchDir);

    const existingManifest = await this.readManifest(workspaceDir);
    const now = new Date().toISOString();
    const manifest = {
      name: path.basename(workspaceDir),
      task: (options.task || existingManifest?.task || task || '').substring(0, 1000),
      sessionId: options.sessionId || existingManifest?.sessionId || null,
      source: options.source || existingManifest?.source || 'agent-session',
      createdAt: existingManifest?.createdAt || now,
      updatedAt: now,
      workingDir: this.workingDir,
      workspaceDir,
      notesDir,
      artifactsDir,
      scratchDir,
    };

    await fs.writeJson(manifestPath, manifest, { spaces: 2 });

    return {
      workspaceDir,
      manifestPath,
      notesDir,
      artifactsDir,
      scratchDir,
      manifest,
    };
  }

  getInfo() {
    return {
      workingDir: this.workingDir,
      openAgentDir: this.openAgentDir,
      sessionsDir: this.sessionsDir,
      taskStateDir: this.taskStateDir,
      workspacesDir: this.workspacesDir,
    };
  }
}

export default WorkspaceManager;
