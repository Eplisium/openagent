# OpenAgent — Production Docker Image
# Usage:
#   docker build -t openagent .
#   docker run -it -e OPENROUTER_API_KEY=sk-... openagent
#   docker run -d -e OPENROUTER_API_KEY=sk-... -p 3000:3000 openagent --daemon

FROM node:20-slim

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./
RUN npm ci --production --ignore-scripts

# Copy source code
COPY src/ src/
COPY prompts/ prompts/
COPY fonts/ fonts/

# Create non-root user
RUN groupadd -r openagent && useradd -r -g openagent -d /app -s /bin/bash openagent
RUN mkdir -p /home/openagent/.openagent && chown -R openagent:openagent /home/openagent /app
USER openagent

# Gateway port (HTTP API)
EXPOSE 3000
# AG-UI port (SSE streaming)
EXPOSE 3100
# Companion WebSocket port
EXPOSE 3200

# Default: interactive CLI
ENTRYPOINT ["node", "src/cli.js"]

# Health check for daemon mode
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
