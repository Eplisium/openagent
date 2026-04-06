/**
 * 🧪 Test Suite
 * Comprehensive tests for OpenRouter Master Script
 */

import { OpenRouterClient, OpenRouterError } from '../src/OpenRouterClient.js';
import { CONFIG } from '../src/config.js';
import * as ui from '../src/utils.js';

class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  async run() {
    ui.printTitle('🧪 OPENROUTER TEST SUITE');
    ui.printInfo(`Running ${this.tests.length} tests...\n`);

    for (const { name, fn } of this.tests) {
      const spinner = ui.createSpinner(`Testing: ${name}`);
      spinner.start();

      try {
        await fn();
        spinner.succeed(`✓ ${name}`);
        this.passed++;
      } catch (error) {
        spinner.fail(`✗ ${name}`);
        ui.printError(error.message);
        this.failed++;
      }
    }

    this.printSummary();
  }

  printSummary() {
    ui.printDivider();
    ui.printTitle('📊 TEST SUMMARY');

    const total = this.passed + this.failed + this.skipped;
    const table = ui.createTable(['Status', 'Count'], [
      [ui.colors.success('✓ Passed'), this.passed.toString()],
      [ui.colors.error('✗ Failed'), this.failed.toString()],
      [ui.colors.warning('⊘ Skipped'), this.skipped.toString()],
      [ui.colors.bold('Total'), total.toString()],
    ]);

    console.log(table.toString());

    if (this.failed === 0) {
      ui.printSuccess('All tests passed! 🎉');
    } else {
      ui.printError(`${this.failed} test(s) failed`);
      process.exit(1);
    }
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(
        message || `Expected ${expected}, got ${actual}`
      );
    }
  }

  assertExists(value, message) {
    if (value === null || value === undefined) {
      throw new Error(message || 'Expected value to exist');
    }
  }
}

// Initialize test runner
const runner = new TestRunner();

// Skip tests if no API key
const hasApiKey = Boolean(CONFIG.API_KEY);

// ========================================
// Configuration Tests
// ========================================
runner.test('Configuration loads correctly', () => {
  runner.assertExists(CONFIG.BASE_URL, 'BASE_URL should exist');
  runner.assertExists(CONFIG.API_KEY, 'API_KEY should exist');
  runner.assert(CONFIG.MAX_RETRIES > 0, 'MAX_RETRIES should be positive');
});

// ========================================
// Client Initialization Tests
// ========================================
runner.test('Client initializes with defaults', () => {
  const client = new OpenRouterClient();
  runner.assertExists(client, 'Client should be created');
  // Model must be provided by caller - no hardcoded default
  runner.assertEqual(client.defaultModel, null, 'Default model should be null (must be set by caller)');
});

runner.test('Client accepts custom options', () => {
  const client = new OpenRouterClient({
    defaultModel: 'test/model',
    maxRetries: 5,
  });
  runner.assertEqual(client.defaultModel, 'test/model', 'Custom model should be set');
  runner.assertEqual(client.maxRetries, 5, 'Custom retries should be set');
});

// ========================================
// Message Normalization Tests
// ========================================
runner.test('Normalizes string to message array', () => {
  const client = new OpenRouterClient();
  const result = client.normalizeMessages('Hello');
  runner.assertEqual(result.length, 1, 'Should return array with 1 item');
  runner.assertEqual(result[0].role, 'user', 'Role should be user');
  runner.assertEqual(result[0].content, 'Hello', 'Content should match');
});

runner.test('Normalizes message object', () => {
  const client = new OpenRouterClient();
  const result = client.normalizeMessages({ role: 'system', content: 'Test' });
  runner.assertEqual(result.length, 1, 'Should return array with 1 item');
  runner.assertEqual(result[0].role, 'system', 'Role should be system');
});

runner.test('Normalizes message array', () => {
  const client = new OpenRouterClient();
  const messages = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi' },
  ];
  const result = client.normalizeMessages(messages);
  runner.assertEqual(result.length, 2, 'Should preserve array length');
});

// ========================================
// Payload Building Tests
// ========================================
runner.test('Builds payload with model', () => {
  const client = new OpenRouterClient({ defaultModel: 'test/model' });
  const payload = client.buildPayload('Hello');
  runner.assertEqual(payload.model, 'test/model', 'Should use provided model');
  runner.assertExists(payload.messages, 'Should have messages');
  runner.assertEqual(payload.stream, false, 'Should not stream by default');
});

