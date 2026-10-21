export interface PlaceBadgeMeta {
  icon: string;
  bg: string;
  isStreet: boolean;
}

export function getPlaceBadgeMeta(name: string, kind: string, category?: string): PlaceBadgeMeta {
  const cat = (category || '').toLowerCase();
  const n = (name || '').toLowerCase();

  if (kind === 'street' || cat === 'street') {
    return { icon: '🛣️', bg: '#2563EB', isStreet: true };
  }
  if (cat.includes('hospital') || cat.includes('clinic') || cat.includes('health') || n.includes('rs ') || n.includes('rumah sakit') || n.includes('puskesmas') || n.includes('klinik')) {
    return { icon: '🏥', bg: '#EF4444', isStreet: false };
  }
  if (cat.includes('mosque') || n.includes('masjid') || n.includes('musholla') || n.includes('surau')) {
    return { icon: '🕌', bg: '#059669', isStreet: false };
  }
  if (n.includes('gereja') || cat.includes('church') || cat.includes('worship')) {
    return { icon: '⛪', bg: '#7C3AED', isStreet: false };
  }
  if (cat.includes('fuel') || n.includes('spbu') || n.includes('pertamina') || n.includes('bensin')) {
    return { icon: '⛽', bg: '#F59E0B', isStreet: false };
  }
  if (cat.includes('food') || cat.includes('restaurant') || cat.includes('cafe') || n.includes('warung') || n.includes('resto') || n.includes('kopi') || n.includes('cafe') || n.includes('mie') || n.includes('bakso')) {
    return { icon: '🍽️', bg: '#EA580C', isStreet: false };
  }
  if (cat.includes('school') || cat.includes('education') || n.includes('sd ') || n.includes('smp ') || n.includes('sma ') || n.includes('sekolah') || n.includes('universitas') || n.includes('smk') || n.includes('kampus')) {
    return { icon: '🎓', bg: '#8B5CF6', isStreet: false };
  }
  if (cat.includes('pharmacy') || cat.includes('apotek') || n.includes('apotek') || n.includes('kimia farma')) {
    return { icon: '💊', bg: '#06B6D4', isStreet: false };
  }
  if (cat.includes('hotel') || cat.includes('lodging') || n.includes('hotel') || n.includes('penginapan') || n.includes('homestay') || n.includes('wisma')) {
    return { icon: '🏨', bg: '#0284C7', isStreet: false };
  }
  if (cat.includes('shop') || cat.includes('market') || cat.includes('mall') || n.includes('pasar') || n.includes('mart') || n.includes('toko') || n.includes('mall') || n.includes('plaza')) {
    return { icon: '🛍️', bg: '#6366F1', isStreet: false };
  }
  if (cat.includes('atm') || cat.includes('bank') || n.includes('bank ') || n.includes('atm ') || n.includes('bca') || n.includes('bri') || n.includes('bni') || n.includes('mandiri')) {
    return { icon: '💳', bg: '#0D9488', isStreet: false };
  }
  if (cat.includes('attraction') || cat.includes('tourism') || cat.includes('park') || n.includes('taman') || n.includes('monumen') || n.includes('danau')) {
    return { icon: '🏞️', bg: '#10B981', isStreet: false };
  }
  return { icon: '📍', bg: '#2563EB', isStreet: false };
}

export function createPlaceBadgeHtml(name: string, kind: string, category: string | undefined, theme: 'light' | 'dark'): string {
  const meta = getPlaceBadgeMeta(name, kind, category);
  if (meta.isStreet) {
    return `<div class="dmaps-street-badge ${theme}"><span class="street-icon-circle">🛣️</span><span class="street-text">${name}</span></div>`;
  }
  return `<div class="dmaps-poi-badge ${theme}"><span class="poi-icon-circle" style="background:${meta.bg};color:#fff;">${meta.icon}</span><span class="poi-text">${name}</span></div>`;
}

export function createBookmarkBadgeHtml(name: string): string {
  return `<div class="dmaps-bookmark-badge"><span class="bookmark-star">★</span><span class="bookmark-text">${name}</span></div>`;
}

