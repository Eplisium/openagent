# OpenAgent Linux Setup Guide

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ (✅ Installed: v22.22.0)
- OpenRouter API key (✅ Configured)

### 1. Clone & Install
```bash
cd /a0/usr/workdir/openagent
npm install
```

### 2. Configuration
The `.env` file is already configured with:
- ✅ OpenRouter API key
- ✅ Model selection preferences
- ✅ Cost control limits

### 3. Run OpenAgent
```bash
# Interactive mode (recommended for first use)
npm start

# Or use global command
openagent

# Quick test with a simple query
openagent --quick "Hello, what can you do?"
```

## 🛠️ Advanced Configuration

### Default Model
Add to `.env`:
```
DEFAULT_MODEL=openrouter/anthropic/claude-sonnet-4-6
```

### Memory & Workspace
OpenAgent stores data in:
- `~/.openagent/` - Configuration and memory
- Workspace: Current directory (set by `--cwd`)

### Security Notes
- API key is stored in `.env` file
- Never commit `.env` to version control
- Use `chmod 600 .env` for additional security

## 📚 Key Features

### Available Models
✅ 346+ AI models from OpenRouter
✅ Dynamic model browsing
✅ Cost tracking and limits

### Tools & Capabilities
- 📁 File operations (read, write, edit)
- 🖥️ Shell command execution
- 🔍 Codebase search
- 🌐 Web browsing and documentation
- 🔀 Git integration
- 🤖 Multi-agent orchestration

### Example Commands
```bash
# Check for code issues
openagent "Analyze this codebase for potential bugs"

# Create a new feature
openagent "Add user authentication to this Node.js app"

# Debug an error
openagent "Help me fix this error: [paste error]"
```

## 🔄 Updates & Maintenance

### Update OpenAgent
```bash
cd /a0/usr/workdir/openagent
git pull origin main
npm install
```

### Clear Cache
```bash
rm -rf ~/.openagent/cache/
```

### Backup Configuration
```bash
tar -czf openagent-backup-$(date +%Y%m%d).tar.gz ~/.openagent/ .env
```

## 🆘 Troubleshooting

### Common Issues
1. **API Key Error**: Ensure `.env` contains valid `OPENROUTER_API_KEY`
2. **Model Not Found**: Run `openagent --models` to see available models
3. **Permission Denied**: Use `chmod +x src/cli.js`

### Debug Mode
```bash
DEBUG=openagent:* npm start
```

### Log Files
```bash
# Application logs
tail -f ~/.openagent/logs/openagent.log

# Error logs
tail -f ~/.openagent/logs/error.log
```

## 📞 Support

For issues:
1. Check logs in `~/.openagent/logs/`
2. Run `openagent --version` to verify installation
3. Test API connection: `openagent --test-api`

---

**Version**: 4.1.0 | **Last Updated**: 2026-03-25
