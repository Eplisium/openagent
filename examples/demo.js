/**
 * 🎭 Full Feature Demo
 * Showcases all OpenRouter capabilities
 */

import { OpenRouterClient } from '../src/OpenRouterClient.js';
import { MODELS } from '../src/config.js';
import * as ui from '../src/utils.js';

async function runDemo() {
  ui.clearScreen();
  ui.printTitle('🎭 OPENROUTER FULL FEATURE DEMO');
  
  const client = new OpenRouterClient();
  
  // ========================================
  // 1. Basic Chat
  // ========================================
  ui.printBox('📍 DEMO 1: Basic Chat Completion', 'info');
  
  let spinner = ui.createSpinner('Sending basic chat...');
  spinner.start();
  
  const basicResult = await client.chat(
    'Explain quantum computing in 2 sentences.',
    { model: MODELS.GPT_5_MINI }
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
    { role: 'system', content: 'You are a helpful coding assistant.' },
    { role: 'user', content: 'What is a closure in JavaScript?' },
    { role: 'assistant', content: 'A closure is a function that has access to variables in its outer scope even after the outer function has returned.' },
    { role: 'user', content: 'Give me a simple code example.' },
  ];
  
  spinner = ui.createSpinner('Continuing conversation...');
  spinner.start();
  
  const convResult = await client.chat(messages, { model: MODELS.CLAUDE_SONNET_4 });
  spinner.succeed('Conversation complete!');
  
  ui.printBox(`${ui.colors.secondary('Response:')}\n${convResult.content}`, 'default');
  ui.printUsageStats(convResult.usage, convResult.duration);
  ui.printDivider();
  
  // ========================================
  // 3. Streaming Response
  // ========================================
  ui.printBox('📍 DEMO 3: Streaming Response', 'info');
  
  ui.printInfo('Streaming response (typing effect):\n');
  
  const stream = client.chatStream(
    'Count from 1 to 5, one number per line.',
    { model: MODELS.GPT_5_MINI }
  );
  
  let fullResponse = '';
  for await (const chunk of stream) {
    if (chunk.type === 'content') {
      ui.printStreamingChunk(chunk.content, fullResponse === '');
      fullResponse += chunk.content;
    } else if (chunk.type === 'done') {
      console.log('\n');
      if (chunk.usage) {
        ui.printUsageStats(chunk.usage, 0);
      }
    }
  }
  
  ui.printDivider();
  
  // ========================================
  // 4. Structured Output (JSON)
  // ========================================
  ui.printBox('📍 DEMO 4: Structured JSON Output', 'info');
  
  spinner = ui.createSpinner('Generating structured data...');
  spinner.start();
  
  const schema = {
    name: 'movie_recommendation',
    strict: true,
    definition: {
      type: 'object',
      properties: {
        movies: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              year: { type: 'integer' },
              genre: { type: 'string' },
              rating: { type: 'number', minimum: 0, maximum: 10 },
              reason: { type: 'string' },
            },
            required: ['title', 'year', 'genre', 'rating', 'reason'],
          },
          minItems: 3,
          maxItems: 3,
        },
      },
      required: ['movies'],
    },
  };
  
  const structuredResult = await client.structuredOutput(
    'Recommend 3 sci-fi movies from the 2010s with high ratings.',
    schema,
    { model: MODELS.GPT_5_4 }
  );
  
  spinner.succeed('Structured data generated!');
  
  ui.printBox(
    `${ui.colors.success('Parsed JSON:')}\n${ui.formatJSON(structuredResult.data)}`,
    'success'
  );
  ui.printUsageStats(structuredResult.usage, 0);
  ui.printDivider();
  
  // ========================================
  // 5. Tool/Function Calling
  // ========================================
  ui.printBox('📍 DEMO 5: Tool/Function Calling', 'info');
  
  spinner = ui.createSpinner('Calling tools...');
  spinner.start();
  
  const tools = [
    {
      name: 'get_weather',
      description: 'Get the current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City and state, e.g., San Francisco, CA',
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: 'Temperature unit',
          },
        },
        required: ['location'],
      },
    },
    {
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
  ];
  
  const toolResult = await client.chatWithTools(
    'What\'s the weather in Tokyo and what is 243 * 15?',
    tools,
    { model: MODELS.GPT_5_4 }
  );
  
  spinner.succeed('Tool calls received!');
  
  if (toolResult.content) {
    ui.printBox(`${ui.colors.secondary('Assistant says:')}\n${toolResult.content}`, 'default');
  }
  
  if (toolResult.toolCalls.length > 0) {
    toolResult.toolCalls.forEach(tc => ui.printToolCall(tc));
  }
  
  ui.printDivider();
  
  // ========================================
  // 6. Model Comparison
  // ========================================
  ui.printBox('📍 DEMO 6: Model Comparison', 'info');
  
  const prompt = 'Write a haiku about artificial intelligence.';
  const modelsToCompare = [MODELS.GPT_5_MINI, MODELS.CLAUDE_HAIKU_3, MODELS.GEMINI_2_FLASH];
  
  ui.printInfo(`Prompt: "${prompt}"\n`);
  
  for (const model of modelsToCompare) {
    spinner = ui.createSpinner(`Testing ${model}...`);
    spinner.start();
    
    const result = await client.chat(prompt, { model });
    spinner.succeed(`${model} responded!`);
    
    ui.printBox(
      `${ui.colors.primary.bold(model)}\n${result.content}`,
      'info'
    );
  }
  
  ui.printDivider();
  
  // ========================================
  // 7. Get Available Models
  // ========================================
  ui.printBox('📍 DEMO 7: Fetch Available Models', 'info');
  
  spinner = ui.createSpinner('Fetching models...');
  spinner.start();
  
  const models = await client.getModels();
  spinner.succeed(`Found ${models.length} models!`);
  
  // Show top 5 models
  ui.printInfo('Top 5 Models:');
  models.slice(0, 5).forEach((model, i) => {
    console.log(`  ${i + 1}. ${ui.colors.primary(model.id)} - ${model.name}`);
  });
  
  ui.printDivider();
  
  // ========================================
  // Final Stats
  // ========================================
  ui.printBox('📊 SESSION STATISTICS', 'success');
  
  const stats = client.getStats();
  const table = ui.createTable(['Metric', 'Value'], [
    ['Total Requests', stats.requestCount.toString()],
    ['Estimated Cost', ui.formatCost(parseFloat(stats.estimatedTotalCost))],
    ['Success Rate', '100%'],
  ]);
  
  console.log(table.toString());
  
  ui.printTitle('✨ DEMO COMPLETE!');
  ui.printSuccess('All features demonstrated successfully!');
}

runDemo().catch(error => {
  ui.printError(`Demo failed: ${error.message}`);
  console.error(error);
  process.exit(1);
});
