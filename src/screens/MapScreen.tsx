import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftRight, Banknote, BedDouble, Clock, Database, Fuel, Hospital, Landmark, LocateFixed, MapPin, Navigation, Pill, Play,
  Search, Trash2, TriangleAlert, UtensilsCrossed, type LucideIcon,
} from 'lucide-react';
import {
  describeStep, formatDistance, formatDuration, type LatLon, type RouteError, type RouteResult,
} from '../routing';
import type { PlaceRecord } from '../search';
import { clearHistory, getHistory, recordDestination, recordQuery, subscribeHistory, type History } from '../search/history';
import { buildFeatureLayers, PALETTES, type FeatureLayers } from '../map/features';
import { DeviceGps, type Fix, type GpsError } from '../gps';
import { PositionMarker } from '../map/position';
import NavigationView, { stepIcon } from '../nav/NavigationView';
import { useNavigation } from '../nav/useNavigation';
import { useRegions } from '../regions/RegionsContext';
import { settingsStore, useEffectiveTheme } from '../settings/store';
import { formatBytes } from '../lib/format';
import type { Lang } from '../routing/describe';
import type { Tab } from '../App';

const BUILDING_MIN_ZOOM = 15;

interface Point extends LatLon { label: string }

const CATEGORY_ICON: Record<string, LucideIcon> = {
  hospital: Hospital, pharmacy: Pill, fuel: Fuel, restaurant: UtensilsCrossed, hotel: BedDouble, atm: Banknote,
  attraction: Landmark,
};
const CHIPS = ['hospital', 'pharmacy', 'fuel', 'restaurant', 'hotel', 'atm', 'attraction'] as const;

const OVERLAY = {
  light: { line: '#0F4C5C', casing: '#FFFFFF', dotStroke: '#24424F', from: '#B9F3D0', to: '#FF9D91' },
  dark: { line: '#8DD9F5', casing: '#0B1418', dotStroke: '#E8F1F4', from: '#6FD3A0', to: '#FF9D91' },
} as const;

interface Props {
  online: boolean;
  /** the map stays mounted (so navigation and map state survive tab changes) but is hidden on other tabs */
  active: boolean;
  goTo(tab: Tab): void;
  onNavigatingChange(navigating: boolean): void;
}

