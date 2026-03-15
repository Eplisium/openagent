/**
 * 🛠️ Tool Calling Demo
 * Advanced function calling with OpenRouter
 */

import { OpenRouterClient } from '../src/OpenRouterClient.js';
import { MODELS } from '../src/config.js';
import * as ui from '../src/utils.js';

// Simulated function implementations
const tools = {
  get_weather: async ({ location, unit = 'celsius' }) => {
    // Simulated weather data
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
  
  search_web: async ({ query, num_results = 5 }) => {
    // Simulated search results
    return {
      query,
      results: [
        { title: `Result 1 for "${query}"`, url: 'https://example.com/1', snippet: 'This is a simulated search result...' },
        { title: `Result 2 for "${query}"`, url: 'https://example.com/2', snippet: 'Another simulated result...' },
      ],
      total_results: num_results,
    };
  },
  
  calculate: async ({ expression }) => {
    try {
      // Safe evaluation (in production, use a proper math parser)
      const result = Function('"use strict"; return (' + expression + ')')();
      return { expression, result, success: true };
    } catch (e) {
      return { expression, error: e.message, success: false };
    }
  },
  
  get_datetime: async ({ timezone = 'UTC' }) => {
    const now = new Date();
    return {
      datetime: now.toISOString(),
      timezone,
      formatted: now.toLocaleString('en-US', { timeZone: timezone }),
    };
  },
  
  send_email: async ({ to, subject, body }) => {
    // Simulated email sending
    return {
      success: true,
      message_id: `msg_${Date.now()}`,
      to,
      subject,
      sent_at: new Date().toISOString(),
    };
  },
};

async function runToolDemo() {
  ui.clearScreen();
  ui.printTitle('🛠️ TOOL CALLING DEMO');
  
  const client = new OpenRouterClient();
  
  // Define available tools
  const availableTools = [
    {
      name: 'get_weather',
      description: 'Get current weather information for a location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City name, e.g., "Tokyo, Japan" or "New York"',
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
      name: 'search_web',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          num_results: {
            type: 'integer',
            description: 'Number of results to return (1-10)',
            minimum: 1,
            maximum: 10,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Mathematical expression to evaluate, e.g., "2 + 2" or "sqrt(16)"',
          },
        },
        required: ['expression'],
      },
    },
    {
      name: 'get_datetime',
      description: 'Get current date and time',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Timezone, e.g., "America/New_York", "Europe/London", "UTC"',
          },
        },
      },
    },
    {
      name: 'send_email',
      description: 'Send an email message',
      parameters: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description: 'Recipient email address',
          },
          subject: {
            type: 'string',
            description: 'Email subject',
          },
          body: {
            type: 'string',
            description: 'Email body content',
          },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  ];
  
  // Demo conversations
  const demos = [
    {
      title: '🌤️ Weather Query',
      message: "What's the weather like in San Francisco and Tokyo?",
    },
    {
      title: '🧮 Math Problem',
      message: "Calculate 155 * 23 and then divide by 5. Also, what's 17 squared?",
    },
    {
      title: '🌍 Multi-Tool Query',
      message: "What's the current time in New York? And what's the weather there?",
    },
    {
      title: '📧 Complex Task',
      message: "Send an email to john@example.com about the meeting tomorrow at 2pm.",
    },
  ];
  
  for (const demo of demos) {
    ui.printBox(demo.title, 'info');
    ui.printInfo(`User: ${demo.message}\n`);
    
    const spinner = ui.createSpinner('AI is thinking...');
    spinner.start();
    
    const result = await client.chatWithTools(
      demo.message,
      availableTools,
      { model: MODELS.GPT_5_4 }
    );
    
    spinner.stop();
    
    if (result.content) {
      ui.printBox(`${ui.colors.secondary('AI Response:')}\n${result.content}`, 'default');
    }
    
    // Execute tool calls
    if (result.toolCalls.length > 0) {
      ui.printInfo(`Executing ${result.toolCalls.length} tool call(s)...\n`);
      
      for (const toolCall of result.toolCalls) {
        ui.printToolCall(toolCall);
        
        const toolFn = tools[toolCall.name];
        if (toolFn) {
          try {
            const toolResult = await toolFn(toolCall.arguments);
            ui.printBox(
              `${ui.colors.success('Tool Result:')}\n${ui.formatJSON(toolResult)}`,
              'success'
            );
            
            // Optionally continue conversation with tool results
            // This would be implemented in a full agent loop
          } catch (error) {
            ui.printError(`Tool execution failed: ${error.message}`);
          }
        } else {
          ui.printWarning(`Tool "${toolCall.name}" not implemented`);
        }
      }
    }
    
    ui.printDivider();
    await ui.sleep(1500);
  }
  
  // Interactive tool demo
  ui.printBox('💬 Interactive Tool Demo', 'info');
  ui.printInfo('Available tools: weather, search, calculate, datetime, email');
  ui.printInfo('Try: "What\'s the weather in Paris?" or "Calculate 123 * 456"');
  ui.printInfo('Type "exit" to quit\n');
  
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  const askQuestion = () => {
    return new Promise((resolve) => {
      rl.question(ui.colors.primary('You: '), resolve);
    });
  };
  
  while (true) {
    const message = await askQuestion();
    
    if (message.toLowerCase() === 'exit') break;
    if (!message.trim()) continue;
    
    console.log('');
    const spinner = ui.createSpinner('Processing...');
    spinner.start();
    
    const result = await client.chatWithTools(message, availableTools, {
      model: MODELS.GPT_5_MINI,
    });
    
    spinner.stop();
    
    if (result.content) {
      console.log(ui.formatMessage('assistant', result.content));
    }
    
    if (result.toolCalls.length > 0) {
      result.toolCalls.forEach(tc => ui.printToolCall(tc));
    }
    
    console.log('');
  }
  
  rl.close();
  ui.printSuccess('Tool calling demo complete!');
}

runToolDemo().catch(console.error);
