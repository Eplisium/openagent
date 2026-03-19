/**
 * Test setup — runs before all tests
 * Sets up environment for testing without API keys
 */

// Mock environment
process.env.NODE_ENV = 'test';
process.env.OPENROUTER_API_KEY = 'test-key-not-real';
