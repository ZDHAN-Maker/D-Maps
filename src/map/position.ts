import L from 'leaflet';
import type { Fix } from '../gps';

/**
 * Current-position marker: a dot, an accuracy circle, and a heading wedge when the heading is known.
 * The accuracy circle is drawn at the reported radius, so a weak fix visibly looks weak.
 */
export class PositionMarker {
  private readonly halo: L.Circle;
  private readonly dot: L.Marker;

  constructor(private readonly map: L.Map) {
    this.halo = L.circle([0, 0], { radius: 1, color: '#2D9CDB', weight: 1, fillColor: '#8DD9F5', fillOpacity: 0.25, interactive: false });
    this.dot = L.marker([0, 0], {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: 'pos-icon',
        html: '<div class="pos-wedge"></div><div class="pos-dot"></div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    });
  }

  update(fix: Fix, stale = false): void {
    const ll: L.LatLngExpression = [fix.lat, fix.lon];
    if (!this.map.hasLayer(this.dot)) { this.halo.addTo(this.map); this.dot.addTo(this.map); }
    this.halo.setLatLng(ll).setRadius(Math.max(fix.accuracyM ?? 0, 1));
    this.dot.setLatLng(ll);
    const el = this.dot.getElement();
    if (!el) return;
    el.classList.toggle('stale', stale);
    const wedge = el.querySelector<HTMLElement>('.pos-wedge');
    if (wedge) {
      const known = typeof fix.heading === 'number';
      wedge.style.display = known ? 'block' : 'none';
      if (known) wedge.style.transform = `rotate(${fix.heading}deg)`;
    }
  }

  setStale(stale: boolean): void {
    this.dot.getElement()?.classList.toggle('stale', stale);
  }

  remove(): void {
    this.map.removeLayer(this.halo);
    this.map.removeLayer(this.dot);
  }
}
