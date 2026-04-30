import { t } from '@/i18n';
import { parseInstagramUsername } from '@/lib/models/organizer-model';

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

const CONTACT_SCHEME_PLATFORMS = new Set(['telephone', 'email']);

export function isContactSchemeLink(link: SocialLink): boolean {
  return CONTACT_SCHEME_PLATFORMS.has(link.platform);
}

export function socialLinkHref(link: SocialLink): string {
  if (link.platform === 'telephone') return `tel:${link.url.replace(/[^+\d]/g, '')}`;
  if (link.platform === 'email') return `mailto:${link.url}`;
  return link.url;
}

export function socialLinkLabel(link: SocialLink, locale: string | undefined): string {
  if (link.platform === 'instagram') {
    const username = parseInstagramUsername(link.url);
    return username ? t('social.on_instagram', locale, { username }) : 'Instagram';
  }
  if (link.platform === 'telephone' || link.platform === 'email') return link.url;
  const labels: Record<string, string> = {
    facebook: 'Facebook',
    strava: 'Strava',
    youtube: 'YouTube',
    meetup: 'Meetup',
    tiktok: 'TikTok',
    bluesky: 'Bluesky',
    threads: 'Threads',
    website: t('social.website', locale),
    discord: 'Discord',
    google_form: t('social.sign_up_form', locale),
    linktree: 'Linktree',
    rwgps: 'Ride with GPS',
    komoot: 'Komoot',
    newsletter: t('social.newsletter', locale),
    mastodon: 'Mastodon',
    booking: t('social.booking', locale),
  };
  return labels[link.platform] || link.platform;
}
