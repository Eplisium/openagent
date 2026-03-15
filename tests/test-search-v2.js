/**
 * Test enhanced web search with multiple backends
 */

import { webSearchTool, readWebpageTool } from '../src/tools/webTools.js';

console.log('🧪 Testing Enhanced Web Search v2...\n');

// Test 1: Search with auto backend
console.log('Test 1: web_search (auto backend)');
try {
  const result = await webSearchTool.execute({
    query: 'JavaScript programming best practices',
    maxResults: 3,
  });
  
  console.log(`  Success: ${result.success}`);
  console.log(`  Backend: ${result.backend}`);
  console.log(`  Results: ${result.count}`);
  
  if (result.results?.length > 0) {
    console.log(`  First result: ${result.results[0].title}`);
    console.log(`  URL: ${result.results[0].url}`);
    console.log('  ✓ Search working!');
  } else {
    console.log('  ⚠ No results found');
    console.log('  Error:', result.error);
  }
} catch (e) {
  console.log(`  ✗ Error: ${e.message}`);
}

// Test 2: Read webpage
console.log('\nTest 2: read_webpage');
try {
  const result = await readWebpageTool.execute({
    url: 'https://example.com',
    maxChars: 500,
  });
  
  console.log(`  Success: ${result.success}`);
  console.log(`  Status: ${result.status}`);
  console.log(`  Title: ${result.title}`);
  console.log(`  Content length: ${result.length}`);
  console.log(`  Content preview: ${result.content?.substring(0, 100)}`);
  console.log('  ✓ Page reading working!');
} catch (e) {
  console.log(`  ✗ Error: ${e.message}`);
}

// Test 3: Search with specific backend
console.log('\nTest 3: web_search (startpage backend)');
try {
  const result = await webSearchTool.execute({
    query: 'Node.js tutorials',
    maxResults: 2,
    backend: 'startpage',
  });
  
  console.log(`  Success: ${result.success}`);
  console.log(`  Backend: ${result.backend}`);
  console.log(`  Results: ${result.count}`);
  
  if (result.results?.length > 0) {
    console.log(`  First result: ${result.results[0].title}`);
    console.log('  ✓ Startpage search working!');
  }
} catch (e) {
  console.log(`  ✗ Error: ${e.message}`);
}

console.log('\n✅ Web search v2 test complete!');
