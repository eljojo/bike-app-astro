/**
 * Custom Worker entry point — adds a `scheduled` handler for Cloudflare
 * Cron Triggers alongside the standard Astro `fetch` handler.
 *
 * The cron trigger calls the existing POST /api/video/cron endpoint to
 * process pending video transcoding jobs. Auth via CRON_SECRET bearer token.
 */
import { handle } from '@astrojs/cloudflare/handler';

interface CronController {
	readonly cron: string;
	readonly scheduledTime: number;
}

interface CronContext {
	waitUntil(promise: Promise<unknown>): void;
}

export default {
	fetch: handle,

	async scheduled(
		_controller: CronController,
		env: Record<string, string>,
		ctx: CronContext,
	) {
		const request = new Request('https://internal/api/video/cron', {
			method: 'POST',
			headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
		});
		ctx.waitUntil(handle(request, env as never, ctx as never));
	},
};
