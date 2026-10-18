import { Protocol } from 'pmtiles';
import { addProtocol } from 'maplibre-gl';

let protocolInstance: Protocol | null = null;

/**
 * Registers the PMTiles protocol with MapLibre GL JS so any 'pmtiles://...' source
 * or tile archive can be loaded natively offline without a tile server.
 */
export function registerPMTilesProtocol(): Protocol {
  if (!protocolInstance) {
    protocolInstance = new Protocol();
    addProtocol('pmtiles', protocolInstance.tile);
  }
  return protocolInstance;
}
