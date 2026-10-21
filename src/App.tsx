import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Map as MapIcon, Settings, Download, Wifi, WifiOff, type LucideIcon } from 'lucide-react';
import { RegionsProvider } from './regions/RegionsContext';
import MapScreen from './screens/MapScreen';
import { applyTheme, useSettings } from './settings/store';
import './app.css';

// Secondary screens are separate chunks: the map is what people open first. The service worker still
// precaches every chunk, so these open offline too (covered by e2e/manager.spec.ts).
const RegionsScreen = lazy(() => import('./screens/RegionsScreen'));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen'));
const AboutScreen = lazy(() => import('./screens/AboutScreen'));

export type Tab = 'map' | 'regions' | 'settings' | 'about';

const TABS: { id: Tab; icon: LucideIcon }[] = [
  { id: 'map', icon: MapIcon },
  { id: 'regions', icon: Download },
  { id: 'settings', icon: Settings },
  { id: 'about', icon: Info },
];

function Shell() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('map');
  const [navigating, setNavigating] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [settings] = useSettings();

  useEffect(() => { applyTheme(settings.theme); }, [settings.theme]);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  const onNavigating = useCallback((n: boolean) => { setNavigating(n); if (n) setTab('map'); }, []);

  return (
    <div className={`shell${navigating ? ' shell-navigating' : ''}`}>
      <header className="topbar">
        <div className="brand-group">
          <img
            src={`${import.meta.env.BASE_URL}icons/dmaps-icon.svg`}
            alt="D'Maps Logo"
            className="brand-logo"
            width={38}
            height={38}
          />
          <div className="brand-titles">
            <strong className="name">D’Maps <span className="badge">{t('poc')}</span></strong>
            <span className="brand-tagline">Offline GPS Navigation OS</span>
          </div>
        </div>
        <span className={`status ${online ? 'on' : 'off'}`} data-testid="net-status" role="status">
          <span className="status-dot" aria-hidden />
          {online ? <Wifi size={16} aria-hidden /> : <WifiOff size={16} aria-hidden />}
          {online ? t('status.online') : t('status.offline')}
        </span>
      </header>

      <main className="content">
        {/* the map stays mounted so a running navigation and the map position survive tab changes */}
        <MapScreen online={online} active={tab === 'map'} goTo={setTab} onNavigatingChange={onNavigating} />
        <Suspense fallback={<p className="screen note" role="status">…</p>}>
          {tab === 'regions' && <RegionsScreen online={online} />}
          {tab === 'settings' && <SettingsScreen goTo={setTab} />}
          {tab === 'about' && <AboutScreen />}
        </Suspense>
      </main>

      <nav className="tabs" aria-label={t('tabs.label')}>
        {TABS.map(({ id, icon: Icon }) => (
          <button key={id} type="button" data-testid={`tab-${id}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            <Icon size={22} aria-hidden />
            <span>{t(`tabs.${id}`)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <RegionsProvider>
      <Shell />
    </RegionsProvider>
  );
}
