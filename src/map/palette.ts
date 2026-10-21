export interface Palette {
  water: string;
  green: string;
  coast: string;
  roadCasing: string;
  roadMajor: string;
  roadMinor: string;
  foot: string;
  buildingFill: string;
  buildingStroke: string;
}

export const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    water: '#38BDF8',
    green: '#86EFAC',
    coast: '#0284C7',
    roadCasing: '#CBD5E1',
    roadMajor: '#F59E0B',
    roadMinor: '#FFFFFF',
    foot: '#94A3B8',
    buildingFill: '#F1F5F9',
    buildingStroke: '#CBD5E1',
  },
  dark: {
    water: '#0284C7',
    green: '#059669',
    coast: '#38BDF8',
    roadCasing: '#0B1220',
    roadMajor: '#F59E0B',
    roadMinor: '#64748B',
    foot: '#475569',
    buildingFill: '#1E293B',
    buildingStroke: '#334155',
  },
};
