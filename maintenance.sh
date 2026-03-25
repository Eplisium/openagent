#!/bin/bash
# OpenAgent Maintenance Script
# Run weekly to keep the app updated and secure

set -e

OPENAGENT_DIR="/a0/usr/workdir/openagent"
BACKUP_DIR="/a0/usr/backups/openagent"
DATE=$(date +%Y%m%d_%H%M%S)

echo "[$(date)] Starting OpenAgent maintenance..."

# 1. Backup
echo "Creating backup..."
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/openagent_backup_$DATE.tar.gz" -C "$OPENAGENT_DIR" .

# 2. Update
echo "Pulling latest updates..."
cd "$OPENAGENT_DIR"
git pull origin main

# 3. Update dependencies
echo "Updating dependencies..."
npm audit fix --force
npm update

# 4. Clear cache
echo "Clearing caches..."
rm -rf ~/.openagent/cache/*

# 5. Run tests
echo "Running tests..."
npm run test:unit

# 6. Generate status report
echo "Generating status report..."
cat > "$BACKUP_DIR/status_report_$DATE.txt" << EOR
OpenAgent Maintenance Report
Date: $(date)
Node.js: $(node --version)
npm: $(npm --version)
Disk Usage: $(du -sh "$OPENAGENT_DIR" | cut -f1)
Recent Commits:
$(git log --oneline -5)
EOR

echo "[$(date)] Maintenance completed successfully!"
