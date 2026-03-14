import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/config/city-config', () => ({
  getCityConfig: vi.fn(),
}));

import { getInstanceFeatures } from '../src/lib/config/instance-features';
import { getCityConfig } from '../src/lib/config/city-config';

describe('getInstanceFeatures', () => {
  it('wiki instance has routes, events, places, reactions, registration', () => {
    vi.mocked(getCityConfig).mockReturnValue({ instance_type: undefined } as any);
    const f = getInstanceFeatures();
    expect(f.hasRoutes).toBe(true);
    expect(f.hasRides).toBe(false);
    expect(f.hasEvents).toBe(true);
    expect(f.hasPlaces).toBe(true);
    expect(f.hasEnrichedEvents).toBe(false);
    expect(f.allowsRegistration).toBe(true);
    expect(f.allowsGuestAccess).toBe(true);
    expect(f.allowsReactions).toBe(true);
    expect(f.showsLicenseNotice).toBe(true);
    expect(f.showsContributeLink).toBe(true);
  });

  it('blog instance has rides, no registration, no reactions', () => {
    vi.mocked(getCityConfig).mockReturnValue({ instance_type: 'blog' } as any);
    const f = getInstanceFeatures();
    expect(f.hasRoutes).toBe(false);
    expect(f.hasRides).toBe(true);
    expect(f.hasEvents).toBe(false);
    expect(f.hasPlaces).toBe(false);
    expect(f.hasEnrichedEvents).toBe(false);
    expect(f.allowsRegistration).toBe(false);
    expect(f.allowsGuestAccess).toBe(false);
    expect(f.allowsReactions).toBe(false);
    expect(f.showsLicenseNotice).toBe(false);
    expect(f.showsContributeLink).toBe(false);
  });

  it('club instance has enriched events, places, no rides', () => {
    vi.mocked(getCityConfig).mockReturnValue({ instance_type: 'club' } as any);
    const f = getInstanceFeatures();
    expect(f.hasRoutes).toBe(true);
    expect(f.hasRides).toBe(false);
    expect(f.hasEvents).toBe(true);
    expect(f.hasPlaces).toBe(true);
    expect(f.hasEnrichedEvents).toBe(true);
    expect(f.allowsRegistration).toBe(true);
    expect(f.allowsGuestAccess).toBe(true);
    expect(f.allowsReactions).toBe(true);
    expect(f.showsLicenseNotice).toBe(true);
    expect(f.showsContributeLink).toBe(false);
  });
});
