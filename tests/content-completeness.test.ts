import { describe, it, expect } from 'vitest';
import {
  isEventIncomplete,
  isRouteIncomplete,
  isRideIncomplete,
  isBikePathIncomplete,
  isPlaceIncomplete,
  isCommunityIncomplete,
} from '../src/lib/content/content-completeness';

describe('isEventIncomplete', () => {
  it('returns no_poster when poster_key is missing', () => {
    expect(isEventIncomplete({ hasBody: true })).toBe('no_poster');
  });

  it('returns no_poster when poster_key is empty string', () => {
    expect(isEventIncomplete({ poster_key: '', hasBody: true })).toBe('no_poster');
  });

  it('returns short_description when hasBody is false', () => {
    expect(isEventIncomplete({ poster_key: 'img/poster.jpg', hasBody: false })).toBe('short_description');
  });

  it('returns null when complete', () => {
    expect(isEventIncomplete({ poster_key: 'img/poster.jpg', hasBody: true })).toBeNull();
  });

  it('prioritises no_poster over short_description', () => {
    expect(isEventIncomplete({ hasBody: false })).toBe('no_poster');
  });
});

describe('isRouteIncomplete', () => {
  it('returns no_photo when coverKey is missing', () => {
    expect(isRouteIncomplete({})).toBe('no_photo');
  });

  it('returns no_photo when coverKey is empty string', () => {
    expect(isRouteIncomplete({ coverKey: '' })).toBe('no_photo');
  });

  it('returns null when complete', () => {
    expect(isRouteIncomplete({ coverKey: 'img/cover.jpg' })).toBeNull();
  });
});

describe('isRideIncomplete', () => {
  it('returns draft when status is draft', () => {
    expect(isRideIncomplete({ status: 'draft' })).toBe('draft');
  });

  it('returns null when status is published', () => {
    expect(isRideIncomplete({ status: 'published' })).toBeNull();
  });

  it('returns null when status is undefined', () => {
    expect(isRideIncomplete({})).toBeNull();
  });
});

describe('isBikePathIncomplete', () => {
  it('returns no_description when visible and stub', () => {
    expect(isBikePathIncomplete({ hidden: false, stub: true })).toBe('no_description');
  });

  it('returns null when hidden even if stub', () => {
    expect(isBikePathIncomplete({ hidden: true, stub: true })).toBeNull();
  });

  it('returns null when not stub', () => {
    expect(isBikePathIncomplete({ hidden: false, stub: false })).toBeNull();
  });
});

describe('isPlaceIncomplete', () => {
  it('returns no_photo when photo_key is missing', () => {
    expect(isPlaceIncomplete({})).toBe('no_photo');
  });

  it('returns no_website when photo exists but no contact info', () => {
    expect(isPlaceIncomplete({ photo_key: 'img/place.jpg', social_links: [] })).toBe('no_website');
  });

  it('returns no_website when social_links has no website or telephone', () => {
    expect(isPlaceIncomplete({
      photo_key: 'img/place.jpg',
      social_links: [{ platform: 'instagram', url: 'https://instagram.com/x' }],
    })).toBe('no_website');
  });

  it('returns null when photo and website exist', () => {
    expect(isPlaceIncomplete({
      photo_key: 'img/place.jpg',
      social_links: [{ platform: 'website', url: 'https://example.com' }],
    })).toBeNull();
  });

  it('returns null when photo and telephone exist', () => {
    expect(isPlaceIncomplete({
      photo_key: 'img/place.jpg',
      social_links: [{ platform: 'telephone', url: 'tel:+1234' }],
    })).toBeNull();
  });

  it('prioritises no_photo over no_website', () => {
    expect(isPlaceIncomplete({ social_links: [] })).toBe('no_photo');
  });
});

describe('isCommunityIncomplete', () => {
  it('returns no_photo when photo_key is missing', () => {
    expect(isCommunityIncomplete({ hasBody: true, social_links: [{}] })).toBe('no_photo');
  });

  it('returns no_description when hasBody is false', () => {
    expect(isCommunityIncomplete({ photo_key: 'img/org.jpg', hasBody: false, social_links: [{}] })).toBe('no_description');
  });

  it('returns no_social when social_links is empty', () => {
    expect(isCommunityIncomplete({ photo_key: 'img/org.jpg', hasBody: true, social_links: [] })).toBe('no_social');
  });

  it('returns no_social when social_links is undefined', () => {
    expect(isCommunityIncomplete({ photo_key: 'img/org.jpg', hasBody: true })).toBe('no_social');
  });

  it('returns null when complete', () => {
    expect(isCommunityIncomplete({ photo_key: 'img/org.jpg', hasBody: true, social_links: [{}] })).toBeNull();
  });

  it('prioritises no_photo over no_description over no_social', () => {
    expect(isCommunityIncomplete({ hasBody: false, social_links: [] })).toBe('no_photo');
    expect(isCommunityIncomplete({ photo_key: 'img/org.jpg', hasBody: false, social_links: [] })).toBe('no_description');
  });
});
