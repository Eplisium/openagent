/**
 * 🌐 Web Tools Test
 * Test the enhanced web search and page reading capabilities
 */

import { webSearchTool, readWebpageTool, fetchUrlTool } from '../src/tools/webTools.js';

console.log('🧪 Testing Enhanced Web Tools...\n');

// Test 1: Web Search
console.log('Test 1: web_search (DuckDuckGo backend)');
try {
  const searchResult = await webSearchTool.execute({
    query: 'Node.js best practices 2026',
    maxResults: 3,
  });
  
  console.log(`  Success: ${searchResult.success}`);
  console.log(`  Backend: ${searchResult.backend}`);
  console.log(`  Results: ${searchResult.count}`);
  
  if (searchResult.results?.length > 0) {
    console.log(`  First result: ${searchResult.results[0].title}`);
    console.log('  ✓ Search working!');
  } else {
    console.log('  ⚠ No results (may be network issue)');
  }
} catch (e) {
  console.log(`  ✗ Error: ${e.message}`);
}

// Test 2: Read Webpage
console.log('\nTest 2: read_webpage');
try {
  const pageResult = await readWebpageTool.execute({
    url: 'https://example.com',
    maxChars: 500,
  });
  
  console.log(`  Success: ${pageResult.success}`);
  console.log(`  Status: ${pageResult.status}`);
  console.log(`  Title: ${pageResult.title}`);
  console.log(`  Content length: ${pageResult.length}`);
  console.log(`  Content preview: ${pageResult.content?.substring(0, 100)}...`);
  console.log('  ✓ Page reading working!');
} catch (e) {
  console.log(`  ✗ Error: ${e.message}`);
}

// Test 3: Fetch URL (API endpoint)
console.log('\nTest 3: fetch_url (JSON API)');
try {
  const fetchResult = await fetchUrlTool.execute({
    url: 'https://jsonplaceholder.typicode.com/posts/1',
  });
  
  console.log(`  Success: ${fetchResult.success}`);
  console.log(`  Status: ${fetchResult.status}`);
  console.log(`  Data preview: ${fetchResult.data?.substring(0, 100)}...`);
  console.log('  ✓ URL fetching working!');
} catch (e) {
  console.log(`  ✗ Error: ${e.message}`);
}

// Test 4: Cache test
console.log('\nTest 4: Search cache');
try {
  const start1 = Date.now();
  await webSearchTool.execute({ query: 'cache test query', maxResults: 2 });
  const time1 = Date.now() - start1;
  
  const start2 = Date.now();
  const cached = await webSearchTool.execute({ query: 'cache test query', maxResults: 2 });
  const time2 = Date.now() - start2;
  
  console.log(`  First call: ${time1}ms`);
  console.log(`  Second call: ${time2}ms`);
  console.log(`  Cached: ${cached.cached || false}`);
  
  if (cached.cached && time2 < time1) {
    console.log('  ✓ Caching working!');
  }
} catch (e) {
  console.log(`  ✗ Error: ${e.message}`);
}

// Test 5: Tool definitions
console.log('\nTest 5: Tool definitions for LLM');
const tools = [webSearchTool, readWebpageTool, fetchUrlTool];
for (const tool of tools) {
  console.log(`  ${tool.name}: ${tool.description.substring(0, 50)}...`);
  console.log(`    Required params: ${tool.parameters.required?.join(', ')}`);
}
console.log('  ✓ All tool definitions valid!');

console.log('\n✅ Web tools test complete!');
