import type { APIContext } from 'astro';
import { GitService } from '../../../lib/git-service';
import yaml from 'js-yaml';

export const prerender = false;

interface RouteUpdate {
  frontmatter: Record<string, unknown>;
  body: string;
  media: Array<{
    key: string;
    caption?: string;
    cover?: boolean;
  }>;
}

export async function POST({ params, request, locals }: APIContext) {
  const { slug } = params;
  const user = (locals as any).user;
  const env = (locals as any).runtime.env;

  if (!slug) {
    return new Response(JSON.stringify({ error: 'Missing slug' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let update: RouteUpdate;
  try {
    update = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const git = new GitService({
      token: env.GITHUB_TOKEN,
      owner: 'eljojo',
      repo: 'bike-routes',
    });

    const city = 'ottawa';
    const basePath = `${city}/routes/${slug}`;
    const files: Array<{ path: string; content: string }> = [];

    // Build index.md content
    const fm = update.frontmatter;
    const frontmatterStr = Object.entries(fm)
      .map(([key, val]) => {
        if (Array.isArray(val)) {
          return `${key}:\n${val.map((v) => `  - ${v}`).join('\n')}`;
        }
        if (typeof val === 'string' && (val.includes(':') || val.includes('#') || val.includes('"'))) {
          return `${key}: "${val.replace(/"/g, '\\"')}"`;
        }
        return `${key}: ${val}`;
      })
      .join('\n');

    const indexContent = `---\n${frontmatterStr}\n---\n\n${update.body}\n`;
    files.push({ path: `${basePath}/index.md`, content: indexContent });

    // Build media.yml if media changed
    if (update.media && update.media.length > 0) {
      const mediaYaml = yaml.dump(
        update.media.map((m) => {
          const entry: Record<string, unknown> = { key: m.key };
          if (m.caption) entry.caption = m.caption;
          if (m.cover) entry.cover = true;
          return entry;
        }),
        { flowLevel: -1, lineWidth: -1 }
      );
      files.push({ path: `${basePath}/media.yml`, content: mediaYaml });
    }

    // Determine commit message
    const parts: string[] = [];
    if (update.frontmatter) parts.push('Update');
    if (update.media) parts.push(`${update.media.length} photo${update.media.length !== 1 ? 's' : ''}`);
    const message = parts.length > 0
      ? `${parts.join(' + ')} for ${slug}`
      : `Update ${slug}`;

    // Commit
    const sha = await git.writeFiles(files, message, {
      name: user.displayName,
      email: user.email,
    });

    // Trigger rebuild
    await git.triggerRebuild();

    return new Response(JSON.stringify({ success: true, sha }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('save route error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Failed to save' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
