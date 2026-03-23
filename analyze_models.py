import json

with open('openrouter_models.json', 'r') as f:
    data = json.load(f)

models = data.get('data', [])
print(f'Total models: {len(models)}')
print()

providers = {}
for m in models:
    model_id = m.get('id', '')
    provider = model_id.split('/')[0] if '/' in model_id else 'unknown'
    if provider not in providers:
        providers[provider] = []
    providers[provider].append(m)

print('Models by Provider:')
for provider in sorted(providers.keys()):
    print(f'  {provider}: {len(providers[provider])} models')

print()
print('Sample Models (first 30):')
for m in models[:30]:
    print(f"  {m['id']} - {m.get('name', 'N/A')}")
    pricing = m.get('pricing', {})
    print(f"    Context: {m.get('context_length', 'N/A')}")
    print(f"    Pricing: prompt=${pricing.get('prompt', 'N/A')}, completion=${pricing.get('completion', 'N/A')}")
    print(f"    Input modalities: {m.get('architecture', {}).get('input_modalities', [])}")
    print(f"    Output modalities: {m.get('architecture', {}).get('output_modalities', [])}")
    print()
