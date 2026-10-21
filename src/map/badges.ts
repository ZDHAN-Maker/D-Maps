export interface PlaceBadgeMeta {
  icon: string;
  bg: string;
  textLight: string;
  textDark: string;
  isStreet: boolean;
}

export function getPlaceBadgeMeta(name: string, kind: string, category?: string): PlaceBadgeMeta {
  const cat = (category || '').toLowerCase();
  const n = (name || '').toLowerCase();

  if (kind === 'street' || cat === 'street') {
    return {
      icon: '',
      bg: '',
      textLight: '#4B5563',
      textDark: '#E2E8F0',
      isStreet: true,
    };
  }

  // 1. Makanan / Kuliner / Restoran / Kafe / Warung (Oranye hangat Google Maps)
  if (
    cat.includes('food') || cat.includes('restaurant') || cat.includes('cafe') ||
    n.includes('warung') || n.includes('resto') || n.includes('kopi') ||
    n.includes('cafe') || n.includes('mie') || n.includes('bakso') ||
    n.includes('sate') || n.includes('ayam') || n.includes('dapur') || n.includes('bakery')
  ) {
    return { icon: '🍽️', bg: '#E37400', textLight: '#B45309', textDark: '#FB923C', isStreet: false };
  }

  // 2. Kesehatan / Rumah Sakit / Klinik (Merah crimson Google Maps)
  if (
    cat.includes('hospital') || cat.includes('clinic') || cat.includes('health') ||
    n.includes('rs ') || n.includes('rumah sakit') || n.includes('puskesmas') || n.includes('klinik')
  ) {
    return { icon: '🏥', bg: '#D93025', textLight: '#B91C1C', textDark: '#F87171', isStreet: false };
  }

  // 3. Masjid / Musholla (Hijau zamrud Google Maps)
  if (cat.includes('mosque') || n.includes('masjid') || n.includes('musholla') || n.includes('surau')) {
    return { icon: '🕌', bg: '#137333', textLight: '#047857', textDark: '#34D399', isStreet: false };
  }

  // 4. Gereja / Tempat Ibadah (Ungu)
  if (n.includes('gereja') || cat.includes('church') || cat.includes('worship')) {
    return { icon: '⛪', bg: '#7C3AED', textLight: '#6D28D9', textDark: '#A78BFA', isStreet: false };
  }

  // 5. Olahraga / GOR / Rekreasi (Hijau Toska Google Maps)
  if (
    n.includes('gor ') || n.includes('stadion') || n.includes('futsal') ||
    n.includes('soccer') || n.includes('padel') || n.includes('gym') || n.includes('billiard')
  ) {
    return { icon: '🟢', bg: '#0D9488', textLight: '#0F766E', textDark: '#2DD4BF', isStreet: false };
  }

  // 6. SPBU / Bensin / Pertamina (Abu-abu / Dark Slate Google Maps)
  if (cat.includes('fuel') || n.includes('spbu') || n.includes('pertamina') || n.includes('bensin')) {
    return { icon: '⛽', bg: '#4B5563', textLight: '#374151', textDark: '#9CA3AF', isStreet: false };
  }

  // 7. Pendidikan / Sekolah / Kampus (Abu-abu Slate Google Maps)
  if (
    cat.includes('school') || cat.includes('education') ||
    n.includes('sd ') || n.includes('smp ') || n.includes('sma ') || n.includes('smk') ||
    n.includes('sekolah') || n.includes('universitas') || n.includes('kampus')
  ) {
    return { icon: '🎓', bg: '#5F6368', textLight: '#374151', textDark: '#94A3B8', isStreet: false };
  }

  // 8. Apotek / Obat (Biru Muda / Sky)
  if (cat.includes('pharmacy') || cat.includes('apotek') || n.includes('apotek') || n.includes('kimia farma')) {
    return { icon: '💊', bg: '#0284C7', textLight: '#0369A1', textDark: '#38BDF8', isStreet: false };
  }

  // 9. Hotel / Penginapan (Magenta / Ungu)
  if (cat.includes('hotel') || cat.includes('lodging') || n.includes('hotel') || n.includes('penginapan') || n.includes('wisma')) {
    return { icon: '🏨', bg: '#A21CAF', textLight: '#86198F', textDark: '#F0ABFC', isStreet: false };
  }

  // 10. Toko / Pasar / Swalayan (Biru Google Maps)
  if (cat.includes('shop') || cat.includes('market') || cat.includes('mall') || n.includes('pasar') || n.includes('mart') || n.includes('toko') || n.includes('minimarket')) {
    return { icon: '🛍️', bg: '#1A73E8', textLight: '#0369A1', textDark: '#38BDF8', isStreet: false };
  }

  // 11. Bank / ATM (Teal)
  if (cat.includes('atm') || cat.includes('bank') || n.includes('bank ') || n.includes('atm ') || n.includes('bca') || n.includes('bri') || n.includes('bni') || n.includes('mandiri')) {
    return { icon: '💳', bg: '#0D9488', textLight: '#0F766E', textDark: '#2DD4BF', isStreet: false };
  }

  // 12. Wisata / Monumen / Tengara (Ungu Violet Google Maps)
  if (cat.includes('attraction') || cat.includes('tourism') || cat.includes('park') || n.includes('taman') || n.includes('monumen') || n.includes('tugu')) {
    return { icon: '🟣', bg: '#8B5CF6', textLight: '#6D28D9', textDark: '#C4B5FD', isStreet: false };
  }

  // Default POI (Oranye Google Maps alami, bukan biru)
  return { icon: '📍', bg: '#E37400', textLight: '#B45309', textDark: '#FB923C', isStreet: false };
}

export function createPlaceBadgeHtml(name: string, kind: string, category: string | undefined, theme: 'light' | 'dark'): string {
  const meta = getPlaceBadgeMeta(name, kind, category);
  if (meta.isStreet) {
    return `<div class="dmaps-gm-street ${theme}"><span>${name}</span></div>`;
  }
  const textColor = theme === 'dark' ? meta.textDark : meta.textLight;
  return `<div class="dmaps-gm-poi ${theme}"><span class="gm-poi-icon" style="background:${meta.bg};">${meta.icon}</span><span class="gm-poi-text" style="color:${textColor};">${name}</span></div>`;
}

export function createBookmarkBadgeHtml(name: string, theme: 'light' | 'dark' = 'light'): string {
  return `<div class="dmaps-gm-bookmark ${theme}"><svg class="gm-pin-icon" viewBox="0 0 24 28" width="22" height="26"><path fill="#EA4335" stroke="#FFFFFF" stroke-width="1.5" d="M12 2C7.58 2 4 5.58 4 10c0 5.67 8 16 8 16s8-10.33 8-16c0-4.42-3.58-8-8-8z"/><circle cx="12" cy="10" r="3.2" fill="#FFFFFF"/></svg><span class="gm-bookmark-text">${name}</span></div>`;
}
