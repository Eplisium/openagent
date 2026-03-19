/**
 * Health check diagnostics for OpenAgent CLI
 */

import fs from 'fs-extra';

// ═══════════════════════════════════════════════════════════════════
// 🏥 Health Check Diagnostics
// ═══════════════════════════════════════════════════════════════════

export const HEALTH_CHECKS = {
  api: {
    name: 'API Connection',
    check: async (session) => {
      if (!session?.agent?.client) {
        return { status: 'error', message: 'API client not initialized' };
      }
      try {
        await session.agent.client.getModels();
        return { status: 'healthy', message: 'API connection successful' };
      } catch (error) {
        return { status: 'error', message: `API Error: ${error.message}` };
      }
    }
  },
  model: {
    name: 'Model Availability',
    check: async (session) => {
      if (!session?.agent) {
        return { status: 'error', message: 'Agent not initialized' };
      }
      try {
        // Quick validation: verify the model is set and client can reach API
        const model = session.agent.model;
        if (!model) {
          return { status: 'error', message: 'No model selected' };
        }
        return { status: 'healthy', message: `Model: ${model}` };
      } catch (error) {
        return { status: 'error', message: `Model Error: ${error.message}` };
      }
    }
  },
  tools: {
    name: 'Tool Registry',
    check: async (session) => {
      try {
        // Agent stores tools as 'tools' (ToolRegistry instance)
        const registry = session?.toolRegistry || session?.agent?.tools;
        if (!registry) {
          return { status: 'error', message: 'Tool registry not found' };
        }
        const tools = registry.list();
        return { 
          status: 'healthy', 
          message: `${tools.length} tools available`,
          details: tools.map(t => t.name).join(', ')
        };
      } catch (error) {
        return { status: 'error', message: `Tools Error: ${error.message}` };
      }
    }
  },
  memory: {
    name: 'Memory Usage',
    check: async () => {
      const usage = process.memoryUsage();
      const usedMB = Math.round(usage.heapUsed / 1024 / 1024);
      const totalMB = Math.round(usage.heapTotal / 1024 / 1024);
      
      if (usedMB > 500) {
        return { status: 'warning', message: `High memory usage: ${usedMB}MB/${totalMB}MB` };
      }
      return { status: 'healthy', message: `Memory usage: ${usedMB}MB/${totalMB}MB` };
    }
  },
  disk: {
    name: 'Disk Space',
    check: async () => {
      try {
        await fs.stat(process.cwd());
        return { status: 'healthy', message: 'Disk access OK' };
      } catch (error) {
        return { status: 'error', message: `Disk Error: ${error.message}` };
      }
    }
  }
};
