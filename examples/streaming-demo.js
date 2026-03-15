/**
 * 🌊 Streaming Demo
 * Demonstrates real-time streaming with beautiful effects
 */

import { OpenRouterClient } from '../src/OpenRouterClient.js';
import { MODELS } from '../src/config.js';
import * as ui from '../src/utils.js';

async function runStreamingDemo() {
  ui.clearScreen();
  ui.printTitle('🌊 STREAMING RESPONSES DEMO');
  
  const client = new OpenRouterClient();
  
  // Test prompts
  const prompts = [
    {
      title: 'Creative Writing',
      prompt: 'Write a short story opening about a space explorer discovering an ancient artifact.',
      model: MODELS.CLAUDE_SONNET_4,
    },
    {
      title: 'Code Explanation',
      prompt: 'Explain how async/await works in JavaScript with examples.',
      model: MODELS.GPT_5_4,
    },
    {
      title: 'Step-by-Step',
      prompt: 'List 5 steps to learn machine learning, with brief explanations.',
      model: MODELS.GEMINI_2_FLASH,
    },
  ];
  
  for (const test of prompts) {
    ui.printBox(`📝 ${test.title}`, 'info');
    ui.printInfo(`Model: ${test.model}`);
    ui.printInfo(`Prompt: ${test.prompt}\n`);
    
    const stream = client.chatStream(test.prompt, { model: test.model });
    
    process.stdout.write(ui.colors.secondary('🤖 '));
    
    let fullContent = '';
    let tokenCount = 0;
    const startTime = Date.now();
    
    for await (const chunk of stream) {
      if (chunk.type === 'content') {
        ui.printStreamingChunk(chunk.content, tokenCount === 0);
        fullContent += chunk.content;
        tokenCount++;
      } else if (chunk.type === 'done') {
        const duration = Date.now() - startTime;
        console.log('\n');
        
        ui.printBox(
          `${ui.colors.success('✓ Stream Complete')}\n` +
          `${ui.colors.muted(`Duration: ${duration}ms | Tokens: ${chunk.usage?.completion_tokens || 'N/A'}`)}`,
          'success'
        );
      }
    }
    
    ui.printDivider();
    await ui.sleep(1000);
  }
  
  // Interactive streaming test
  ui.printBox('💬 Interactive Streaming Test', 'info');
  ui.printInfo('Type your own prompt (or "exit" to quit):\n');
  
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  const askQuestion = () => {
    return new Promise((resolve) => {
      rl.question(ui.colors.primary('Your prompt: '), resolve);
    });
  };
  
  while (true) {
    const prompt = await askQuestion();
    
    if (prompt.toLowerCase() === 'exit') break;
    if (!prompt.trim()) continue;
    
    console.log('');
    const stream = client.chatStream(prompt, { model: MODELS.GPT_5_MINI });
    
    process.stdout.write(ui.colors.secondary('🤖 '));
    
    for await (const chunk of stream) {
      if (chunk.type === 'content') {
        ui.printStreamingChunk(chunk.content);
      } else if (chunk.type === 'done') {
        console.log('\n');
      }
    }
    
    console.log('');
  }
  
  rl.close();
  ui.printSuccess('Streaming demo complete!');
}

runStreamingDemo().catch(console.error);
