/**
 * 🛠️ Tool Calling Demo
 * Advanced function calling with OpenRouter
 * 
 * NOTE: Set DEFAULT_MODEL in .env before running this demo
 */

import { OpenRouterClient } from '../src/OpenRouterClient.js';
import { CONFIG } from '../src/config.js';
import * as ui from '../src/utils.js';

// Simulated function implementations
const tools = {
  get_weather: async ({ location, unit = 'celsius' }) => {
    const conditions = ['sunny', 'cloudy', 'rainy', 'snowy', 'windy'];
    const temp = Math.floor(Math.random() * 35) - 5;
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    
    return {
      location,
      temperature: unit === 'fahrenheit' ? Math.round(temp * 9/5 + 32) : temp,
      unit,
      condition,
      humidity: Math.floor(Math.random() * 60) + 30,
      wind_speed: Math.floor(Math.random() * 30) + 5,
    };
  },
  
  calculate: async ({ expression }) => {
    try {
      // Safe evaluation for demo purposes
      const result = Function('"use strict"; return (' + expression + ')')();
      return { expression, result };
    } catch (error) {
      return { expression, error: error.message };
    }
  },
};

// Tool definitions for the API
const toolDefinitions = [
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
            description: 'Temperature unit',
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
            description: 'Mathematical expression to evaluate, e.g. "2 + 2" or "15 * 243"',
          },
        },
        required: ['expression'],
      },
    },
  },
];

async function runToolCallingDemo() {
  ui.clearScreen();
  ui.printTitle('🛠️ TOOL CALLING DEMO');
  
  const model = process.env.DEFAULT_MODEL || CONFIG.FALLBACK_MODEL;
  if (!model) {
    ui.printError('No model specified. Set DEFAULT_MODEL in .env');
    process.exit(1);
  }
  
  ui.printInfo(`Using model: ${model}\n`);
  
  const client = new OpenRouterClient();
  
  // ========================================
  // Demo 1: Single Tool Call
  // ========================================
  ui.printBox('📍 DEMO 1: Single Tool Call', 'info');
  
  let spinner = ui.createSpinner('Requesting weather...');
  spinner.start();
  
  const result1 = await client.chatWithTools(
    'What is the weather in Tokyo?',
    toolDefinitions,
    { model }
  );
  
  spinner.succeed('Response received!');
  
  if (result1.toolCalls && result1.toolCalls.length > 0) {
    ui.printBox(
      `${ui.colors.secondary('Tool Calls:')}\n${JSON.stringify(result1.toolCalls, null, 2)}`,
      'default'
    );
    
    // Execute the tool calls
    for (const tc of result1.toolCalls) {
      if (tools[tc.name]) {
        const toolResult = await tools[tc.name](tc.arguments);
        ui.printBox(
          `${ui.colors.secondary(`Tool Result (${tc.name}):`)}\n${JSON.stringify(toolResult, null, 2)}`,
          'success'
        );
      }
    }
  }
  
  ui.printUsageStats(result1.usage, result1.duration);
  ui.printDivider();
  
  // ========================================
  // Demo 2: Multiple Tool Calls
  // ========================================
  ui.printBox('📍 DEMO 2: Multiple Tool Calls', 'info');
  
  spinner = ui.createSpinner('Requesting multiple operations...');
  spinner.start();
  
  const result2 = await client.chatWithTools(
    'What is the weather in New York and London? Also calculate 243 * 15.',
    toolDefinitions,
    { model }
  );
  
  spinner.succeed('Response received!');
  
  if (result2.toolCalls && result2.toolCalls.length > 0) {
    ui.printBox(
      `${ui.colors.secondary('Tool Calls:')}\n${result2.toolCalls.map(tc => `• ${tc.name}(${JSON.stringify(tc.arguments)})`).join('\n')}`,
      'default'
    );
  }
  
  ui.printUsageStats(result2.usage, result2.duration);
  ui.printDivider();
  
  ui.printBox('✨ Tool Calling Demo Complete!', 'success');
}

runToolCallingDemo().catch(error => {
  console.error('Demo failed:', error);
  process.exit(1);
});
