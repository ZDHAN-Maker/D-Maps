import type { Modifier, Step } from './instructions';

export type Lang = 'id' | 'en';

/** Road label to show after a maneuver: name first, then ref (e.g. "Jl. Sudirman", "N7"). */
export const roadLabel = (s: Pick<Step, 'name' | 'ref'>): string | null => s.name ?? s.ref ?? null;

const SIDE: Record<Lang, { left: string; right: string }> = {
  id: { left: 'kiri', right: 'kanan' },
  en: { left: 'left', right: 'right' },
};

const TURN: Record<Lang, Record<Exclude<Modifier, 'straight' | 'uturn'>, string>> = {
  id: {
    slight_left: 'Belok sedikit ke kiri', left: 'Belok kiri', sharp_left: 'Belok kiri tajam',
    slight_right: 'Belok sedikit ke kanan', right: 'Belok kanan', sharp_right: 'Belok kanan tajam',
  },
  en: {
    slight_left: 'Bear left', left: 'Turn left', sharp_left: 'Make a sharp left',
    slight_right: 'Bear right', right: 'Turn right', sharp_right: 'Make a sharp right',
  },
};

const onto = (lang: Lang, label: string | null): string =>
  label ? (lang === 'id' ? ` ke ${label}` : ` onto ${label}`) : '';

const side = (m: Modifier | undefined): 'left' | 'right' =>
  m === 'slight_left' || m === 'left' || m === 'sharp_left' ? 'left' : 'right';

/**
 * Human-readable instruction for one step. Pure and language-parameterised so it is unit-testable
 * and never depends on the UI framework. A roundabout exit number is only spoken when the router
 * actually counted one (see Step.exit); otherwise it says "enter the roundabout".
 */
export function describeStep(step: Step, lang: Lang): string {
  const label = roadLabel(step);
  const id = lang === 'id';
  switch (step.type) {
    case 'depart':
      return id ? `Mulai berkendara${label ? ` di ${label}` : ''}` : `Head out${label ? ` on ${label}` : ''}`;
    case 'arrive':
      return id ? 'Anda telah tiba di tujuan' : 'You have arrived at your destination';
    case 'uturn':
      return id ? 'Putar balik' : 'Make a U-turn';
    case 'continue':
      if (step.modifier && step.modifier !== 'straight' && step.modifier !== 'uturn') {
        return TURN[lang][step.modifier] + onto(lang, label);
      }
      return id ? `Lurus terus${label ? ` di ${label}` : ''}` : `Continue straight${label ? ` on ${label}` : ''}`;
    case 'fork': {
      const s = side(step.modifier);
      return (id ? `Tetap di sisi ${SIDE.id[s]}` : `Keep ${SIDE.en[s]}`) + onto(lang, label);
    }
    case 'ramp': {
      const s = side(step.modifier);
      return (id ? `Ambil jalur ${SIDE.id[s]}` : `Take the ramp on the ${SIDE.en[s]}`) + onto(lang, label);
    }
    case 'roundabout':
      if (step.exit === undefined) return id ? 'Masuk bundaran' : 'Enter the roundabout';
      return id
        ? `Di bundaran, ambil jalan keluar ke-${step.exit}${onto(lang, label)}`
        : `At the roundabout, take exit ${step.exit}${onto(lang, label)}`;
    case 'exit_roundabout':
      return id ? `Keluar dari bundaran${onto(lang, label)}` : `Exit the roundabout${onto(lang, label)}`;
    case 'turn': {
      const m = step.modifier;
      if (m && m !== 'straight' && m !== 'uturn') return TURN[lang][m] + onto(lang, label);
      return id ? `Lurus${onto(lang, label)}` : `Continue${onto(lang, label)}`;
    }
  }
}

/** "350 m" / "1,2 km" (id) or "1.2 km" (en). Under 1 km rounds to 10 m (5 m under 50 m). */
export function formatDistance(meters: number, lang: Lang): string {
  const m = Math.max(0, meters);
  const nf = (digits: number) => new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  if (m < 50) return `${nf(0).format(Math.round(m / 5) * 5)} m`;
  if (m < 1000) return `${nf(0).format(Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${nf(km < 10 ? 1 : 0).format(km)} km`;
}

/** "< 1 mnt", "12 mnt", "1 j 5 mnt" (id) / "< 1 min", "12 min", "1 h 5 min" (en). */
export function formatDuration(seconds: number, lang: Lang): string {
  const minUnit = lang === 'id' ? 'mnt' : 'min';
  const hourUnit = lang === 'id' ? 'j' : 'h';
  const total = Math.round(Math.max(0, seconds) / 60);
  if (total < 1) return `< 1 ${minUnit}`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} ${minUnit}`;
  return m === 0 ? `${h} ${hourUnit}` : `${h} ${hourUnit} ${m} ${minUnit}`;
}
