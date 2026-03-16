import { getCityConfig } from './city-config';

export interface InstanceFeatures {
  /** Content types available */
  hasRoutes: boolean;
  hasRides: boolean;
  hasEvents: boolean;
  hasPlaces: boolean;
  hasGuides: boolean;

  /** Club-specific enriched events (waypoints, results, route references) */
  hasEnrichedEvents: boolean;

  /** Auth & community */
  allowsRegistration: boolean;
  allowsGuestAccess: boolean;
  allowsReactions: boolean;

  /** UI chrome */
  showsLicenseNotice: boolean;
  showsContributeLink: boolean;
}

const WIKI_FEATURES: InstanceFeatures = {
  hasRoutes: true,
  hasRides: false,
  hasEvents: true,
  hasPlaces: true,
  hasGuides: true,
  hasEnrichedEvents: false,
  allowsRegistration: true,
  allowsGuestAccess: true,
  allowsReactions: true,
  showsLicenseNotice: true,
  showsContributeLink: true,
};

const BLOG_FEATURES: InstanceFeatures = {
  hasRoutes: false,
  hasRides: true,
  hasEvents: false,
  hasPlaces: false,
  hasGuides: false,
  hasEnrichedEvents: false,
  allowsRegistration: false,
  allowsGuestAccess: false,
  allowsReactions: false,
  showsLicenseNotice: false,
  showsContributeLink: false,
};

const CLUB_FEATURES: InstanceFeatures = {
  hasRoutes: true,
  hasRides: false,
  hasEvents: true,
  hasPlaces: true,
  hasGuides: false,
  hasEnrichedEvents: true,
  allowsRegistration: true,
  allowsGuestAccess: true,
  allowsReactions: true,
  showsLicenseNotice: true,
  showsContributeLink: false,
};

const FEATURE_MAP: Record<string, InstanceFeatures> = {
  wiki: WIKI_FEATURES,
  blog: BLOG_FEATURES,
  club: CLUB_FEATURES,
};

export function getInstanceFeatures(): InstanceFeatures {
  const instanceType = getCityConfig().instance_type || 'wiki';
  return FEATURE_MAP[instanceType] ?? WIKI_FEATURES;
}
