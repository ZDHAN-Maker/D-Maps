import { useTranslation } from 'react-i18next';
import notices from '../about/notices.json';

interface Notice { name: string; version: string; license: string }

export default function AboutScreen() {
  const { t } = useTranslation();
  const list = notices as Notice[];
  const limits = t('about.limitList', { returnObjects: true }) as unknown as string[];

  return (
    <div className="screen" data-testid="screen-about" tabIndex={0} aria-label={t('about.title')}>
      <header className="brand">
        <img src={`${import.meta.env.BASE_URL}icons/dmaps-icon.svg`} alt="" width={64} height={64} />
        <div>
          <h2>{t('about.title')}</h2>
          <p className="tagline">{t('tagline')}</p>
        </div>
      </header>
      <p>{t('about.intro')}</p>
      <p className="note" data-testid="about-status">{t('about.status')}</p>

      <section className="card" aria-labelledby="ab-lim">
        <h3 id="ab-lim">{t('about.limitations')}</h3>
        <ul className="plain">{Array.isArray(limits) && limits.map((l) => <li key={l}>{l}</li>)}</ul>
      </section>

      <section className="card" aria-labelledby="ab-data">
        <h3 id="ab-data">{t('about.data')}</h3>
        <p>{t('about.dataText')}</p>
      </section>

      <section className="card" aria-labelledby="ab-thx">
        <h3 id="ab-thx">{t('about.thanks')}</h3>
        <table className="comps" data-testid="notices">
          <thead><tr><th scope="col">&nbsp;</th><th scope="col">&nbsp;</th><th scope="col">{t('about.licenseCol')}</th></tr></thead>
          <tbody>
            {list.map((n) => (
              <tr key={n.name}><th scope="row">{n.name}</th><td>{n.version}</td><td>{n.license}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
