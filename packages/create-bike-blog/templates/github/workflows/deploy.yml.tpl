name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v6
        with:
          lfs: true

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: 'npm'

      - run: npm ci

      - name: Build site
        run: npx astro build
        env:
          CONTENT_DIR: .
          CITY: {{USERNAME}}
          SITE_URL: https://{{DOMAIN}}
          NODE_OPTIONS: '--max-old-space-size=4096'

      - name: Prepare wrangler config
        run: |
          rm -f dist/server/wrangler.json
          node -e "
            const fs = require('fs');
            const raw = fs.readFileSync('wrangler.jsonc', 'utf8');
            const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
            const c = JSON.parse(stripped);
            c.main = './dist/server/entry.mjs';
            c.assets.directory = './dist/client';
            fs.writeFileSync('wrangler.jsonc', JSON.stringify(c, null, 2));
          "

      - name: Run D1 migrations
        run: npx wrangler d1 migrations apply DB --config wrangler.jsonc --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Deploy to Cloudflare Workers
        run: npx wrangler deploy --config wrangler.jsonc
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
