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
    water: '#8DD9F5',
    green: '#B9F3D0',
    coast: '#5BBEE5',
    roadCasing: '#CDBE96',
    roadMajor: '#FFE27A',
    roadMinor: '#FFFFFF',
    foot: '#B8AE96',
    buildingFill: '#EFE6D3',
    buildingStroke: '#DCCFB6',
  },
  dark: {
    water: '#1F5A73',
    green: '#25503C',
    coast: '#2F86A6',
    roadCasing: '#11181C',
    roadMajor: '#B8962E',
    roadMinor: '#5A6A72',
    foot: '#5B6B73',
    buildingFill: '#2C373D',
    buildingStroke: '#3A474E',
  },
};

