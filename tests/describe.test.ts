import { describe, expect, it } from 'vitest';
import { describeStep, formatDistance, formatDuration } from '../src/routing/describe';
import type { Step } from '../src/routing';

const step = (over: Partial<Step>): Step => ({
  type: 'turn', name: null, ref: null, distanceM: 0, durationS: 0, location: [0, 0], geometryIndex: 0, bearingAfter: 0, ...over,
});

describe('describeStep', () => {
  const cases: [Partial<Step>, string, string][] = [
    [{ type: 'depart', name: 'Jalan Merdeka' }, 'Mulai berkendara di Jalan Merdeka', 'Head out on Jalan Merdeka'],
    [{ type: 'turn', modifier: 'left', name: 'Jalan A' }, 'Belok kiri ke Jalan A', 'Turn left onto Jalan A'],
    [{ type: 'turn', modifier: 'sharp_right' }, 'Belok kanan tajam', 'Make a sharp right'],
    [{ type: 'fork', modifier: 'slight_left', name: 'Jalan B' }, 'Tetap di sisi kiri ke Jalan B', 'Keep left onto Jalan B'],
    [{ type: 'ramp', modifier: 'slight_right', ref: 'A8' }, 'Ambil jalur kanan ke A8', 'Take the ramp on the right onto A8'],
    [{ type: 'continue', modifier: 'straight', name: 'Jalan C' }, 'Lurus terus di Jalan C', 'Continue straight on Jalan C'],
    [{ type: 'uturn', modifier: 'uturn' }, 'Putar balik', 'Make a U-turn'],
    [{ type: 'roundabout', exit: 2, name: 'Jalan D' }, 'Di bundaran, ambil jalan keluar ke-2 ke Jalan D', 'At the roundabout, take exit 2 onto Jalan D'],
    [{ type: 'exit_roundabout', name: 'Jalan D' }, 'Keluar dari bundaran ke Jalan D', 'Exit the roundabout onto Jalan D'],
    [{ type: 'arrive' }, 'Anda telah tiba di tujuan', 'You have arrived at your destination'],
  ];
  it.each(cases)('%j', (over, id, en) => {
    expect(describeStep(step(over), 'id')).toBe(id);
    expect(describeStep(step(over), 'en')).toBe(en);
  });

  it('never invents a roundabout exit number when the router did not count one', () => {
    const s = step({ type: 'roundabout' });
    expect(describeStep(s, 'en')).toBe('Enter the roundabout');
    expect(describeStep(s, 'id')).toBe('Masuk bundaran');
  });
});

describe('formatDistance', () => {
  it('rounds sensibly and localises the decimal separator', () => {
    expect(formatDistance(0, 'en')).toBe('0 m');
    expect(formatDistance(47, 'en')).toBe('45 m');
    expect(formatDistance(347, 'id')).toBe('350 m');
    expect(formatDistance(1234, 'en')).toBe('1.2 km');
    expect(formatDistance(1234, 'id')).toBe('1,2 km');
    expect(formatDistance(18_300, 'en')).toBe('18 km');
    expect(formatDistance(-5, 'en')).toBe('0 m');
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours in both languages', () => {
    expect(formatDuration(20, 'en')).toBe('< 1 min');
    expect(formatDuration(12 * 60, 'id')).toBe('12 mnt');
    expect(formatDuration(3600, 'en')).toBe('1 h');
    expect(formatDuration(3600 + 5 * 60, 'id')).toBe('1 j 5 mnt');
  });
});
