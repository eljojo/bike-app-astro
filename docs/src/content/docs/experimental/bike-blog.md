---
title: Bike blog
description: Run a personal ride journal powered by the whereto.bike engine.
---

:::caution[Experimental]
Deploying your own blog instance is experimental. The setup process, data formats, and APIs may change between releases. The features — rides, tours, video, photos — work well in production. [eljojo.bike](https://eljojo.bike) runs on this engine.
:::

The bike blog is a personal ride journal built on the same engine as the cycling wiki. Your GPX files become pages. Your rides are organized into tours. There's no algorithmic feed, no ads, no follower count — just your rides, your photos, and your words.

**[eljojo.bike](https://eljojo.bike)** is a live example running in production.

## What you need

- Node.js 22+
- A [Cloudflare](https://cloudflare.com) account (free tier works)
- A GitHub account and repository for your ride data
- A domain name
- An AWS account (optional — needed for video uploads)

:::note[Private repo]
Your ride data repo doesn't need to be public. eljojo.bike uses a private GitHub repo. The blog engine reads from it via a personal access token you configure.
:::

## Scaffold your blog

Run the scaffolder to create a new blog repo:

```bash
npx create-bike-blog my-blog yourdomain.com
cd my-blog
```

The scaffolder will prompt you to install dependencies. If you skipped that, run `npm install` manually.

This copies all the templates, sets your domain and timezone, and wires up the Astro config.

## Run the setup

```bash
npm run setup
```

The setup script walks you through provisioning all required cloud resources. It's idempotent — run it again any time to pick up where you left off or add something you skipped.

### Step 1: Cloudflare

Creates a D1 database, an R2 bucket, and a KV namespace using `wrangler deploy --x-provision`. If you don't have `wrangler` installed, it'll prompt you to install it or skip and configure manually.

### Step 2: GitHub

Creates a private repo (if needed) and sets deploy secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GOOGLE_MAPS_STATIC_API_KEY`) using the `gh` CLI.

### Step 3: API keys

Prompts for optional API keys one at a time — Thunderforest (map tiles), RideWithGPS, Google Places, Strava, SES (login emails). Press Enter to skip any you don't have yet. Auto-detects values it can derive from your setup (R2 bucket name, account ID, git remote).

After the prompts, the script sets up your CDN domain automatically — a custom domain on your R2 bucket so photos are served at `https://cdn.yourdomain.com`.

### Step 4: Video uploads (optional)

If you have an AWS account with CLI access configured, the setup script can provision the entire video transcoding pipeline. This creates S3 buckets, a Lambda function, IAM roles, and connects everything together. You don't need to touch the AWS console.

The video step:
- Derives a prefix from your git remote (e.g., `eljojo_bike-blog`)
- Creates shared AWS resources (S3 buckets, Lambda, MediaConvert roles) — skips anything that already exists
- Configures per-instance settings (CORS, webhook routing, IAM credentials, R2 Sippy)
- Sets wrangler secrets and GitHub Actions variables

See [Video uploads](#video-uploads) below for how video works once it's set up, or the [video pipeline reference](/experimental/video-pipeline/) for technical details.

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

Supported frontmatter fields: `name`, `country`, `highlight`, `tags`, `status`, `handle` (custom slug), `strava_id`, `privacy_zone`, `total_elevation_gain`.

Push both files to your GitHub repo. GitHub Actions builds and deploys automatically.

## Data repo structure

The scaffolder creates a single repo containing both the app and your ride data:

```
your-blog-repo/
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

## Privacy zone

You can configure a privacy zone to automatically strip GPS data near your home (or any sensitive location) from the published site. Add this to your `config.yml`:

```yaml
privacy_zone:
  lat: 45.4215
  lng: -75.6972
  radius_m: 500
  default_enabled: true
```

When enabled, the build process removes all track points within the radius and strips GPS coordinates from photos that fall inside the zone. The raw GPX in your data repo stays untouched — privacy filtering is a build-time transform, so you can change the zone later without re-importing rides.

Each ride can override the default with `privacy_zone: true` or `privacy_zone: false` in its sidecar frontmatter. Rides imported from Strava default to `false` since Strava applies its own privacy zone.

## Video uploads

When video is set up, you can upload ride videos directly from the ride editor in the admin panel. Here's what happens behind the scenes:

1. The browser uploads the video to S3 via a presigned URL
2. An S3 trigger invokes a Lambda function that extracts metadata (dimensions, duration, GPS, capture date) using ffprobe
3. Lambda submits a MediaConvert job that produces CMAF HLS adaptive streaming (two H.265 tiers in fMP4 segments) and an H.264 MP4 fallback
4. When transcoding completes, an EventBridge rule triggers the Lambda again, which sends a webhook to your Worker
5. The Worker updates the ride's video status in D1

Videos are served via Cloudflare R2 with Sippy — R2 pulls transcoded files from S3 on first request and caches them at the edge. No manual file copying needed.

Each blog instance gets its own prefix in S3 (e.g., `eljojo_bike-blog/abc12345`), so multiple instances can share the same AWS resources safely.

For the full technical reference, see the [video pipeline](/experimental/video-pipeline/) page.

## Credentials reference

The setup script configures most of these automatically. This table is a reference for manual setup or troubleshooting.

### Required

| Secret | Purpose | How to get it |
|--------|---------|---------------|
| `GITHUB_TOKEN` | Save ride edits back to your data repo | [Personal access tokens](https://github.com/settings/personal-access-tokens) — fine-grained, Contents: Read and write |
| `R2_ACCESS_KEY_ID` | Presigned upload URLs for photos | Cloudflare Dashboard → R2 → Manage R2 API Tokens → Object Read & Write |
| `R2_SECRET_ACCESS_KEY` | Paired with R2 access key | Same token as above |
| `R2_PUBLIC_URL` | CDN URL for serving photos (e.g., `https://cdn.yourdomain.com`) | Set automatically by setup script |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions deploys your Worker | [API Tokens](https://dash.cloudflare.com/profile/api-tokens) — Workers:Edit, D1:Edit, R2 Storage:Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Paired with API token | Cloudflare Dashboard sidebar |

### Optional integrations

| Secret | Purpose | How to get it |
|--------|---------|---------------|
| `THUNDERFOREST_API_KEY` | Interactive map tiles | [thunderforest.com](https://www.thunderforest.com) → Dashboard → API key |
| `GOOGLE_MAPS_STATIC_API_KEY` | Static map thumbnails on ride cards | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → Maps Static API |
| `STRAVA_CLIENT_ID` | Import rides from Strava | [strava.com/settings/api](https://www.strava.com/settings/api) → Create app |
| `STRAVA_CLIENT_SECRET` | Paired with Strava client ID | Same app page |
| `RWGPS_API_KEY` | Import rides from RideWithGPS | [ridewithgps.com/api](https://ridewithgps.com/api) |
| `RWGPS_AUTH_TOKEN` | Paired with RWGPS API key | Provided alongside API key |
| `GOOGLE_PLACES_API_KEY` | Auto-populate place details and import routes from Google Maps URLs | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → Places API (New) + Directions API |
| `SES_ACCESS_KEY_ID` | Send login emails via Amazon SES | IAM user with AmazonSESFullAccess policy |
| `SES_SECRET_ACCESS_KEY` | Paired with SES access key | Same IAM user |
| `SES_REGION` | AWS region for SES (e.g., `us-east-1`) | SES console top-right corner |
| `SES_FROM` | From address for login emails | Must be verified in SES |

### Video (set automatically by Step 4)

| Secret | Purpose |
|--------|---------|
| `MEDIACONVERT_ACCESS_KEY_ID` | S3 presigned uploads for video |
| `MEDIACONVERT_SECRET_ACCESS_KEY` | Paired with access key |
| `S3_ORIGINALS_BUCKET` | S3 bucket name for raw uploads |
| `WEBHOOK_SECRET` | Lambda → Worker webhook auth |
| `VIDEO_PREFIX` | GitHub Actions variable — identifies your videos in S3 |

All secrets are set via `wrangler secret put <NAME>`. GitHub secrets are set via the repo's Settings → Secrets → Actions.

## Local development

Set `RUNTIME=local` in your `.env` file to run without any cloud dependencies:

```
CONTENT_DIR=.
CITY=blog
RUNTIME=local
SITE_URL=http://localhost:4321
```

Then:

```bash
npm run dev
```

The local adapter swaps Cloudflare D1 for SQLite, R2 for local filesystem storage, and GitHub API for direct file writes. Everything works offline.

## Updating your blog

When a new version of the blog engine is released:

```bash
npm update whereto-bike
npm run sync
```

The `sync` command regenerates your CI workflows and copies updated templates from the engine. Review the changes in `git diff` before committing.

Re-run `npm run setup` if the update introduces new secrets or configuration. The script skips anything already configured — it's safe to run repeatedly.
