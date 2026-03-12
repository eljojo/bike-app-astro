---
title: Bike blog
description: Run a personal ride journal powered by the whereto.bike engine.
---

:::caution[Experimental]
The blog feature is experimental. The setup process, data formats, and APIs may change between releases. It works well in production — [eljojo.bike](https://eljojo.bike) runs on it — but expect rough edges and limited documentation.
:::

The bike blog is a personal ride journal built on the same engine as the cycling wiki. Your GPX files become pages. Your rides are organized into tours. There's no algorithmic feed, no ads, no follower count — just your rides, your photos, and your words.

**[eljojo.bike](https://eljojo.bike)** is a live example running in production.

## What you need

- Node.js 22+
- A [Cloudflare](https://cloudflare.com) account (free tier works)
- A GitHub account and repository for your ride data
- A domain name

:::note[Private repo]
Your ride data repo doesn't need to be public. eljojo.bike uses a private GitHub repo. The blog engine reads from it via a personal access token you configure.
:::

## Scaffold your blog

Run the scaffolder to create a new blog repo:

```bash
npx create-bike-blog my-blog yourdomain.com
cd my-blog
npm install
```

This copies all the templates, sets your domain and timezone, and wires up the Astro config.

## Run the interactive setup

```bash
npm run setup
```

The setup script walks you through provisioning all required cloud resources:

1. **Cloudflare resources** — creates a D1 database, an R2 bucket, and a KV namespace using `wrangler`. If you don't have `wrangler` installed, it will prompt you to install it or skip and configure manually.
2. **GitHub secrets** — sets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `GOOGLE_MAPS_STATIC_API_KEY` on your repo using the `gh` CLI.
3. **Worker secrets** — sets API keys on your Cloudflare Worker via `wrangler secret put`.

You can run `npm run setup` multiple times — it skips anything already configured.

## Required credentials

These are needed for the blog to function.

### GITHUB_TOKEN

A GitHub personal access token used by the Worker to save ride edits back to your data repo.

- Go to [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens)
- Create a **fine-grained token** scoped to your blog data repo
- Permissions: **Contents → Read and write**

Set it: `wrangler secret put GITHUB_TOKEN`

### R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY

API credentials for your R2 bucket, used to generate presigned upload URLs for photos.

- Cloudflare Dashboard → R2 → **Manage R2 API Tokens** → Create API token
- Permissions: **Object Read & Write**
- Scope to your blog's bucket
- Copy the **Access Key ID** and **Secret Access Key**

Set them:
```bash
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

### R2_PUBLIC_URL

The public URL of your R2 bucket, used to serve photos. Typically `https://cdn.yourdomain.com`.

Set it: `wrangler secret put R2_PUBLIC_URL`

### CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID

Used by GitHub Actions to deploy your Worker on every push.

- Create an API token with **Workers:Edit** permission
- Find your account ID in the Cloudflare Dashboard sidebar

Set as GitHub repo secrets (Settings → Secrets → Actions):
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The setup script can set these for you if you have the `gh` CLI installed.

## Optional integrations

These enhance the blog but aren't required to get started.

### THUNDERFOREST_API_KEY

Renders interactive map tiles (cycling and outdoors layers) on ride pages. Without this key, maps won't display.

- Sign up at [thunderforest.com](https://www.thunderforest.com)
- Dashboard → **API key**

Set it: `wrangler secret put THUNDERFOREST_API_KEY`

### GOOGLE_MAPS_STATIC_API_KEY

Generates static map thumbnail images for ride cards on the homepage and tour pages. Without this, ride cards show without a map preview.

- [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → Create API Key
- Restrict to: **Maps Static API**

Set as a GitHub Actions secret: `GOOGLE_MAPS_STATIC_API_KEY`

The CI pipeline uses this key when building map thumbnails.

### RWGPS_API_KEY and RWGPS_AUTH_TOKEN

Allows importing rides directly from [RideWithGPS](https://ridewithgps.com) into the admin editor.

- Apply for API access at [ridewithgps.com/api](https://ridewithgps.com/api)
- Both keys are provided together

Set them:
```bash
wrangler secret put RWGPS_API_KEY
wrangler secret put RWGPS_AUTH_TOKEN
```

## Add your first ride

Drop a GPX file into your data repo:

```
blog/rides/2024/03/15-morning-loop.gpx
```

The date comes from the path (`YYYY/MM/DD-name.gpx`). That's all you need — the blog engine reads everything else from the GPS track.

To add a title, description, or other metadata, create a sidecar markdown file with the same name:

```
blog/rides/2024/03/15-morning-loop.md
```

```markdown
---
name: Morning loop
country: CA
highlight: true
---

First ride of the season. Cold but clear.
```

Push both files to your GitHub repo. GitHub Actions builds and deploys automatically.

## Data repo structure

```
my-blog/
└── blog/
    ├── config.yml          ← site name, domain, timezone, author
    ├── rides/
    │   ├── 2024/
    │   │   └── 03/
    │   │       ├── 15-morning-loop.gpx
    │   │       └── 15-morning-loop.md   ← optional sidecar
    │   └── 2023/
    │       └── euro-trip/              ← named subdirectory = tour
    │           ├── 01-paris-to-lyon.gpx
    │           └── 02-lyon-to-geneva.gpx
    └── pages/
        └── about.md
```

Any non-numeric subdirectory within a year becomes a **tour** — a multi-day collection of rides shown together on the tours page.

## Local development

Set `RUNTIME=local` in your `.env` file to run without any cloud dependencies:

```
RUNTIME=local
CONTENT_DIR=.
CITY=blog
SITE_URL=http://localhost:4321
```

Then:

```bash
npm run dev
```

The local adapter swaps Cloudflare D1 for SQLite, R2 for local filesystem storage, and GitHub API for direct file writes. Everything works offline.
