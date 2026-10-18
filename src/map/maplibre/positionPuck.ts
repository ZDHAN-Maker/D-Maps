import { Marker, type Map } from 'maplibre-gl';
import type { Fix } from '../../gps';

export class MapLibrePositionPuck {
  private marker: Marker | null = null;
  private isAdded = false;
  private el: HTMLDivElement;
  private arrowEl: HTMLDivElement;
  private dotEl: HTMLDivElement;

  constructor(private readonly map: Map) {
    this.el = document.createElement('div');
    this.el.className = 'dmaps-puck-container';
    this.el.style.width = '36px';
    this.el.style.height = '36px';
    this.el.style.position = 'relative';
    this.el.style.pointerEvents = 'none';

    // Heading cone/arrow
    this.arrowEl = document.createElement('div');
    this.arrowEl.className = 'dmaps-puck-arrow';
    this.arrowEl.style.width = '0';
    this.arrowEl.style.height = '0';
    this.arrowEl.style.borderLeft = '6px solid transparent';
    this.arrowEl.style.borderRight = '6px solid transparent';
    this.arrowEl.style.borderBottom = '14px solid #1E88E5';
    this.arrowEl.style.position = 'absolute';
    this.arrowEl.style.top = '0';
    this.arrowEl.style.left = '12px';
    this.arrowEl.style.display = 'none';
    this.el.appendChild(this.arrowEl);

    // Inner pulsing dot
    this.dotEl = document.createElement('div');
    this.dotEl.className = 'dmaps-puck-dot';
    this.dotEl.style.width = '18px';
    this.dotEl.style.height = '18px';
    this.dotEl.style.backgroundColor = '#1E88E5';
    this.dotEl.style.border = '3px solid #FFFFFF';
    this.dotEl.style.borderRadius = '50%';
    this.dotEl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)';
    this.dotEl.style.position = 'absolute';
    this.dotEl.style.top = '9px';
    this.dotEl.style.left = '9px';
    this.el.appendChild(this.dotEl);

    this.marker = new Marker({
      element: this.el,
      rotationAlignment: 'map',
      pitchAlignment: 'map',
    });
  }

  update(fix: Fix, stale: boolean = false): void {
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return;
    this.dotEl.style.backgroundColor = stale ? '#888888' : '#1E88E5';

    if (fix.heading !== null && fix.heading !== undefined && Number.isFinite(fix.heading)) {
      this.arrowEl.style.display = 'block';
      this.arrowEl.style.borderBottomColor = stale ? '#888888' : '#1E88E5';
      this.marker?.setRotation(fix.heading);
    } else {
      this.arrowEl.style.display = 'none';
      this.marker?.setRotation(0);
    }

    if (this.marker) {
      this.marker.setLngLat([fix.lon, fix.lat]);
      if (!this.isAdded) {
        this.marker.addTo(this.map);
        this.isAdded = true;
      }
    }
  }

  remove(): void {
    this.marker?.remove();
    this.marker = null;
    this.isAdded = false;
  }
}
