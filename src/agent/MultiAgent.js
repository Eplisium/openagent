/**
 * 🤝 Multi-Agent Orchestrator
 * Coordinate multiple specialized agents for complex tasks
 */

import { Agent } from './Agent.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { fileTools } from '../tools/fileTools.js';
import { shellTools } from '../tools/shellTools.js';
import { webTools } from '../tools/webTools.js';
import { gitTools } from '../tools/gitTools.js';
import chalk from 'chalk';

/**
 * Specialized agent roles
 */
const AGENT_ROLES = {
  planner: {
    name: '📋 Planner',
    systemPrompt: `You are a planning agent. Your job is to break down complex tasks into clear, actionable steps.
Analyze the task, identify dependencies, and create a structured plan.
Output your plan as a numbered list with brief descriptions.
Consider potential issues and edge cases.
Be specific - reference exact file paths and function names.`,
  },
  coder: {
    name: '💻 Coder',
    systemPrompt: `You are an expert coding agent. Write clean, efficient, well-documented code.
Follow best practices for the language/framework being used.
Include error handling and edge cases.
Always read files before editing them.
Use search_in_files to understand existing code patterns.
Test your code when possible.
Explain your implementation choices.`,
  },
  architect: {
    name: '🏗️ Architect',
    systemPrompt: `You are a system architecture agent. Design systems, plan refactors, create project structures.
Analyze existing code to understand patterns and dependencies.
Create detailed, actionable plans with specific file-by-file changes.
Consider scalability, maintainability, and developer experience.`,
  },
  researcher: {
    name: '🔍 Researcher',
    systemPrompt: `You are a research agent. Gather information from the web and codebase.
Be thorough and accurate. Cite sources when possible.
Synthesize findings into clear, actionable insights.
Identify patterns and connections.`,
  },
  reviewer: {
    name: '✅ Reviewer',
    systemPrompt: `You are a code review agent. Analyze code for:
- Correctness and bugs
- Performance issues
- Security vulnerabilities
- Code style and best practices
- Missing error handling
- Test coverage
Provide constructive, specific feedback with suggested fixes.
Reference exact files and line numbers.`,
  },
  tester: {
    name: '🧪 Tester',
    systemPrompt: `You are a testing agent. Create and run tests for code.
Write unit tests, integration tests, and edge case tests.
Run tests and analyze results.
Report failures with clear reproduction steps.
Suggest fixes for failing tests.`,
  },
};

export class MultiAgent {
  constructor(options = {}) {
    this.options = options;
    this.agents = new Map();
    this.sharedMemory = new Map();
    this.executionLog = [];
    this.maxParallel = options.maxParallel || 3;
    
    // Shared tool registry
    this.sharedTools = new ToolRegistry();
    this.sharedTools.registerAll([
      ...fileTools,
      ...shellTools,
      ...webTools,
      ...gitTools,
    ]);
  }

  /**
   * Create a specialized agent
   */
  createAgent(role, customOptions = {}) {
    const roleConfig = AGENT_ROLES[role];
    if (!roleConfig) {
      throw new Error(`Unknown role: ${role}. Available: ${Object.keys(AGENT_ROLES).join(', ')}`);
    }
    
    const model = customOptions.model || this.options.model;
    if (!model) {
      throw new Error('Model must be specified. Pass model in options or customOptions.');
    }
    
    const agent = new Agent({
      tools: this.sharedTools,
      model,
      systemPrompt: customOptions.systemPrompt || roleConfig.systemPrompt,
      verbose: customOptions.verbose !== false,
      maxIterations: customOptions.maxIterations || 15,
      ...this.options,
      ...customOptions,
    });
    
    this.agents.set(role, agent);
    return agent;
  }

  /**
   * Get or create an agent for a role
   */
  getAgent(role) {
    if (!this.agents.has(role)) {
      this.createAgent(role);
    }
    return this.agents.get(role);
  }

  /**
   * Run a task with the planner → executor → reviewer pipeline
   */
  async pipeline(task, options = {}) {
    const results = {
      task,
      steps: [],
      startTime: Date.now(),
    };
    
    console.log(chalk.cyan('\n🚀 Starting Multi-Agent Pipeline\n'));
    
    // Step 1: Plan
    console.log(chalk.yellow('📋 Step 1: Planning...'));
    const planner = this.getAgent('planner');
    const planResult = await planner.run(`Create a detailed plan for this task:\n\n${task}`);
    results.steps.push({ role: 'planner', result: planResult });
    console.log(chalk.green(`✓ Plan created (${planResult.iterations} iterations)\n`));
    
    // Step 2: Execute (with coder)
    console.log(chalk.yellow('💻 Step 2: Executing...'));
    const coder = this.getAgent('coder');
    const execResult = await coder.run(`Execute this plan:\n\n${planResult.response}\n\nOriginal task: ${task}`);
    results.steps.push({ role: 'coder', result: execResult });
    console.log(chalk.green(`✓ Execution complete (${execResult.iterations} iterations)\n`));
    
    // Step 3: Review
    console.log(chalk.yellow('✅ Step 3: Reviewing...'));
    const reviewer = this.getAgent('reviewer');
    const reviewResult = await reviewer.run(`Review the work done for this task:\n\nOriginal task: ${task}\n\nPlan:\n${planResult.response}\n\nWork completed:\n${execResult.response}`);
    results.steps.push({ role: 'reviewer', result: reviewResult });
    console.log(chalk.green(`✓ Review complete\n`));
    
    results.endTime = Date.now();
    results.duration = results.endTime - results.startTime;
    results.totalIterations = results.steps.reduce((sum, s) => sum + s.result.iterations, 0);
    
    return results;
  }

