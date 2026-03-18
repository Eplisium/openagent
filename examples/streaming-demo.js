/**
 * 🌊 Streaming Demo
 * Demonstrates real-time streaming with beautiful effects
 * 
 * NOTE: Set DEFAULT_MODEL in .env before running this demo
 */

import { OpenRouterClient } from '../src/OpenRouterClient.js';
import { CONFIG } from '../src/config.js';
import * as ui from '../src/utils.js';

async function runStreamingDemo() {
  ui.clearScreen();
  ui.printTitle('🌊 STREAMING RESPONSES DEMO');
  
  const model = process.env.DEFAULT_MODEL || CONFIG.FALLBACK_MODEL;
  if (!model) {
    ui.printError('No model specified. Set DEFAULT_MODEL in .env');
    process.exit(1);
  }
  
  ui.printInfo(`Using model: ${model}\n`);
  
  const client = new OpenRouterClient();
  
  // Test prompts
  const prompts = [
    {
      title: 'Creative Writing',
      prompt: 'Write a short story opening about a space explorer discovering an ancient artifact.',
    },
    {
      title: 'Code Explanation',
      prompt: 'Explain how async/await works in JavaScript with examples.',
    },
    {
      title: 'Step-by-Step',
      prompt: 'List 5 steps to learn machine learning, with brief explanations.',
    },
  ];
  
  for (const test of prompts) {
    ui.printBox(`📝 ${test.title}`, 'info');
    ui.printInfo(`Prompt: ${test.prompt}\n`);
    
    const stream = client.chatStream(test.prompt, { model });
    
    process.stdout.write(ui.colors.secondary('🤖 '));
    
    let fullContent = '';
    let tokenCount = 0;
    const startTime = Date.now();
    
    for await (const chunk of stream) {
      if (chunk.type === 'content') {
        ui.printStreamingChunk(chunk.content, tokenCount === 0);
        fullContent += chunk.content;
        tokenCount++;
      }
    }
    
    const duration = Date.now() - startTime;
    console.log('\n');
    ui.printInfo(`Tokens: ~${tokenCount} | Duration: ${duration}ms`);
    ui.printDivider();
  }
  
  // Single streaming example
  ui.printBox('🎯 Interactive Streaming Example', 'info');
  
  const prompt = 'Write a haiku about programming.';
  ui.printInfo(`Prompt: "${prompt}"\n`);
  
  const stream = client.chatStream(prompt, { model });
  
  process.stdout.write(ui.colors.secondary('🤖 '));
  
  for await (const chunk of stream) {
    if (chunk.type === 'content') {
      process.stdout.write(chunk.content);
    }
  }
  
  console.log('\n');
  ui.printBox('✨ Streaming Demo Complete!', 'success');
}

runStreamingDemo().catch(error => {
  console.error('Demo failed:', error);
  process.exit(1);
});
