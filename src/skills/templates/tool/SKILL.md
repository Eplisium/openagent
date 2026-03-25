---
name: {{name}}
description: {{description}}
version: 1.0.0
author: {{author}}
license: MIT
tags: [tool]
triggers: []
keywords: []
hooks:
  pre-task: scripts/pre.sh
  post-task: scripts/post.sh
compatibility:
  os: [linux, macos, windows]
  node: ">=18"
---

# {{name}} Tool Skill

## Overview
{{description}}

## Available Scripts
- `scripts/run.sh`: Main execution script
- `scripts/pre.sh`: Pre-task setup
- `scripts/post.sh`: Post-task cleanup

## Usage
```bash
# Run the tool
./scripts/run.sh [args]
```

## Input/Output
- **Input**: 
- **Output**: 

## Exit Codes
- 0: Success
- 1: Error
