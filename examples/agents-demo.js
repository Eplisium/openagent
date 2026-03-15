/**
 * 🤖 AI Agents Demo
 * Multi-step agent with planning and execution
 */

import { OpenRouterClient } from '../src/OpenRouterClient.js';
import { MODELS } from '../src/config.js';
import * as ui from '../src/utils.js';

class Agent {
  constructor(name, model, systemPrompt) {
    this.name = name;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.client = new OpenRouterClient();
    this.messages = [{ role: 'system', content: systemPrompt }];
    this.memory = new Map();
  }

  async think(task) {
    ui.printInfo(`${this.name} is thinking...`);
    
    this.messages.push({ role: 'user', content: task });
    
    const result = await this.client.chat(this.messages, {
      model: this.model,
      temperature: 0.7,
    });
    
    this.messages.push({
      role: 'assistant',
      content: result.content,
    });
    
    return result.content;
  }

  async act(action) {
    ui.printInfo(`${this.name} is acting: ${action}`);
    // Simulate action execution
    await ui.sleep(500);
    return `Completed: ${action}`;
  }

  remember(key, value) {
    this.memory.set(key, value);
    ui.printInfo(`${this.name} remembered: ${key}`);
  }

  recall(key) {
    return this.memory.get(key);
  }
}

async function runAgentsDemo() {
  ui.clearScreen();
  ui.printTitle('🤖 AI AGENTS DEMO');
  
  // Define specialized agents
  const agents = {
    planner: new Agent(
      '📋 Planner',
      MODELS.GPT_5_4,
      `You are a planning agent. Break down complex tasks into specific, actionable steps.
       Output your plan as a numbered list. Be concise and clear.`
    ),
    
    researcher: new Agent(
      '🔍 Researcher',
      MODELS.CLAUDE_SONNET_4,
      `You are a research agent. Gather information and provide detailed, accurate responses.
       Always cite your sources and be thorough in your analysis.`
    ),
    
    coder: new Agent(
      '💻 Coder',
      MODELS.GPT_5_4,
      `You are a coding agent. Write clean, efficient, well-documented code.
       Follow best practices and explain your implementation.`
    ),
    
    reviewer: new Agent(
      '✅ Reviewer',
      MODELS.CLAUDE_SONNET_4,
      `You are a review agent. Analyze work for quality, correctness, and improvements.
       Provide constructive feedback and suggestions.`
    ),
  };
  
  // Demo 1: Research Assistant
  ui.printBox('📍 DEMO 1: Research Assistant Workflow', 'info');
  
  const researchTask = 'Research and summarize the latest advancements in quantum computing in 2025-2026';
  
  ui.printInfo(`Task: ${researchTask}\n`);
  
  // Step 1: Plan
  ui.printDivider();
  ui.printInfo('Step 1: Creating Research Plan');
  const plan = await agents.planner.think(
    `Create a research plan for: "${researchTask}". List 3-4 specific areas to investigate.`
  );
  ui.printBox(`${ui.colors.secondary('Research Plan:')}\n${plan}`, 'default');
  
  // Step 2: Research
  ui.printDivider();
  ui.printInfo('Step 2: Conducting Research');
  const research = await agents.researcher.think(
    `Execute this research plan:\n${plan}\n\nProvide detailed findings for each area.`
  );
  ui.printBox(`${ui.colors.secondary('Research Findings:')}\n${research}`, 'default');
  
  // Step 3: Review
  ui.printDivider();
  ui.printInfo('Step 3: Reviewing Research');
  const review = await agents.reviewer.think(
    `Review this research:\n${research}\n\nEvaluate completeness, accuracy, and suggest improvements.`
  );
  ui.printBox(`${ui.colors.secondary('Review:')}\n${review}`, 'default');
  
  await ui.sleep(2000);
  
  // Demo 2: Code Generation Pipeline
  ui.printBox('📍 DEMO 2: Code Generation Pipeline', 'info');
  
  const codingTask = 'Create a Python function to fetch and parse JSON data from an API with error handling and retries';
  
  ui.printInfo(`Task: ${codingTask}\n`);
  
  // Step 1: Plan
  ui.printDivider();
  ui.printInfo('Step 1: Planning Implementation');
  const codePlan = await agents.planner.think(
    `Break down this coding task into steps: "${codingTask}"`
  );
  ui.printBox(`${ui.colors.secondary('Implementation Plan:')}\n${codePlan}`, 'default');
  
  // Step 2: Code
  ui.printDivider();
  ui.printInfo('Step 2: Writing Code');
  const code = await agents.coder.think(
    `Implement this plan:\n${codePlan}\n\nProvide complete, working code.`
  );
  ui.printBox(`${ui.colors.secondary('Generated Code:')}\n${code}`, 'default');
  
  // Step 3: Review
  ui.printDivider();
  ui.printInfo('Step 3: Code Review');
  const codeReview = await agents.reviewer.think(
    `Review this code:\n${code}\n\nCheck for bugs, best practices, and improvements.`
  );
  ui.printBox(`${ui.colors.secondary('Code Review:')}\n${codeReview}`, 'default');
  
  await ui.sleep(2000);
  
  // Demo 3: Multi-Agent Debate
  ui.printBox('📍 DEMO 3: Multi-Agent Debate', 'info');
  
  const debateTopic = 'Should AI development be regulated by governments?';
  ui.printInfo(`Topic: ${debateTopic}\n`);
  
  const debater1 = new Agent(
    '👍 Proponent',
    MODELS.GPT_5_4,
    'You are arguing IN FAVOR of AI regulation. Present strong, logical arguments.'
  );
  
  const debater2 = new Agent(
    '👎 Opponent',
    MODELS.CLAUDE_SONNET_4,
    'You are arguing AGAINST AI regulation. Present strong, logical arguments.'
  );
  
  // Round 1
  ui.printDivider();
  ui.printInfo('Round 1: Opening Arguments');
  
  const arg1 = await debater1.think(`Present your opening argument for: "${debateTopic}"`);
  ui.printBox(`${ui.colors.success('Proponent:')}\n${arg1}`, 'success');
  
  const arg2 = await debater2.think(`Respond to this argument: "${arg1}"`);
  ui.printBox(`${ui.colors.error('Opponent:')}\n${arg2}`, 'error');
  
  // Round 2
  ui.printDivider();
  ui.printInfo('Round 2: Rebuttals');
  
  const rebuttal1 = await debater1.think(`Counter this argument: "${arg2}"`);
  ui.printBox(`${ui.colors.success('Proponent Rebuttal:')}\n${rebuttal1}`, 'success');
  
  const rebuttal2 = await debater2.think(`Final response to: "${rebuttal1}"`);
  ui.printBox(`${ui.colors.error('Opponent Rebuttal:')}\n${rebuttal2}`, 'error');
  
  // Summary
  ui.printDivider();
  ui.printInfo('Generating Summary...');
  const summary = await agents.planner.think(
    `Summarize this debate concisely:\n\nProponent: ${arg1}\n${rebuttal1}\n\nOpponent: ${arg2}\n${rebuttal2}`
  );
  ui.printBox(`${ui.colors.secondary('Debate Summary:')}\n${summary}`, 'info');
  
  // Final stats
  ui.printDivider();
  ui.printTitle('📊 AGENT SESSION STATISTICS');
  
  const allClients = [agents.planner, agents.researcher, agents.coder, agents.reviewer, debater1, debater2];
  let totalRequests = 0;
  let totalCost = 0;
  
  for (const agent of allClients) {
    const stats = agent.client.getStats();
    totalRequests += stats.requestCount;
    totalCost += parseFloat(stats.estimatedTotalCost);
  }
  
  const table = ui.createTable(['Metric', 'Value'], [
    ['Total Agents', '6'],
    ['Total Requests', totalRequests.toString()],
    ['Estimated Cost', ui.formatCost(totalCost)],
    ['Tasks Completed', '3'],
  ]);
  
  console.log(table.toString());
  
  ui.printTitle('✨ AGENTS DEMO COMPLETE!');
}

runAgentsDemo().catch(console.error);
