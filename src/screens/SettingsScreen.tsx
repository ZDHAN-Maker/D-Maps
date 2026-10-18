import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Languages, Layers, Lock, MapPinned, Moon, Trash2 } from 'lucide-react';
import { saveLanguage } from '../i18n';
import { useSettings, type ThemePref, type MapEngine } from '../settings/store';
import { clearHistory } from '../search/history';
import { useRegions } from '../regions/RegionsContext';
import type { Lang } from '../routing/describe';
import type { Tab } from '../App';

const THEMES: ThemePref[] = ['system', 'light', 'dark'];
const ENGINES: MapEngine[] = ['maplibre', 'leaflet'];

export default function SettingsScreen({ goTo }: { goTo(tab: Tab): void }) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'id';
  const [s, set] = useSettings();
  const regions = useRegions();
  const [cleared, setCleared] = useState(false);

  const setLang = (l: Lang) => { void i18n.changeLanguage(l); saveLanguage(l); document.documentElement.lang = l; };
  const complete = regions.installed.filter((d) => d.status === 'complete');

  return (
    <div className="screen" data-testid="screen-settings">
      <h2>{t('settings.title')}</h2>

      <section className="card" aria-labelledby="set-lang">
        <h3 id="set-lang"><Languages size={18} aria-hidden /> {t('settings.language')}</h3>
        <div className="seg" role="radiogroup" aria-labelledby="set-lang">
          {(['id', 'en'] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={lang === l} className="chip" data-testid={`lang-${l}`} onClick={() => setLang(l)}>
              {l === 'id' ? 'Bahasa Indonesia' : 'English'}
            </button>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="set-engine">
        <h3 id="set-engine"><Layers size={18} aria-hidden /> {t('settings.mapEngine')}</h3>
        <div className="seg" role="radiogroup" aria-labelledby="set-engine">
          {ENGINES.map((eng) => (
            <button key={eng} type="button" role="radio" aria-checked={s.mapEngine === eng} className="chip" data-testid={`engine-${eng}`} onClick={() => set({ mapEngine: eng })}>
              {t(`settings.mapEngines.${eng}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="set-theme">
        <h3 id="set-theme"><Moon size={18} aria-hidden /> {t('settings.theme')}</h3>
        <div className="seg" role="radiogroup" aria-labelledby="set-theme">
          {THEMES.map((th) => (
            <button key={th} type="button" role="radio" aria-checked={s.theme === th} className="chip" data-testid={`theme-${th}`} onClick={() => set({ theme: th })}>
              {t(`settings.themes.${th}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="set-loc">
        <h3 id="set-loc"><MapPinned size={18} aria-hidden /> {t('settings.location')}</h3>
        <label className="check"><input type="checkbox" data-testid="opt-keepAwake" checked={s.keepAwake} onChange={(e) => set({ keepAwake: e.target.checked })} /> {t('settings.keepAwake')}</label>
        <label className="check"><input type="checkbox" data-testid="opt-followOnStart" checked={s.followOnStart} onChange={(e) => set({ followOnStart: e.target.checked })} /> {t('settings.followOnStart')}</label>
        <label className="check"><input type="checkbox" data-testid="opt-highAccuracy" checked={s.highAccuracy} onChange={(e) => set({ highAccuracy: e.target.checked })} /> {t('settings.highAccuracy')}</label>
        <p className="note">{t('settings.locationNote')}</p>
      </section>

      <section className="card" aria-labelledby="set-stor">
        <h3 id="set-stor"><Database size={18} aria-hidden /> {t('settings.storage')}</h3>
        <div className="row">
          <button type="button" className="secondary" data-testid="open-regions" onClick={() => goTo('regions')}>{t('settings.manageData')}</button>
          <button type="button" className="secondary" data-testid="settings-clear-history" onClick={async () => { await clearHistory(); setCleared(true); }}>
            <Trash2 size={16} aria-hidden /> {t('settings.clearHistory')}
          </button>
        </div>
        {cleared && <p className="note" role="status" data-testid="settings-history-cleared">{t('history.cleared')}</p>}
      </section>

      <section className="card" aria-labelledby="set-ver">
        <h3 id="set-ver">{t('settings.versions')}</h3>
        <dl className="points wide">
          <dt>{t('settings.appVersion')}</dt><dd data-testid="app-version">{__APP_VERSION__}</dd>
          <dt>{t('settings.dataVersions')}</dt>
          <dd data-testid="data-versions">
            {complete.length === 0 ? t('settings.noData') : complete.map((d) => `${d.name}: ${d.dataVersion}`).join(' · ')}
          </dd>
        </dl>
        <p className="note">{t('settings.attribution')}: {t('attribution')}</p>
      </section>

      <section className="card" aria-labelledby="set-priv">
        <h3 id="set-priv"><Lock size={18} aria-hidden /> {t('settings.privacy')}</h3>
        <p>{t('settings.privacyText')}</p>
      </section>
    </div>
  );
}
