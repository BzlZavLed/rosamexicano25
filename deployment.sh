#!/usr/bin/env bash
set -eo pipefail

# ---- Update this if your project lives elsewhere ----
SITE_DIR="/home/forge/rmshowroom.on-forge.com/current"
# -----------------------------------------------------

echo "==> Deploying to $SITE_DIR"
cd "$SITE_DIR"

echo "==> Loading nvm (if available)"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true
[ -s "$HOME/.bash_profile" ] && . "$HOME/.bash_profile" || true
[ -f ".nvmrc" ] && nvm install && nvm use

echo "==> Node: $(node -v || echo 'not found'), npm: $(npm -v || echo 'not found')"

# Optional Git refresh
# git fetch --all --prune
# git checkout main
# git pull --ff-only origin main

# Optional: copy env for the build step
if [ -f ".env.production" ] && [ ! -f ".env" ]; then
  echo "==> Copying .env.production to .env"
  cp -f .env.production .env
fi

echo "==> Installing dependencies"
if [ -f "pnpm-lock.yaml" ]; then
  npx -y pnpm@9 install --frozen-lockfile
  BUILD_CMD="npx -y pnpm@9 run build"
elif [ -f "yarn.lock" ]; then
  npx -y yarn@1.22.22 install --frozen-lockfile
  BUILD_CMD="npx -y yarn@1.22.22 build"
elif [ -f "package-lock.json" ]; then
  npm ci --no-audit --no-fund
  BUILD_CMD="npm run build"
else
  npm install --no-audit --no-fund
  BUILD_CMD="npm run build"
fi

echo "==> Building Vite SPA"
export NODE_OPTIONS="--max-old-space-size=1024"
bash -lc "$BUILD_CMD"

echo "==> Verifying build output"
test -f "dist/index.html" || { echo 'ERROR: dist/index.html not found'; exit 1; }

echo "==> Deployment complete"
