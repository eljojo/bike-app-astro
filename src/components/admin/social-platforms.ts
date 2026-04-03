/** Supported social/contact platforms for places and communities. */
export const SOCIAL_PLATFORMS = [
  'instagram', 'facebook', 'strava', 'youtube',
  'meetup', 'tiktok', 'bluesky', 'threads', 'website',
  'discord', 'google_form', 'linktree', 'rwgps', 'komoot', 'newsletter', 'mastodon',
  'booking', 'telephone', 'email',
] as const;

export interface SocialLink {
  platform: string;
  url: string;
}
