/**
 * 🖼️ Vision/Multimodal Demo
 * Working with image inputs and vision models
 */

import { OpenRouterClient } from '../src/OpenRouterClient.js';
import { MODELS } from '../src/config.js';
import * as ui from '../src/utils.js';

async function runVisionDemo() {
  ui.clearScreen();
  ui.printTitle('🖼️ VISION & MULTIMODAL DEMO');
  
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
    `Supported models: GPT-5, Claude, Gemini, and more.`,
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
    { model: MODELS.GPT_5_4 }
  );
  
  spinner.succeed('Analysis complete!');
  ui.printBox(`${ui.colors.secondary('Vision Analysis:')}\n${desc1.content}`, 'default');
  ui.printUsageStats(desc1.usage, desc1.duration);
  ui.printDivider();
  
  await ui.sleep(1000);
  
  // Demo 2: Image Comparison
  ui.printBox('📍 DEMO 2: Image Comparison', 'info');
  ui.printInfo('Comparing nature vs city scenes...\n');
  
  spinner = ui.createSpinner('Comparing images...');
  spinner.start();
  
  const comparison = await client.visionChat(
    'Compare these two images. What are the main differences in mood, setting, and composition?',
    [sampleImages.nature, sampleImages.city],
    { model: MODELS.CLAUDE_SONNET_4 }
  );
  
  spinner.succeed('Comparison complete!');
  ui.printBox(`${ui.colors.secondary('Comparison:')}\n${comparison.content}`, 'default');
  ui.printDivider();
  
  await ui.sleep(1000);
  
  // Demo 3: Visual Analysis
  ui.printBox('📍 DEMO 3: Technical Analysis', 'info');
  ui.printInfo(`Image: Technology/AI concept`);
  ui.printInfo(`URL: ${sampleImages.tech}\n`);
  
  spinner = ui.createSpinner('Analyzing...');
  spinner.start();
  
  const analysis = await client.visionChat(
    `Analyze this image from a technical perspective:
    1. What technology is shown?
    2. What might this image be used for?
    3. What emotions or themes does it convey?`,
    [sampleImages.tech],
    { model: MODELS.GEMINI_2_5_PRO }
  );
  
  spinner.succeed('Analysis complete!');
  ui.printBox(`${ui.colors.secondary('Technical Analysis:')}\n${analysis.content}`, 'default');
  ui.printDivider();
  
  await ui.sleep(1000);
  
  // Demo 4: Image to Code
  ui.printBox('📍 DEMO 4: Image to Code (Simulated)', 'info');
  ui.printInfo('Converting image description to HTML/CSS...\n');
  
  spinner = ui.createSpinner('Generating code...');
  spinner.start();
  
  const codeGen = await client.visionChat(
    `Based on this image, generate HTML and CSS code that recreates a similar visual style.
    Include comments explaining your choices.`,
    [sampleImages.city],
    { model: MODELS.GPT_5_4 }
  );
  
  spinner.succeed('Code generated!');
  ui.printBox(`${ui.colors.secondary('Generated Code:')}\n${codeGen.content}`, 'default');
  ui.printDivider();
  
  // Demo 5: Visual Q&A
  ui.printBox('📍 DEMO 5: Visual Question Answering', 'info');
  ui.printInfo('Interactive visual Q&A\n');
  
  const questions = [
    'What colors are dominant in this image?',
    'Is this photo taken during day or night?',
    'What might be the purpose of this image?',
    'Describe the composition and framing.',
  ];
  
  for (const question of questions) {
    ui.printInfo(`Q: ${question}`);
    
    spinner = ui.createSpinner('Thinking...');
    spinner.start();
    
    const answer = await client.visionChat(
      question,
      [sampleImages.nature],
      { model: MODELS.GPT_5_MINI }
    );
    
    spinner.succeed('Answer ready');
    console.log(ui.colors.secondary(`A: ${answer.content}\n`));
    
    await ui.sleep(500);
  }
  
  // Summary
  ui.printDivider();
  ui.printTitle('🖼️ VISION DEMO COMPLETE');
  
  ui.printBox(
    `${ui.colors.bold('Supported Vision Models:')}\n\n` +
    `• ${MODELS.GPT_5_4} - Best overall vision capabilities\n` +
    `• ${MODELS.CLAUDE_SONNET_4} - Excellent detail recognition\n` +
    `• ${MODELS.GEMINI_2_5_PRO} - Strong multimodal reasoning\n` +
    `• ${MODELS.LLAMA_4_MAVERICK} - Open source vision model`,
    'info'
  );
  
  ui.printSuccess('Vision capabilities demonstrated!');
}

runVisionDemo().catch(console.error);
