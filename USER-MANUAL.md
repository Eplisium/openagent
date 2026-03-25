# OpenAgent User Manual

## 🚀 Getting Started

### Quick Launch
```bash
# From anywhere (with alias)
openagent

# Or directly
cd /a0/usr/workdir/openagent && node src/cli.js

# Quick command
openagent "What is the weather today?"
```

## 🖥️ Modern Ink UI (Beta)

OpenAgent now features a modern, interactive terminal UI built with React and Ink. This UI provides a rich, responsive experience similar to industry-leading frameworks like Cursor and Claude Code.

### 🚀 Launching the Ink UI

You can start the Ink UI in two ways:

```bash
# Using the --ui flag
openagent --ui

# Using the 'ui' command alias
openagent ui

# With additional options
openagent --ui --model gpt-4 --theme dark
```

### ✨ Key Features

#### **Interactive Chat Interface**
- Real-time message streaming
- Syntax highlighting for code blocks
- Markdown rendering with tables and lists
- Copy buttons for code blocks
- Auto-scroll to latest message

#### **Skills Marketplace**
- Browse and search available skills
- One-click install/uninstall
- Skill preview with documentation
- Hot-reloading indicator

#### **Model Selector**
- Interactive model browsing
- Favorites and recents tracking
- Search and filtering
- Cost estimation display

#### **Memory Visualization**
- Graph-based or list view
- Search memory entries
- Add/edit/delete memories
- Import/export functionality

#### **Status Dashboard**
- Real-time cost tracking
- Token usage statistics
- Current model display
- Processing indicator

### ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Q` | Quit |
| `Ctrl+P` | Command palette |
| `Ctrl+N` | New chat |
| `Ctrl+S` | Save session |
| `Ctrl+K` | Clear chat |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+T` | Cycle themes |
| `Ctrl+/` | Show help |
| `Esc` | Close modals |

### 🎨 Theming

The Ink UI supports multiple themes:
- **Dark** (default) - Modern dark theme
- **Light** - Clean light theme
- **High Contrast** - Accessibility-focused
- **Monokai** - Popular developer theme
- **Nord** - Arctic, north-bluish color palette

Change themes using `Ctrl+T` or in the Settings panel.

### ♿ Accessibility Features

- **Screen reader support**: All components have proper ARIA labels
- **High contrast mode**: Enhanced visibility for low vision users
- **Keyboard navigation**: Full keyboard accessibility
- **Focus management**: Clear visual focus indicators

### 🛠️ Technical Details

The Ink UI is built with:
- **React 18** with functional components and hooks
- **Ink 4** for terminal rendering
- **@inkjs/ui** for enhanced components
- **Comprehensive test suite** (69 tests)

All components follow ES modules patterns and maintain backward compatibility with the traditional CLI.

### 🐛 Troubleshooting

If you encounter issues with the Ink UI:
1. Try the traditional CLI: `openagent --traditional`
2. Check terminal compatibility (supports most modern terminals)
3. Ensure your terminal supports Unicode and true color
4. Report issues with terminal type and OS information

### 📈 Performance

The Ink UI maintains performance comparable to the traditional CLI:
- Startup time: < 1 second
- Memory usage: ~50MB additional
- CPU usage: Minimal (event-driven architecture)


### First-Time Setup
1. The app will automatically detect your API key from `.env`
2. Select your preferred AI model (346+ options available)
3. Start chatting!

## 💡 Key Features

### Model Selection
- **Interactive Browser**: Use arrow keys to navigate models
- **Filters**: Sort by price, context size, company
- **Search**: Type to filter models by name
- **Favorites**: Pin your most-used models

### Tool Capabilities
| Tool | Description |
|------|-------------|
| **File Operations** | Read, write, edit files in your project |
| **Shell Commands** | Execute terminal commands with output capture |
| **Web Search** | Search the web and fetch documentation |
| **Git Integration** | Commit, push, pull, diff, status |
| **Multi-Agent** | Create specialized subagents for complex tasks |
| **Memory** | Long-term storage of important information |
| **Vision** | Analyze images and screenshots |

### Example Workflows

#### Code Development
```bash
openagent "Add user authentication to this Node.js app"
openagent "Fix the bug in line 42 of main.py"
openagent "Refactor this function to be more efficient"
```

#### Research & Analysis
```bash
openagent "Research the latest AI models and summarize findings"
openagent "Analyze this codebase for security vulnerabilities"
openagent "Create a technical specification for a new feature"
```

#### System Administration
```bash
openagent "Optimize this server's performance"
openagent "Set up automated backups for my database"
openagent "Monitor system resources and alert on issues"
```

## ⚙️ Configuration

### Environment Variables (.env)
```bash
# Required
OPENROUTER_API_KEY=your_key_here

# Optional
DEFAULT_MODEL=openrouter/anthropic/claude-sonnet-4-6
MAX_COST_PER_REQUEST_USD=0.50
TIMEOUT_MS=300000
```

### Advanced Settings
- **Cost Control**: Set budget limits and alerts
- **Timeouts**: Adjust for long-running tasks
- **Logging**: Configure log levels and output

## 🔄 Maintenance

### Weekly Maintenance
```bash
cd /a0/usr/workdir/openagent
./maintenance.sh
```

### Manual Updates
```bash
git pull origin main
npm update
npm run test:unit
```

### Backup & Restore
```bash
# Backup
tar -czf openagent-backup.tar.gz /a0/usr/workdir/openagent ~/.openagent

# Restore
tar -xzf openagent-backup.tar.gz -C /
```

## 🆘 Troubleshooting

### Common Issues
1. **Model not loading**: Check internet connection and API key
2. **Slow responses**: Try a different model or check system resources
3. **Permission errors**: Ensure proper file permissions

### Debug Commands
```bash
# Test API connection
openagent --test-api

# Check version
openagent --version

# List all models
openagent --models
```

### Log Files
- **Application logs**: `~/.openagent/logs/openagent.log`
- **Error logs**: `~/.openagent/logs/error.log`
- **Access logs**: `~/.openagent/logs/access.log`

## 📚 Additional Resources

- **GitHub**: https://github.com/Eplisium/openagent
- **OpenRouter**: https://openrouter.ai
- **Documentation**: `/a0/usr/workdir/openagent/README.md`
- **API Reference**: `/a0/usr/workdir/openagent/openapi.json`

---

**Version**: 4.1.0 | **Platform**: Linux (Kali/Debian) | **Last Updated**: 2026-03-25
