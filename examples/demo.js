/**
 * 🎭 Full Feature Demo
 * Showcases all OpenRouter capabilities
 * 
 * NOTE: Set DEFAULT_MODEL in .env before running this demo
 */

import { OpenRouterClient } from '../src/OpenRouterClient.js';
import { CONFIG } from '../src/config.js';
import * as ui from '../src/utils.js';

async function runDemo() {
  ui.clearScreen();
  ui.printTitle('🎭 OPENROUTER FULL FEATURE DEMO');
  
  // Model must be specified via environment
  const model = process.env.DEFAULT_MODEL || CONFIG.FALLBACK_MODEL;
  if (!model) {
    ui.printError('No model specified. Set DEFAULT_MODEL in .env');
    ui.printInfo('Example: DEFAULT_MODEL=anthropic/claude-sonnet-4');
    process.exit(1);
  }
  
  ui.printInfo(`Using model: ${model}\n`);
  
  const client = new OpenRouterClient();
  
  // ========================================
  // 1. Basic Chat
  // ========================================
  ui.printBox('📍 DEMO 1: Basic Chat Completion', 'info');
  
  let spinner = ui.createSpinner('Sending basic chat...');
  spinner.start();
  
  const basicResult = await client.chat(
    'Explain quantum computing in 2 sentences.',
    { model }
  );
  
  spinner.succeed('Basic chat complete!');
  ui.printBox(`${ui.colors.secondary('Response:')}\n${basicResult.content}`, 'default');
  ui.printUsageStats(basicResult.usage, basicResult.duration);
  ui.printDivider();
  
  // ========================================
  // 2. Multi-turn Conversation
  // ========================================
  ui.printBox('📍 DEMO 2: Multi-turn Conversation', 'info');
  
  const messages = [
    { role: 'user', content: 'What is the capital of France?' },
    { role: 'assistant', content: 'The capital of France is Paris.' },
    { role: 'user', content: 'What famous tower is located there?' },
  ];
  
  spinner = ui.createSpinner('Continuing conversation...');
  spinner.start();
  
  const convResult = await client.chat(messages, { model });
  spinner.succeed('Conversation complete!');
  
  ui.printBox(`${ui.colors.secondary('Response:')}\n${convResult.content}`, 'default');
  ui.printUsageStats(convResult.usage, convResult.duration);
  ui.printDivider();
  
  // ========================================
  // 3. Streaming
  // ========================================
  ui.printBox('📍 DEMO 3: Streaming Response', 'info');
  
  ui.printInfo('Streaming response (typing effect):\n');
  
  const stream = client.chatStream(
    'Count from 1 to 5, one number per line.',
    { model }
  );
  
  let fullResponse = '';
  for await (const chunk of stream) {
    if (chunk.type === 'content') {
      process.stdout.write(chunk.content);
      fullResponse += chunk.content;
    }
  }
  
  console.log('\n');
  ui.printUsageStats(stream.usage, stream.duration);
  ui.printDivider();
  
  // ========================================
  // 4. Structured Output (JSON Schema)
  // ========================================
  ui.printBox('📍 DEMO 4: Structured Output (JSON Schema)', 'info');
  
  spinner = ui.createSpinner('Generating structured data...');
  spinner.start();
  
  const schema = {
    name: 'movie_recommendations',
    definition: {
      type: 'object',
      properties: {
        movies: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              year: { type: 'number' },
              genre: { type: 'string' },
              rating: { type: 'number' },
            },
            required: ['title', 'year', 'genre', 'rating'],
          },
        },
      },
      required: ['movies'],
    },
  };
  
  const structuredResult = await client.structuredOutput(
    'Recommend 3 sci-fi movies from the 2010s with high ratings.',
    schema,
    { model }
  );
  
  spinner.succeed('Structured data generated!');
  
  ui.printBox(
    `${ui.colors.secondary('Movies:')}\n${JSON.stringify(structuredResult.data, null, 2)}`,
    'default'
  );
  ui.printUsageStats(structuredResult.usage);
  ui.printDivider();
  
  // ========================================
  // 5. Tool/Function Calling
  // ========================================
  ui.printBox('📍 DEMO 5: Tool/Function Calling', 'info');
  
  spinner = ui.createSpinner('Sending request with tools...');
  spinner.start();
  
  const tools = [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the current weather in a given location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g. San Francisco, CA',
            },
            unit: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
            },
          },
          required: ['location'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'calculate',
        description: 'Perform a mathematical calculation',
        parameters: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description: 'Mathematical expression to evaluate',
            },
          },
          required: ['expression'],
        },
      },
    },
  ];
  
  const toolResult = await client.chatWithTools(
    'What\'s the weather in Tokyo and what is 243 * 15?',
    tools,
    { model }
  );
  
  spinner.succeed('Tool calls received!');
  
  if (toolResult.content) {
    ui.printBox(`${ui.colors.secondary('Content:')}\n${toolResult.content}`, 'default');
  }
  
  if (toolResult.toolCalls && toolResult.toolCalls.length > 0) {
    ui.printBox(
      `${ui.colors.secondary('Tool Calls:')}\n${JSON.stringify(toolResult.toolCalls, null, 2)}`,
      'default'
    );
  }
  
  ui.printUsageStats(toolResult.usage, toolResult.duration);
  ui.printDivider();
  
  // ========================================
  // 6. Get Available Models
  // ========================================
  ui.printBox('📍 DEMO 6: Fetch Available Models', 'info');
  
  spinner = ui.createSpinner('Fetching models...');
  spinner.start();
  
  const models = await client.getModels();
  spinner.succeed(`Found ${models.length} models!`);
  
  // Show first 10 models
  const sampleModels = models.slice(0, 10);
  ui.printBox(
    `${ui.colors.secondary('Sample Models:')}\n${sampleModels.map(m => `• ${m.id}`).join('\n')}\n\n... and ${models.length - 10} more`,
    'default'
  );
  ui.printDivider();
  
  // ========================================
  // Summary
  // ========================================
  ui.printBox('✨ Demo Complete!', 'success');
  ui.printInfo('All features demonstrated successfully!');
  ui.printInfo(`Total cost: $${client.totalCost.toFixed(4)}`);
}

runDemo().catch(error => {
  console.error('Demo failed:', error);
  process.exit(1);
});
