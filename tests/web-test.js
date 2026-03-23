/**
 * 🌐 Web Tools Test v5
 * Test the enhanced web search and page reading capabilities
 */

import { webSearchTool, readWebpageTool, fetchUrlTool } from '../src/tools/webTools.js';

console.log('🧪 Testing Enhanced Web Tools v5...\n');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

// Test 1: Web Search (auto mode — races all backends)
console.log('Test 1: web_search (auto mode — parallel racing)');
try {
  const searchResult = await webSearchTool.execute({
    query: 'Node.js best practices 2026',
    maxResults: 3,
  });

  assert(typeof searchResult.success === 'boolean', 'Has success field');
  assert(typeof searchResult.backend === 'string', 'Has backend field');
  assert(typeof searchResult.count === 'number', 'Has count field');
  assert(Array.isArray(searchResult.results), 'Results is array');
  assert(Array.isArray(searchResult.attempts), 'Has attempts array');

  if (searchResult.results?.length > 0) {
    console.log(`  Backend used: ${searchResult.backend}`);
    console.log(`  Results: ${searchResult.count}`);
    console.log(`  First result: ${searchResult.results[0].title}`);
    assert(true, 'Got search results');
  } else {
    console.log(`  ⚠ No results (network issue or all backends blocked)`);
    console.log(`  Error: ${searchResult.error}`);
    // Not a test failure — could be network environment
  }
} catch (e) {
  console.log(`  ✗ Unexpected error: ${e.message}`);
  failed++;
}

// Test 2: Web Search (specific backend)
console.log('\nTest 2: web_search (DuckDuckGo backend)');
try {
  const searchResult = await webSearchTool.execute({
    query: 'JavaScript async await tutorial',
    maxResults: 2,
    backend: 'duckduckgo',
  });

  assert(typeof searchResult.success === 'boolean', 'Has success field');
  assert(searchResult.backend === 'duckduckgo', 'Reports correct backend');
  assert(Array.isArray(searchResult.results), 'Results is array');

  if (searchResult.results?.length > 0) {
    assert(searchResult.results[0].title?.length > 0, 'Result has title');
    assert(searchResult.results[0].url?.startsWith('http'), 'Result has valid URL');
  }
} catch (e) {
  console.log(`  ✗ Error: ${e.message}`);
  failed++;
}

// Test 3: Read Webpage
console.log('\nTest 3: read_webpage (example.com)');
try {
  const pageResult = await readWebpageTool.execute({
    url: 'https://jsonplaceholder.typicode.com/posts/1',
    maxChars: 500,
  });

  assert(pageResult.success === true, 'Fetch succeeded');
  assert(pageResult.status === 200, 'HTTP 200');
  assert(typeof pageResult.content === 'string', 'Has content');
  assert(pageResult.content.length > 0, 'Content not empty');
  console.log(`  Content length: ${pageResult.length}`);
} catch (e) {
  console.log(`  ✗ Error: ${e.message}`);
  failed++;
}

// Test 4: Read Webpage (extractMode: text)
console.log('\nTest 4: read_webpage (extractMode: text)');
try {
  const pageResult = await readWebpageTool.execute({
    url: 'https://jsonplaceholder.typicode.com/posts/1',
    maxChars: 200,
    extractMode: 'text',
  });

  assert(pageResult.success === true, 'Fetch succeeded');
  assert(typeof pageResult.content === 'string', 'Has content');
} catch (e) {
  console.log(`  ✗ Error: ${e.message}`);
  failed++;
}

// Test 5: Fetch URL (JSON API)
console.log('\nTest 5: fetch_url (JSON API)');
try {
  const fetchResult = await fetchUrlTool.execute({
    url: 'https://jsonplaceholder.typicode.com/posts/1',
  });

  assert(fetchResult.success === true, 'Fetch succeeded');
  assert(fetchResult.status === 200, 'HTTP 200');
  assert(typeof fetchResult.data === 'string', 'Has data');
  assert(fetchResult.data.includes('"userId"'), 'Data contains expected JSON fields');
  assert(typeof fetchResult.headers === 'object', 'Has response headers');
  console.log(`  Data preview: ${fetchResult.data?.substring(0, 80)}...`);
} catch (e) {
  console.log(`  ✗ Error: ${e.message}`);
  failed++;
}

// Test 6: Cache test
console.log('\nTest 6: Search cache');
try {
  const start1 = Date.now();
  await webSearchTool.execute({ query: 'cache test unique query 12345', maxResults: 2 });
  const time1 = Date.now() - start1;

  const start2 = Date.now();
  const cached = await webSearchTool.execute({ query: 'cache test unique query 12345', maxResults: 2 });
  const time2 = Date.now() - start2;

  console.log(`  First call: ${time1}ms`);
  console.log(`  Second call: ${time2}ms`);
  console.log(`  Cached: ${cached.cached || false}`);

  if (cached.cached) {
    assert(time2 < time1, 'Cached call is faster');
  } else {
    console.log('  ⚠ Cache miss (first call may have failed)');
  }
} catch (e) {
  console.log(`  ✗ Error: ${e.message}`);
  failed++;
}

// Test 7: Error handling (invalid URL)
console.log('\nTest 7: Error handling (invalid URL)');
try {
  const result = await readWebpageTool.execute({
    url: 'not-a-valid-url',
  });

  assert(result.success === false, 'Reports failure');
  assert(typeof result.error === 'string', 'Has error message');
  assert(result.error.includes('http'), 'Error mentions URL scheme');
  console.log(`  Error: ${result.error}`);
} catch (e) {
  console.log(`  ✗ Unexpected throw: ${e.message}`);
  failed++;
}

// Test 8: Error handling (404 page)
console.log('\nTest 8: Error handling (404 page)');
try {
  const result = await readWebpageTool.execute({
    url: 'https://jsonplaceholder.typicode.com/posts/999999',
  });

  // jsonplaceholder returns empty object with 200 for missing posts
  // Just verify it doesn't throw and returns a valid structure
  assert(typeof result.success === 'boolean', 'Returns valid result structure');
  assert(typeof result.status === 'number', 'Has status code');
  console.log(`  Status: ${result.status} (success: ${result.success})`);
} catch (e) {
  console.log(`  ✗ Unexpected throw: ${e.message}`);
  failed++;
}

// Test 9: Tool definitions for LLM
console.log('\nTest 9: Tool definitions for LLM');
const tools = [webSearchTool, readWebpageTool, fetchUrlTool];
for (const tool of tools) {
  assert(typeof tool.name === 'string', `${tool.name} has name`);
  assert(typeof tool.description === 'string', `${tool.name} has description`);
  assert(tool.parameters?.type === 'object', `${tool.name} has object parameters`);
  assert(tool.parameters?.required?.length > 0, `${tool.name} has required params`);
  assert(typeof tool.execute === 'function', `${tool.name} has execute function`);
  assert(tool.category === 'network', `${tool.name} is in network category`);
}

// Summary
console.log(`\n${'='.repeat(40)}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`${'='.repeat(40)}`);
console.log(failed === 0 ? '\n✅ All tests passed!' : '\n⚠️ Some tests failed');
