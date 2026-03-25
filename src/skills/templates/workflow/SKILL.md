---
name: {{name}}
description: {{description}}
version: 1.0.0
author: {{author}}
license: MIT
tags: [workflow]
triggers: []
keywords: []
hooks:
  pre-task: scripts/init.sh
  post-task: scripts/cleanup.sh
  on-error: scripts/error-handler.sh
resources:
  - name: config.json
    path: resources/config.json
    type: config
---

# {{name}} Workflow

## Overview
{{description}}

## Workflow Steps
1. **Initialization** - Run `scripts/init.sh`
2. **Step 1** - 
3. **Step 2** - 
4. **Cleanup** - Run `scripts/cleanup.sh`

## Error Handling
- On error: `scripts/error-handler.sh`
- Retry logic: 
- Logging: 

## Dependencies
- Required skills: 
- External tools: 
