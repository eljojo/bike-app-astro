import { describe, it, expect } from 'vitest';
import { getStopState } from '../src/components/admin/MetroProgress';

describe('getStopState', () => {
  it('marks current stop as current', () => {
    const states = [0, 1, 2, 3, 4].map(i => getStopState(i, 2));
    expect(states).toEqual(['completed', 'completed', 'current', 'future', 'future']);
  });

  it('marks all before current as completed', () => {
    const states = [0, 1, 2, 3, 4].map(i => getStopState(i, 4));
    expect(states).toEqual(['completed', 'completed', 'completed', 'completed', 'current']);
  });

  it('marks first stop as current when at 0', () => {
    const states = [0, 1, 2, 3, 4].map(i => getStopState(i, 0));
    expect(states).toEqual(['current', 'future', 'future', 'future', 'future']);
  });
});
