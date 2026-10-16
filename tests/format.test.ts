import { describe, expect, it } from 'vitest';
import { formatBytes } from '../src/lib/format';

describe('formatBytes', () => {
  it('picks the unit and localises the decimal separator', () => {
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(820, 'en')).toBe('820 B');
    expect(formatBytes(36_497, 'en')).toBe('36 KB');
    expect(formatBytes(2_615_502, 'en')).toBe('2.6 MB');
    expect(formatBytes(2_615_502, 'id')).toBe('2,6 MB');
    expect(formatBytes(1_250_000_000, 'en')).toBe('1.25 GB');
    expect(formatBytes(-5, 'en')).toBe('0 B');
  });
});