runner.test('Builds payload with custom options', () => {
  const client = new OpenRouterClient();
  const payload = client.buildPayload('Hello', {
    model: 'custom/model',
    temperature: 0.5,
    stream: true,
  });
  runner.assertEqual(payload.model, 'custom/model', 'Should use custom model');
  runner.assertEqual(payload.temperature, 0.5, 'Should use custom temperature');
  runner.assertEqual(payload.stream, true, 'Should enable streaming');
});

// ========================================
// Utility Tests
// ========================================
runner.test('Format duration works correctly', () => {
  runner.assertEqual(ui.formatDuration(500), '500ms', 'Should format milliseconds');
  runner.assertEqual(ui.formatDuration(1500), '1.50s', 'Should format seconds');
  runner.assertEqual(ui.formatDuration(90000), '1.50m', 'Should format minutes');
});

runner.test('Format cost works correctly', () => {
  runner.assert(ui.formatCost(0.001).includes('¢'), 'Should show cents for small amounts');
  runner.assert(ui.formatCost(1.5).includes('$'), 'Should show dollars for larger amounts');
});

runner.test('Truncate works correctly', () => {
  const longText = 'a'.repeat(200);
  const truncated = ui.truncate(longText, 50);
  runner.assert(truncated.length <= 53, 'Should truncate to max length + ellipsis');
  runner.assert(truncated.endsWith('...'), 'Should end with ellipsis');
});

// ========================================
// API Integration Tests (requires API key)
// ========================================
// Use a cheap model for API tests - use a model that exists
const TEST_MODEL = 'google/gemini-2.0-flash-001';

if (hasApiKey) {
  const client = new OpenRouterClient({ defaultModel: TEST_MODEL });

  runner.test('API: Basic chat completion', async () => {
    const result = await client.chat('Say "test passed" and nothing else.', {
      model: TEST_MODEL,
    });
    runner.assertExists(result.content, 'Should have content');
    runner.assertExists(result.id, 'Should have response ID');
    runner.assertExists(result.usage, 'Should have usage stats');
  });

  runner.test('API: Multi-turn conversation', async () => {
    const messages = [
      { role: 'system', content: 'You are a test assistant.' },
      { role: 'user', content: 'What is 2+2?' },
    ];
    const result = await client.chat(messages, { model: TEST_MODEL });
    runner.assertExists(result.content, 'Should have response');
    runner.assert(result.content.includes('4'), 'Should answer correctly');
  });

  runner.test('API: Get models list', async () => {
    const models = await client.getModels();
    runner.assert(Array.isArray(models), 'Should return array');
    runner.assert(models.length > 0, 'Should have models');
    runner.assertExists(models[0].id, 'Model should have ID');
  });

  runner.test('API: Stats tracking', async () => {
    // Clear cache to ensure we make a real API call, not a cached response
    client.clearCache();
    const before = client.getStats().requestCount;
    await client.chat(`Stats test ${Date.now()}`, { model: TEST_MODEL });
    const after = client.getStats().requestCount;
    runner.assertEqual(after, before + 1, 'Should increment request count');
  });

  runner.test('API: Streaming response', async () => {
    const stream = client.chatStream('Say hi', { model: TEST_MODEL });
    let receivedContent = false;
    
    for await (const chunk of stream) {
      if (chunk.type === 'content') {
        receivedContent = true;
        break; // Just need to verify it works
      }
    }
    
    runner.assert(receivedContent, 'Should receive streaming content');
  });

  runner.test('API: Structured output', async () => {
    const schema = {
      name: 'test',
      strict: true,
      definition: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
        },
        required: ['answer'],
      },
    };
    
    const result = await client.structuredOutput(
      'What is the capital of France?',
      schema,
      { model: TEST_MODEL }
    );
    
    runner.assertExists(result.data, 'Should have parsed data');
    runner.assertExists(result.data.answer, 'Should have answer field');
  });

} else {
  ui.printWarning('API key not found - skipping API integration tests');
  runner.skipped += 6;
}

// ========================================
// Error Handling Tests
// ========================================
runner.test('Error classes work correctly', () => {
  const error = new OpenRouterError('Test error', 'TEST_CODE', { detail: 'test' });
  runner.assertEqual(error.message, 'Test error', 'Should have message');
  runner.assertEqual(error.code, 'TEST_CODE', 'Should have code');
  runner.assertExists(error.timestamp, 'Should have timestamp');
});

// Run tests
runner.run().catch(error => {
  ui.printError(`Test runner failed: ${error.message}`);
  process.exit(1);
});
