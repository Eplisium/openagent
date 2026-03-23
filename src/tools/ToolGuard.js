/**
 * 🛡️ ToolGuard - Interactive Approval System for Dangerous Tool Operations
 */

import {
  DEFAULT_PATTERNS,
  matchesAny,
  getDangerReason
} from './guard-rules.js';

export class ToolGuard {
  constructor(options = {}) {
    this.dangerousPatterns = options.dangerousPatterns || DEFAULT_PATTERNS;
    this.autoApprove = options.autoApprove || false;
    this.onApproveRequest = options.onApproveRequest || null;
    this.requireApprovalEveryTime = options.requireApprovalEveryTime || false;
    this.approvedThisSession = new Set();
    this.operationHistory = [];
    this.maxHistorySize = 50;
  }

  shouldGuard(toolName, args) {
    if (matchesAny(toolName, this.dangerousPatterns.tools)) {
      return { guarded: true, reason: getDangerReason(toolName, args) };
    }

    const argsStr = typeof args === 'string' ? args : JSON.stringify(args || '');
    
    if (matchesAny(argsStr, this.dangerousPatterns.shell)) {
      return { guarded: true, reason: 'Arguments contain dangerous shell command' };
    }

    if (matchesAny(argsStr, this.dangerousPatterns.args)) {
      return { guarded: true, reason: 'Arguments contain dangerous patterns' };
    }

    if (matchesAny(argsStr, this.dangerousPatterns.file)) {
      return { guarded: true, reason: 'Target path is outside allowed workspace' };
    }

    return { guarded: false, reason: '' };
  }

  async requestApproval(toolName, args) {
    if (this.autoApprove) {
      this.approveSession(toolName);
      return true;
    }

    if (!this.requireApprovalEveryTime && this.approvedThisSession.has(toolName)) {
      return true;
    }

    if (!this.onApproveRequest) {
      console.warn('[ToolGuard] No approval callback set, denying by default');
      return false;
    }

    try {
      const approved = await this.onApproveRequest(toolName, args);
      if (approved) this.approvedThisSession.add(toolName);
      return approved;
    } catch (error) {
      console.error('[ToolGuard] Error requesting approval:', error);
      return false;
    }
  }

  approveSession(toolName) {
    this.approvedThisSession.add(toolName);
  }

  revokeSession(toolName) {
    this.approvedThisSession.delete(toolName);
  }

  getGuardRules() {
    return [
      { category: 'Tools', patterns: this.dangerousPatterns.tools },
      { category: 'Shell', patterns: this.dangerousPatterns.shell },
      { category: 'Args', patterns: this.dangerousPatterns.args.map(p => p.toString()) },
      { category: 'Files', patterns: this.dangerousPatterns.file.map(p => p.toString()) }
    ];
  }

  addGuardRule(pattern, category = 'args') {
    if (!this.dangerousPatterns[category]) {
      this.dangerousPatterns[category] = [];
    }
    this.dangerousPatterns[category].push(pattern);
  }

  recordOperation(operation) {
    this.operationHistory.push({ ...operation, timestamp: Date.now() });
    if (this.operationHistory.length > this.maxHistorySize) {
      this.operationHistory = this.operationHistory.slice(-this.maxHistorySize);
    }
  }

  getLastOperation() {
    return this.operationHistory[this.operationHistory.length - 1] || null;
  }

  clearHistory() {
    this.operationHistory = [];
  }

  isApproved(toolName) {
    return this.approvedThisSession.has(toolName);
  }
}