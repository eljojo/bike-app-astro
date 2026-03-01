import { describe, it, expect } from 'vitest';
import { makePreview } from '../src/lib/markdown-preview';

describe('makePreview', () => {
  it('returns empty array for undefined', () => {
    expect(makePreview(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(makePreview('')).toEqual([]);
  });

  it('returns first two lines of plain text', () => {
    expect(makePreview('First line\nSecond line\nThird line')).toEqual([
      'First line',
      'Second line',
    ]);
  });

  it('strips markdown link syntax, keeping link text', () => {
    const body = 'Visit the [Central Experimental Farm](https://en.wikipedia.org/wiki/CentralExperimentalFarm) on this route.';
    expect(makePreview(body)).toEqual([
      'Visit the Central Experimental Farm on this route.',
    ]);
  });

  it('strips bare URLs', () => {
    const body = 'Check out https://example.com/path for more info.';
    expect(makePreview(body)).toEqual([
      'Check out  for more info.',
    ]);
  });

  it('strips multiple markdown links in one line', () => {
    const body = 'From [Parliament](https://example.com/a) to [Canal](https://example.com/b).';
    expect(makePreview(body)).toEqual([
      'From Parliament to Canal.',
    ]);
  });

  it('strips heading markers', () => {
    expect(makePreview('## Overview\nSome text')).toEqual([
      'Overview',
      'Some text',
    ]);
  });

  it('strips bold and italic markers', () => {
    expect(makePreview('This is **bold** and *italic* and __underlined__')).toEqual([
      'This is bold and italic and underlined',
    ]);
  });

  it('skips blank lines', () => {
    expect(makePreview('First\n\n\nSecond\n\nThird')).toEqual([
      'First',
      'Second',
    ]);
  });
});
