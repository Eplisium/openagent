/**
 * 🖼️ Vision/Multimodal Demo
 * Working with image inputs and vision models
 * 
 * NOTE: Requires a vision-capable model. Set VISION_MODEL or DEFAULT_MODEL in .env
 * Examples: openai/gpt-4o, anthropic/claude-sonnet-4, google/gemini-2-flash
 */

import { OpenRouterClient } from '../src/OpenRouterClient.js';
import { CONFIG } from '../src/config.js';
import * as ui from '../src/utils.js';

async function runVisionDemo() {
  ui.clearScreen();
  ui.printTitle('🖼️ VISION & MULTIMODAL DEMO');
  
  // Vision models need to support image input
  const model = process.env.VISION_MODEL || process.env.DEFAULT_MODEL || CONFIG.FALLBACK_MODEL;
  if (!model) {
    ui.printError('No model specified. Set DEFAULT_MODEL or VISION_MODEL in .env');
    ui.printInfo('Vision-capable models: openai/gpt-4o, anthropic/claude-sonnet-4, google/gemini-2-flash');
    process.exit(1);
  }
  
  ui.printInfo(`Using model: ${model}`);
  ui.printInfo('Note: Model must support vision/multimodal input\n');
  
  const client = new OpenRouterClient();
  
  // Sample image URLs (using placeholder images)
  const sampleImages = {
    nature: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800',
    city: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800',
    tech: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800',
  };
  
  ui.printBox(
    `${ui.gradients.success('Vision Model Capabilities')}\n\n` +
    `Vision models can analyze images and answer questions about them.\n` +
    `Supported models: GPT-4o, Claude, Gemini, and more.`,
    'success'
  );
  
  // Demo 1: Image Description
  ui.printBox('📍 DEMO 1: Image Description', 'info');
  ui.printInfo(`Image: Mountain landscape`);
  ui.printInfo(`URL: ${sampleImages.nature}\n`);
  
  let spinner = ui.createSpinner('Analyzing image...');
  spinner.start();
  
  const desc1 = await client.visionChat(
    'Describe this image in detail. What do you see?',
    [sampleImages.nature],
    { model }
  );
  
  spinner.succeed('Analysis complete!');
  ui.printBox(`${ui.colors.secondary('Vision Analysis:')}\n${desc1.content}`, 'default');
  ui.printUsageStats(desc1.usage, desc1.duration);
  ui.printDivider();
  
  await ui.sleep(1000);
  
  // Demo 2: Multiple Images
  ui.printBox('📍 DEMO 2: Comparing Multiple Images', 'info');
  ui.printInfo(`Images: City + Nature`);
  
  spinner = ui.createSpinner('Comparing images...');
  spinner.start();
  
  const desc2 = await client.visionChat(
    'Compare these two images. What are the key differences in mood and atmosphere?',
    [sampleImages.nature, sampleImages.city],
    { model }
  );
  
  spinner.succeed('Comparison complete!');
  ui.printBox(`${ui.colors.secondary('Comparison:')}\n${desc2.content}`, 'default');
  ui.printUsageStats(desc2.usage, desc2.duration);
  ui.printDivider();
  
  ui.printBox('✨ Vision Demo Complete!', 'success');
}

runVisionDemo().catch(error => {
  console.error('Demo failed:', error);
  process.exit(1);
});
