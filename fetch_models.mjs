import { writeFileSync } from 'fs';

const response = await fetch('https://openrouter.ai/api/v1/models');
const data = await response.json();
const models = data.data;

let out = `Total models: ${models.length}\n\n`;

// Group by provider
const providers = {};
for (const m of models) {
  const provider = m.id.split('/')[0];
  if (!providers[provider]) providers[provider] = [];
  providers[provider].push(m);
}

out += 'Models by Provider:\n';
for (const [p, ms] of Object.entries(providers).sort((a,b) => b[1].length - a[1].length)) {
  out += `  ${p}: ${ms.length} models\n`;
}

out += '\n=== All Models ===\n';
for (const m of models) {
  const p = m.pricing || {};
  const promptPrice = parseFloat(p.prompt || '0') * 1000000;
  const compPrice = parseFloat(p.completion || '0') * 1000000;
  const cacheRead = parseFloat(p.input_cache_read || '0') * 1000000;
  out += `${m.id}\n`;
  out += `  Name: ${m.name}\n`;
  out += `  Context: ${(m.context_length || 0).toLocaleString()} tokens\n`;
  out += `  Max Completion: ${m.top_provider?.max_completion_tokens?.toLocaleString() || 'N/A'}\n`;
  out += `  Pricing: $${promptPrice.toFixed(2)}/M prompt, $${compPrice.toFixed(2)}/M completion, $${cacheRead.toFixed(2)}/M cache read\n`;
  out += `  Input: ${(m.architecture?.input_modalities || []).join(',')}\n`;
  out += `  Output: ${(m.architecture?.output_modalities || []).join(',')}\n`;
  out += `  Supported: ${(m.supported_parameters || []).join(',')}\n`;
  if (m.expiration_date) out += `  EXPIRES: ${m.expiration_date}\n`;
  out += '\n';
}

writeFileSync('openrouter_models.txt', out);
console.log('Done! Written to openrouter_models.txt');
console.log(`Total: ${models.length} models`);
