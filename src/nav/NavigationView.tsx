import { useTranslation } from 'react-i18next';
import {
  ArrowUp, ArrowUpLeft, ArrowUpRight, CornerUpLeft, CornerUpRight, Crosshair, Flag, Navigation, RotateCcw, Signpost, TriangleAlert,
  Wifi, WifiOff, type LucideIcon,
} from 'lucide-react';
import { describeStep, formatDistance, formatDuration, type Lang, type Step } from '../routing';
import { isPoor } from '../gps';
import type { NavUi } from './useNavigation';

export function stepIcon(s: Step): LucideIcon {
  if (s.type === 'depart') return Navigation;
  if (s.type === 'arrive') return Flag;
  if (s.type === 'uturn') return RotateCcw;
  if (s.type === 'roundabout' || s.type === 'exit_roundabout') return Signpost;
  const m = s.modifier ?? 'straight';
  if (m === 'straight') return ArrowUp;
  if (m === 'slight_left') return ArrowUpLeft;
  if (m === 'slight_right') return ArrowUpRight;
  return m.endsWith('left') ? CornerUpLeft : CornerUpRight;
}

interface Props {
  nav: NavUi;
  lang: Lang;
  online: boolean;
  destinationLabel: string;
  following: boolean;
  onRecenter(): void;
  onEnd(): void;
  onDone(): void;
}

/** Full-screen navigation overlay: big next-maneuver card, GPS/offline status, remaining trip, end/recenter. */
export default function NavigationView({ nav, lang, online, destinationLabel, following, onRecenter, onEnd, onDone }: Props) {
  const { t } = useTranslation();

  if (nav.phase === 'summary' && nav.summary) {
    const s = nav.summary;
    return (
      <div className="nav nav-summary" data-testid="nav-summary" role="dialog" aria-modal="true" aria-labelledby="sum-h">
        <div className="card">
          <h2 id="sum-h"><Flag size={20} aria-hidden /> {s.arrived ? t('nav.arrivedTitle') : t('nav.stoppedTitle')}</h2>
          <dl className="points">
            <dt>{t('nav.summary.planned')}</dt><dd>{formatDistance(s.plannedDistanceM, lang)}</dd>
            <dt>{t('nav.summary.driven')}</dt><dd>{formatDistance(s.drivenDistanceM, lang)}</dd>
            <dt>{t('nav.summary.elapsed')}</dt><dd>{formatDuration(s.elapsedS, lang)}</dd>
            <dt>{t('nav.summary.reroutes')}</dt><dd>{s.reroutes}</dd>
          </dl>
          <p className="note">{t('nav.summary.disclaimer')}</p>
          <button type="button" className="primary" data-testid="nav-done" onClick={onDone}>{t('nav.summary.done')}</button>
        </div>
      </div>
    );
  }

  const next = nav.state?.nextStep ?? null;
  const Icon = next ? stepIcon(next) : Navigation;
  const fix = nav.fix;

  let gpsChip: { text: string; kind: 'ok' | 'warn' } | null = null;
  if (nav.simulated) gpsChip = { text: t('nav.gps.simulated'), kind: 'warn' };
  else if (nav.stale) gpsChip = { text: t('nav.gps.stale'), kind: 'warn' };
  else if (fix && isPoor(fix)) gpsChip = { text: t('nav.gps.poor', { m: Math.round(fix.accuracyM ?? 0) }), kind: 'warn' };
  else if (fix) gpsChip = { text: fix.accuracyM === undefined ? t('nav.gps.unknownAccuracy') : t('nav.gps.accuracy', { m: Math.round(fix.accuracyM) }), kind: 'ok' };

  return (
    <div className="nav" data-testid="nav-view">
      <div className="nav-top">
        <div className="nav-card" role="status" aria-live="polite">
          <Icon size={56} aria-hidden className="nav-icon" />
          {nav.state ? (
            <div>
              <div className="nav-dist" data-testid="nav-distance">{next ? formatDistance(nav.state.distanceToManeuverM, lang) : ''}</div>
              <div className="nav-instr" data-testid="nav-instruction">
                {next ? describeStep(next, lang) : t('nav.arrivedTitle')}
              </div>
            </div>
          ) : (
            <div className="nav-instr" data-testid="nav-instruction">{nav.gpsError ? '' : t('nav.waiting')}</div>
          )}
        </div>

        <div className="nav-chips">
          {gpsChip && <span className={`status ${gpsChip.kind === 'ok' ? 'on' : 'off'}`} data-testid="gps-chip">{gpsChip.text}</span>}
          <span className={`status ${online ? 'on' : 'off'}`}>
            {online ? <Wifi size={14} aria-hidden /> : <WifiOff size={14} aria-hidden />}
            {online ? t('status.online') : t('status.offline')}
          </span>
        </div>

        {nav.simulated && <p className="nav-notice" data-testid="sim-note">{t('nav.simNote')}</p>}
        {nav.gpsError && (
          <p className="nav-notice error" role="alert" data-testid="gps-error">
            <TriangleAlert size={16} aria-hidden /> {t(`nav.gpsErrors.${nav.gpsError.code}`)}
          </p>
        )}
        {nav.rerouting && <p className="nav-notice" role="status" data-testid="rerouting">{t('nav.rerouting')}</p>}
        {nav.justRerouted && <p className="nav-notice" role="status" data-testid="rerouted">{t('nav.rerouted')}</p>}
        {nav.rerouteFailed && !nav.rerouting && (
          <p className="nav-notice error" role="alert" data-testid="reroute-failed">
            <TriangleAlert size={16} aria-hidden /> {t('nav.rerouteFailed')}
          </p>
        )}
      </div>

      <div className="nav-bar">
        <div>
          <strong data-testid="nav-remaining">
            {nav.state ? t('nav.remaining', { distance: formatDistance(nav.state.remainingM, lang), duration: formatDuration(nav.state.remainingS, lang) }) : '—'}
          </strong>
          <small>{destinationLabel}</small>
        </div>
        <div className="row">
          {!following && (
            <button type="button" className="secondary" data-testid="nav-recenter" onClick={onRecenter}>
              <Crosshair size={18} aria-hidden /> {t('nav.recenter')}
            </button>
          )}
          <button type="button" className="primary danger" data-testid="nav-end" onClick={onEnd}>{t('nav.end')}</button>
        </div>
      </div>
    </div>
  );
}
