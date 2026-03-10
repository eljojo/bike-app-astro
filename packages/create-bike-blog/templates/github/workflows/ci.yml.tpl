name: CI

on:
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.head_ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
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