export default function MapScreen({ online, active, goTo, onNavigatingChange }: Props) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'id';
  const regions = useRegions();
  const { regionSet } = regions;
  const hasData = !regionSet.isEmpty;
  const theme = useEffectiveTheme();

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const rendererRef = useRef<L.Canvas | null>(null);
  const featureRef = useRef<FeatureLayers[]>([]);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const posRef = useRef<PositionMarker | null>(null);
  const fittedKey = useRef('');

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [center, setCenter] = useState<LatLon | null>(null);
  const [from, setFrom] = useState<Point | null>(null);
  const [to, setTo] = useState<Point | null>(null);
  const [pick, setPick] = useState<'from' | 'to'>('from');
  const [follow, setFollow] = useState(true);
  const [simSpeed, setSimSpeed] = useState(1);
  const [myFix, setMyFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [history, setHistory] = useState<History>({ queries: [], destinations: [] });
  const [historyNote, setHistoryNote] = useState<string | null>(null);

  const hasDataRef = useRef(hasData);
  const pickRef = useRef(pick);
  hasDataRef.current = hasData;
  pickRef.current = pick;

  // storage is the source of truth: any screen that records or clears history updates this view too
  useEffect(() => {
    const load = () => { void getHistory().then(setHistory); };
    load();
    return subscribeHistory(load);
  }, []);

  const setPoint = useCallback((which: 'from' | 'to', p: Point) => {
    if (which === 'from') { setFrom(p); setPick('to'); } else { setTo(p); setPick('from'); }
  }, []);

  // ---- map: created once; vector features are drawn on a canvas, so nothing is fetched -----------------
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: true, preferCanvas: true }).setView([0, 118], 4);
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('© OpenStreetMap contributors (ODbL)');
    rendererRef.current = L.canvas({ padding: 0.4 });
    overlayRef.current = L.layerGroup().addTo(map);
    map.on('moveend', () => { const c = map.getCenter(); setCenter({ lat: c.lat, lon: c.lng }); });
    map.on('dragstart', () => setFollow(false)); // only a user drag; programmatic setView does not fire it
    map.on('zoomend', () => {
      const show = map.getZoom() >= BUILDING_MIN_ZOOM;
      for (const f of featureRef.current) {
        if (show && !map.hasLayer(f.buildings)) f.buildings.addTo(map);
        if (!show && map.hasLayer(f.buildings)) map.removeLayer(f.buildings);
      }
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!hasDataRef.current) return;
      const label = `${t('route.mapPoint')} (${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)})`;
      setPoint(pickRef.current, { lat: e.latlng.lat, lon: e.latlng.lng, label });
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => { if (active) { const id = setTimeout(() => mapRef.current?.invalidateSize(), 50); return () => clearTimeout(id); } }, [active]);

  // ---- draw every installed region; redraw when the set or the theme changes --------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !rendererRef.current) return;
    for (const f of featureRef.current) { map.removeLayer(f.base); map.removeLayer(f.buildings); }
    featureRef.current = [];
    for (const r of regionSet.regions) {
      const layers = buildFeatureLayers(r.features, rendererRef.current, PALETTES[theme]);
      layers.base.addTo(map);
      if (map.getZoom() >= BUILDING_MIN_ZOOM) layers.buildings.addTo(map);
      featureRef.current.push(layers);
    }
    const key = regionSet.regions.map((r) => r.id).join(',');
    if (key && key !== fittedKey.current) {
      const b = regionSet.regions.map((r) => r.bbox);
      map.fitBounds([[Math.min(...b.map((x) => x[0])), Math.min(...b.map((x) => x[1]))], [Math.max(...b.map((x) => x[2])), Math.max(...b.map((x) => x[3]))]]);
    }
    fittedKey.current = key;
  }, [regionSet, theme]);

  // ---- search -----------------------------------------------------------------------------------
  const results = useMemo(() => {
    if (!hasData || (!query.trim() && !category)) return null;
    return regionSet.search(query, { category, near: center ?? undefined, limit: 12 });
  }, [hasData, regionSet, query, category, center]);

  // ---- route ------------------------------------------------------------------------------------
  const route: RouteResult | RouteError | null = useMemo(() => {
    if (!hasData || !from || !to) return null;
    return regionSet.route(from, to);
  }, [hasData, regionSet, from, to]);

  const { ui: nav, start: startNavigation, stop: stopNavigation, dismissSummary } = useNavigation(hasData ? regionSet : null);
  const navigating = nav.phase !== 'idle';
  const shownRoute: RouteResult | null = navigating && nav.route ? nav.route : route?.ok ? route : null;
  useEffect(() => { onNavigatingChange(navigating); }, [navigating, onNavigatingChange]);

  useEffect(() => {
    const layer = overlayRef.current, map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    const c = OVERLAY[theme];
    const dot = (p: Point, fill: string) =>
      L.circleMarker([p.lat, p.lon], { radius: 9, color: c.dotStroke, weight: 3, fillColor: fill, fillOpacity: 1, interactive: false });
    if (from) layer.addLayer(dot(from, c.from));
    if (to) layer.addLayer(dot(to, c.to));
    if (shownRoute) {
      const line = L.polyline(shownRoute.geometry, { color: c.line, weight: 6, opacity: 0.95, interactive: false });
      layer.addLayer(L.polyline(shownRoute.geometry, { color: c.casing, weight: 10, opacity: 0.9, interactive: false }));
      layer.addLayer(line);
      if (!navigating) map.fitBounds(line.getBounds(), { padding: [40, 40] }); // while navigating the map follows the vehicle
    }
  }, [from, to, shownRoute, navigating, theme]);

  // ---- position marker + follow mode ----------------------------------------------------------------
  const shownFix = nav.phase === 'active' ? nav.fix : myFix;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!shownFix) { posRef.current?.remove(); posRef.current = null; return; }
    posRef.current ??= new PositionMarker(map);
    posRef.current.update(shownFix, nav.phase === 'active' && nav.stale);
    if (nav.phase === 'active' && follow) map.setView([shownFix.lat, shownFix.lon], Math.max(map.getZoom(), 17), { animate: false });
  }, [shownFix, nav.stale, nav.phase, follow]);

  // the map changes size when the navigation overlay replaces the side panel
  useEffect(() => { const id = setTimeout(() => mapRef.current?.invalidateSize(), 50); return () => clearTimeout(id); }, [navigating]);

  const focusLatLon = (lat: number, lon: number) => mapRef.current?.setView([lat, lon], Math.max(mapRef.current.getZoom(), 17));
  const asPoint = (p: PlaceRecord): Point => ({ lat: p.la, lon: p.lo, label: p.n });
  const choose = (which: 'from' | 'to', p: PlaceRecord) => {
    setPoint(which, asPoint(p));
    void recordQuery(query);
    if (which === 'to') void recordDestination({ label: p.n, lat: p.la, lon: p.lo });
  };
  const locateMe = async () => {
    setLocating(true); setLocError(null);
    try {
      const fix = await new DeviceGps(undefined, undefined, settingsStore.get().highAccuracy).getOnce();
      setMyFix(fix);
      setFrom({ lat: fix.lat, lon: fix.lon, label: t('route.myLocation') });
      setPick('to');
      mapRef.current?.setView([fix.lat, fix.lon], Math.max(mapRef.current.getZoom(), 16), { animate: false });
    } catch (err) {
      setLocError(t(`nav.gpsErrors.${(err as GpsError).code ?? 'position_unavailable'}`));
    } finally { setLocating(false); }
  };
  const startNav = (kind: 'device' | 'simulated') => {
    if (!route?.ok || !to) return;
    setFollow(settingsStore.get().followOnStart);
    startNavigation(route, to, kind === 'device' ? { kind: 'device' } : { kind: 'simulated', speedMultiplier: simSpeed });
  };
  const recenter = () => {
    setFollow(true);
    if (nav.fix) focusLatLon(nav.fix.lat, nav.fix.lon);
  };
  const clearAllHistory = async () => { await clearHistory(); setHistoryNote(t('history.cleared')); };

  const placeLabel = (p: PlaceRecord) =>
    t(`category.${p.c}`, { defaultValue: p.c }) + (p.c === 'hospital' && p.em === 'no' ? ` · ${t('search.noEmergency')}` : '');

  const installed = regions.installed.filter((d) => d.status === 'complete');
  const showHistory = hasData && !query.trim() && !category && (history.queries.length > 0 || history.destinations.length > 0);

  return (
    <div className={`app${navigating ? ' navigating' : ''}${active ? '' : ' is-hidden'}`} data-testid="screen-map" hidden={!active}>
      <aside className="panel" aria-label={t('tabs.map')}>
        <section className="card" aria-labelledby="data-h">
          <h2 id="data-h"><Database size={18} aria-hidden /> {t('data.title')}</h2>
          {!regions.ready && <p className="note">…</p>}
          {regions.ready && !hasData && (
            <>
              <p data-testid="data-status">{t('data.none')}</p>
              <button type="button" className="primary" data-testid="manage-btn" onClick={() => goTo('regions')}>
                <Database size={18} aria-hidden /> {t('data.manage')}
              </button>
            </>
          )}
          {hasData && (
            <>
              <p data-testid="data-status">
                {installed.length === 1
                  ? t('data.ready', { name: installed[0].name, version: installed[0].dataVersion, size: formatBytes(installed[0].totalBytes, lang) })
                  : t('data.readyMany', { names: installed.map((d) => d.name).join(', '), count: installed.length, size: formatBytes(installed.reduce((s, d) => s + d.totalBytes, 0), lang) })}
              </p>
              <p className="note">{t('data.notIndonesia')}</p>
              <div className="row">
                <button type="button" className="secondary" data-testid="manage-btn" onClick={() => goTo('regions')}>{t('data.manage')}</button>
              </div>
            </>
          )}
        </section>

        <section className="card" aria-labelledby="search-h">
          <h2 id="search-h"><Search size={18} aria-hidden /> {t('search.label')}</h2>
          <input
            type="search" data-testid="search-input" value={query} disabled={!hasData}
            placeholder={t('search.placeholder')} aria-label={t('search.label')}
            onChange={(e) => { setQuery(e.target.value); setHistoryNote(null); }}
          />
          <div className="chips" role="group" aria-label={t('search.label')}>
            {CHIPS.map((c) => {
              const Icon = CATEGORY_ICON[c];
              return (
                <button key={c} type="button" className="chip" disabled={!hasData} aria-pressed={category === c}
                  onClick={() => setCategory(category === c ? undefined : c)}>
                  <Icon size={14} aria-hidden /> {t(`category.${c}`)}
                </button>
              );
            })}
          </div>
          {!hasData && <p className="note">{t('search.needData')}</p>}
          {results && results.length === 0 && <p className="note" data-testid="no-results">{t('search.empty')}</p>}
          {results && results.length > 0 && (
            <ul className="results" data-testid="results">
              {results.map(({ place, distanceM, regionId }) => (
                <li key={`${regionId}:${place.i}`} data-testid="result-item">
                  <button type="button" className="result-main" onClick={() => focusLatLon(place.la, place.lo)}>
                    <MapPin size={16} aria-hidden />
                    <span>
                      <strong>{place.n}</strong>
                      <small>{placeLabel(place)}{place.a ? ` · ${place.a}` : ''}{distanceM !== undefined ? ` · ${t('search.away', { distance: formatDistance(distanceM, lang) })}` : ''}</small>
                    </span>
                  </button>
                  <div className="row">
                    <button type="button" className="chip" data-testid="set-from" aria-label={`${t('route.setFrom')}: ${place.n}`} onClick={() => choose('from', place)}>{t('route.from')}</button>
                    <button type="button" className="chip" data-testid="set-to" aria-label={`${t('route.setTo')}: ${place.n}`} onClick={() => choose('to', place)}>{t('route.to')}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {showHistory && (
            <div className="history" data-testid="history">
              {history.queries.length > 0 && (
                <>
                  <h3><Clock size={14} aria-hidden /> {t('history.recentQueries')}</h3>
                  <div className="chips">
                    {history.queries.map((q) => <button key={q} type="button" className="chip" data-testid="history-query" onClick={() => setQuery(q)}>{q}</button>)}
                  </div>
                </>
              )}
              {history.destinations.length > 0 && (
                <>
                  <h3><Navigation size={14} aria-hidden /> {t('history.recentDestinations')}</h3>
                  <ul className="results">
                    {history.destinations.map((d) => (
                      <li key={`${d.label}:${d.lat}:${d.lon}`} data-testid="recent-destination">
                        <button type="button" className="result-main" onClick={() => { setPoint('to', { lat: d.lat, lon: d.lon, label: d.label }); focusLatLon(d.lat, d.lon); }}>
                          <MapPin size={16} aria-hidden /><span><strong>{d.label}</strong></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="row">
                <button type="button" className="secondary" data-testid="clear-history" onClick={clearAllHistory}><Trash2 size={16} aria-hidden /> {t('history.clear')}</button>
              </div>
              <p className="note">{t('history.note')}</p>
            </div>
          )}
          {historyNote && <p className="note" role="status" data-testid="history-note">{historyNote}</p>}
        </section>

        <section className="card" aria-labelledby="route-h">
          <h2 id="route-h"><Navigation size={18} aria-hidden /> {t('route.title')}</h2>
          <dl className="points">
            <dt>{t('route.from')}</dt><dd data-testid="from-label">{from?.label ?? t('route.unset')}</dd>
            <dt>{t('route.to')}</dt><dd data-testid="to-label">{to?.label ?? t('route.unset')}</dd>
          </dl>
          <div className="row">
            <button type="button" className="secondary" data-testid="locate-me" disabled={!hasData || locating} onClick={locateMe}>
              <LocateFixed size={16} aria-hidden /> {locating ? t('route.locating') : t('route.useMyLocation')}
            </button>
          </div>
          {locError && <p className="error" role="alert" data-testid="loc-error"><TriangleAlert size={16} aria-hidden /> {locError}</p>}
          {hasData && <p className="note">{t('route.pickHint', { which: pick === 'from' ? t('route.from').toLowerCase() : t('route.to').toLowerCase() })}</p>}
          <div className="row">
            <button type="button" className="secondary" disabled={!from && !to} onClick={() => { setFrom(to); setTo(from); }}><ArrowLeftRight size={16} aria-hidden /> {t('route.swap')}</button>
            <button type="button" className="secondary" disabled={!from && !to} onClick={() => { setFrom(null); setTo(null); setPick('from'); }}>{t('route.clear')}</button>
          </div>
          {route && !route.ok && <p className="error" role="alert" data-testid="route-error"><TriangleAlert size={16} aria-hidden /> {t(`route.errors.${route.code}`)}</p>}
          {route?.ok && (
            <>
              <p className="summary" data-testid="route-summary">{t('route.summary', { distance: formatDistance(route.distanceM, lang), duration: formatDuration(route.durationS, lang) })}</p>
              <p className="note">{t('route.etaNote')}</p>
              <div className="row">
                <button type="button" className="primary" data-testid="start-nav" onClick={() => startNav('device')}>
                  <Play size={18} aria-hidden /> {t('nav.start')}
                </button>
                <button type="button" className="secondary" data-testid="start-sim" onClick={() => startNav('simulated')}>{t('nav.startSim')}</button>
                <label className="note">{t('nav.simSpeed')}{' '}
                  <select value={simSpeed} data-testid="sim-speed" onChange={(e) => setSimSpeed(Number(e.target.value))}>
                    <option value={1}>1×</option><option value={5}>5×</option>
                  </select>
                </label>
              </div>
              <p className="note">{t('nav.deviceNote')}</p>
              <ol className="steps" data-testid="steps">
                {route.steps.map((s, i) => {
                  const Icon = stepIcon(s);
                  return (
                    <li key={i} data-testid="step-item">
                      <Icon size={20} aria-hidden />
                      <span>{describeStep(s, lang)}</span>
                      {s.type !== 'arrive' && <small>{formatDistance(s.distanceM, lang)}</small>}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>
        <footer className="attr">{t('attribution')}</footer>
      </aside>
      <div className="map" ref={mapEl} role="application" aria-label={t('mapLabel')} data-testid="map" />
      {navigating && (
        <NavigationView
          nav={nav} lang={lang} online={online} destinationLabel={to?.label ?? ''} following={follow}
          onRecenter={recenter} onEnd={stopNavigation} onDone={dismissSummary}
        />
      )}
    </div>
  );
}