  /**
   * Run multiple agents in parallel on different aspects of a task
   */
  async parallel(task, aspects, options = {}) {
    const results = {
      task,
      aspects: {},
      startTime: Date.now(),
    };
    
    console.log(chalk.cyan(`\n🚀 Running ${aspects.length} agents in parallel\n`));
    
    // Create agents for each aspect
    const promises = aspects.map(async (aspect, i) => {
      const role = aspect.role || 'coder';
      const agent = this.getAgent(role);
      
      console.log(chalk.yellow(`🤖 Agent ${i + 1} (${role}): ${aspect.description}`));
      
      const result = await agent.run(
        `${aspect.description}\n\nContext: ${task}`
      );
      
      console.log(chalk.green(`✓ Agent ${i + 1} complete`));
      
      return { aspect: aspect.description, role, result };
    });
    
    const parallelResults = await Promise.all(promises);
    
    for (const pr of parallelResults) {
      results.aspects[pr.aspect] = pr;
    }
    
    results.endTime = Date.now();
    results.duration = results.endTime - results.startTime;
    
    return results;
  }

  /**
   * Debate between two agents
   */
  async debate(topic, rounds = 3, options = {}) {
    const results = {
      topic,
      rounds: [],
      startTime: Date.now(),
    };
    
    console.log(chalk.cyan(`\n🎭 Starting Agent Debate: ${topic}\n`));
    
    const debateModel = options.model || this.options.model;
    if (!debateModel) {
      throw new Error('Model must be specified for debate. Pass model in options.');
    }
    
    // Create pro and con agents
    const pro = new Agent({
      tools: this.sharedTools,
      model: debateModel,
      systemPrompt: `You are debating IN FAVOR of the position. Present strong, logical arguments.
Be persuasive but honest. Address counterarguments.`,
      verbose: false,
      maxIterations: 5,
    });
    
    const con = new Agent({
      tools: this.sharedTools,
      model: debateModel,
      systemPrompt: `You are debating AGAINST the position. Present strong, logical arguments.
Be persuasive but honest. Address counterarguments.`,
      verbose: false,
      maxIterations: 5,
    });
    
    let proContext = '';
    let conContext = '';
    
    for (let round = 1; round <= rounds; round++) {
      console.log(chalk.yellow(`\n📢 Round ${round}`));
      
      // Pro argues
      const proPrompt = round === 1
        ? `Argue IN FAVOR of: ${topic}`
        : `Respond to this counter-argument:\n${conContext}\n\nContinue arguing IN FAVOR of: ${topic}`;
      
      const proResult = await pro.run(proPrompt);
      proContext = proResult.response;
      console.log(chalk.green(`  ✓ Pro: ${proContext.substring(0, 100)}...`));
      
      // Con argues
      const conPrompt = `Respond to this argument:\n${proContext}\n\nArgue AGAINST: ${topic}`;
      const conResult = await con.run(conPrompt);
      conContext = conResult.response;
      console.log(chalk.red(`  ✓ Con: ${conContext.substring(0, 100)}...`));
      
      results.rounds.push({
        round,
        pro: proContext,
        con: conContext,
      });
    }
    
    // Generate summary
    const summarizer = this.getAgent('planner');
    const summaryResult = await summarizer.run(
      `Summarize this debate neutrally:\n\nTopic: ${topic}\n\n${results.rounds.map(r => `Round ${r.round}:\nPro: ${r.pro}\nCon: ${r.con}`).join('\n\n')}`
    );
    
    results.summary = summaryResult.response;
    results.endTime = Date.now();
    results.duration = results.endTime - results.startTime;
    
    return results;
  }

  /**
   * Store shared memory
   */
  remember(key, value) {
    this.sharedMemory.set(key, {
      value,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Recall shared memory
   */
  recall(key) {
    const entry = this.sharedMemory.get(key);
    return entry ? entry.value : null;
  }

  /**
   * Get all agents info
   */
  getAgentsInfo() {
    const info = [];
    for (const [role, agent] of this.agents) {
      info.push({
        role,
        stats: agent.getStats(),
        messageCount: agent.messages.length,
      });
    }
    return info;
  }

  /**
   * Clear all agents
   */
  clearAll() {
    for (const [role, agent] of this.agents) {
      agent.clear();
    }
    this.sharedMemory.clear();
    this.executionLog = [];
  }
}

export { AGENT_ROLES };
export default MultiAgent;
