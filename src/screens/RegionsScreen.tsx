import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CircleAlert, CircleCheck, Download, FolderTree, LoaderCircle, Pause, Play, RefreshCw, RotateCw, ShieldCheck, Trash2, TriangleAlert,
  X, HardDrive, WifiOff,
} from 'lucide-react';
import { useRegions } from '../regions/RegionsContext';
import {
  COMPONENTS, buildTree, datasetsUnder, displayName, type CatalogDataset, type TreeNode,
} from '../regions/catalog';
import {
  QUOTA_MARGIN, componentStatus, requestPersistence, storageSummary, type ComponentStatus, type DatasetRecord, type JobSnapshot,
  type StorageSummary,
} from '../storage';
import { formatBytes, formatWhen } from '../lib/format';
import type { Lang } from '../routing/describe';

type Status = 'none' | 'downloading' | 'paused' | 'failed' | 'installed' | 'update';

/** Everything the card needs to show a dataset, whether it came from the catalog or only exists locally. */
interface Row {
  id: string;
  name: string;
  testFixture: boolean;
  bytes: number;
  dataVersion: string;
  /** present when the catalog lists it: the only case in which download/resume/update is possible */
  region?: CatalogDataset;
}

function statusOf(row: Row, rec: DatasetRecord | undefined, job: JobSnapshot | undefined): Status {
  if (job?.state === 'running') return 'downloading';
  if (job?.state === 'paused') return 'paused';
  if (job?.state === 'failed') return 'failed';
  if (rec?.status === 'complete') return row.region && row.region.dataVersion !== rec.dataVersion ? 'update' : 'installed';
  if (rec?.status === 'installing') return 'paused'; // interrupted earlier (tab closed): resumable
  if (rec?.status === 'failed') return 'failed';
  return 'none';
}

function percentOf(job: JobSnapshot | undefined, rec: DatasetRecord | undefined, total: number): number {
  if (job && job.bytesTotal > 0 && job.bytesDone > 0) return Math.min(99, Math.round((job.bytesDone / job.bytesTotal) * 100));
  if (rec && rec.totalBytes > 0) {
    const done = rec.manifest.files.filter((f) => rec.filesDone.includes(f.sha256)).reduce((s, f) => s + f.bytes, 0);
    return Math.min(99, Math.round((done / (rec.totalBytes || total)) * 100));
  }
  return 0;
}

function DatasetCard({ row, lang, online, free, onChanged }: { row: Row; lang: Lang; online: boolean; free: number | undefined; onChanged(): void }) {
  const { t } = useTranslation();
  const r = useRegions();
  const rec = r.installed.find((d) => d.id === row.id);
  const job = r.jobs[row.id];
  const status = statusOf(row, rec, job);
  const [comps, setComps] = useState<ComponentStatus[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const jobState = job?.state;
  const filesDone = rec?.filesDone.length;
  useEffect(() => {
    let alive = true;
    if (!rec) { setComps(null); return; }
    void componentStatus(row.id).then((c) => { if (alive) setComps(c); });
    return () => { alive = false; };
  }, [row.id, rec?.status, rec?.dataVersion, filesDone, jobState]); // `rec` fields are the real inputs; the object identity changes on every sync

  const pct = percentOf(job, rec, row.bytes);
  const need = status === 'none' || status === 'update' ? row.bytes : Math.max(0, row.bytes - (rec ? rec.manifest.files.filter((f) => rec.filesDone.includes(f.sha256)).reduce((s, f) => s + f.bytes, 0) : 0));
  const tooBig = free !== undefined && (status === 'none' || status === 'update' || status === 'paused' || status === 'failed') && need * QUOTA_MARGIN > free;
  const canFetch = !!row.region && online && !tooBig;

  const start = () => { if (row.region) r.install(row.region); };
  const doVerify = async () => {
    setVerifying(true); setVerifyMsg(null);
    try {
      const res = await r.verify(row.id);
      const bad = res.filter((x) => !x.ok).map((x) => x.file);
      setVerifyMsg(bad.length === 0 ? t('regions.verifyOk') : t('regions.verifyBad', { files: bad.join(', ') }));
    } finally { setVerifying(false); }
  };
  const doDelete = async () => { setConfirming(false); await r.remove(row.id); onChanged(); };
  const doCancel = async () => { await r.cancel(row.id); onChanged(); };

  const statusLabel: Record<Status, string> = {
    none: t('regions.notInstalled'),
    downloading: t('regions.downloading', { file: job?.file ?? '…', percent: pct }),
    paused: t('regions.paused', { percent: pct }),
    failed: `${t('regions.failed')}: ${job?.error ? t(`regions.errors.${job.error}`) : (job?.errorMessage || '')}`,
    installed: t('regions.installed'),
    update: t('regions.updateAvailable'),
  };

  return (
    <li className="region-card" data-testid={`region-${row.id}`}>
      <div className="region-head">
        <div>
          <strong>{row.name}</strong>
          {row.testFixture && <span className="badge">{t('regions.testBadge')}</span>}
          <div className="note">{formatBytes(row.bytes, lang)} · {t('regions.version', { version: row.dataVersion })}</div>
        </div>
        <span className={`pill pill-${status}`} data-testid={`status-${row.id}`} role="status">
          {status === 'installed' && <CircleCheck size={14} aria-hidden />}
          {status === 'downloading' && <LoaderCircle size={14} className="spin" aria-hidden />}
          {(status === 'failed') && <CircleAlert size={14} aria-hidden />}
          {statusLabel[status]}
        </span>
      </div>

      {(status === 'downloading' || status === 'paused') && (
        <div className="bar" role="progressbar" aria-label={row.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} data-testid={`progress-${row.id}`}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}

      {comps && rec && (
        <table className="comps" aria-label={t('regions.title')}>
          <tbody>
            {COMPONENTS.map((c) => {
              const cs = comps.find((x) => x.component === c);
              return (
                <tr key={c} data-testid={`comp-${row.id}-${c}`} data-state={cs?.state ?? 'missing'}>
                  <th scope="row">{t(`regions.components.${c}`)}</th>
                  <td>{cs ? formatBytes(cs.bytes, lang) : '–'}</td>
                  <td className={`cs cs-${cs?.state ?? 'missing'}`}>{t(`regions.compState.${cs?.state ?? 'missing'}`)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {tooBig && <p className="error" role="alert"><TriangleAlert size={16} aria-hidden /> {t('regions.notEnoughSpaceOne', { need: formatBytes(need * QUOTA_MARGIN, lang), free: formatBytes(free ?? 0, lang) })}</p>}
      {verifyMsg && <p role="status" data-testid={`verify-result-${row.id}`}>{verifyMsg}</p>}

      <div className="row">
        {status === 'none' && <button type="button" className="primary" data-testid={`dl-${row.id}`} disabled={!canFetch} onClick={start}><Download size={16} aria-hidden /> {t('regions.download')}</button>}
        {status === 'update' && <button type="button" className="primary" data-testid={`update-${row.id}`} disabled={!canFetch} onClick={start}><RefreshCw size={16} aria-hidden /> {t('regions.update')}</button>}
        {status === 'downloading' && <button type="button" className="secondary" data-testid={`pause-${row.id}`} onClick={() => r.pause(row.id)}><Pause size={16} aria-hidden /> {t('regions.pause')}</button>}
        {status === 'paused' && <button type="button" className="primary" data-testid={`resume-${row.id}`} disabled={!canFetch} onClick={start}><Play size={16} aria-hidden /> {t('regions.resume')}</button>}
        {status === 'failed' && <button type="button" className="primary" data-testid={`retry-${row.id}`} disabled={!canFetch} onClick={start}><RotateCw size={16} aria-hidden /> {t('regions.retry')}</button>}
        {(status === 'downloading' || status === 'paused' || status === 'failed') && (
          <button type="button" className="secondary" data-testid={`cancel-${row.id}`} onClick={doCancel}><X size={16} aria-hidden /> {t('regions.cancel')}</button>
        )}
        {(status === 'installed' || status === 'update') && (
          <button type="button" className="secondary" data-testid={`verify-${row.id}`} disabled={verifying} onClick={doVerify}>
            <ShieldCheck size={16} aria-hidden /> {verifying ? t('regions.verifying') : t('regions.verify')}
          </button>
        )}
        {(status === 'installed' || status === 'update') && !confirming && (
          <button type="button" className="secondary" data-testid={`delete-${row.id}`} onClick={() => setConfirming(true)}><Trash2 size={16} aria-hidden /> {t('regions.delete')}</button>
        )}
      </div>
      {!online && row.region && (status === 'none' || status === 'paused' || status === 'failed' || status === 'update') && (
        <p className="note"><WifiOff size={14} aria-hidden /> {t('regions.needInternet')}</p>
      )}
      {confirming && (
        <div className="confirm" role="alertdialog" aria-label={t('regions.confirmDelete', { name: row.name })}>
          <p>{t('regions.confirmDelete', { name: row.name })}</p>
          <div className="row">
            <button type="button" className="primary danger" data-testid={`confirm-delete-${row.id}`} onClick={doDelete}>{t('regions.confirmYes')}</button>
            <button type="button" className="secondary" onClick={() => setConfirming(false)}>{t('regions.confirmNo')}</button>
          </div>
        </div>
      )}
    </li>
  );
}

function GroupNode({ node, lang, online, free, depth, onChanged }: { node: TreeNode; lang: Lang; online: boolean; free: number | undefined; depth: number; onChanged(): void }) {
  const { t } = useTranslation();
  const r = useRegions();
  const region = node.region;
  if (region.kind === 'dataset') {
    const rec = r.installed.find((d) => d.id === region.id);
    const row: Row = { id: region.id, name: displayName(region, lang), testFixture: !!region.testFixture, bytes: region.bytes, dataVersion: rec?.status === 'complete' ? rec.dataVersion : region.dataVersion, region };
    return <DatasetCard row={{ ...row, dataVersion: region.dataVersion }} lang={lang} online={online} free={free} onChanged={onChanged} />;
  }
  const all = datasetsUnder(node);
  const todo = all.filter((d) => r.installed.find((x) => x.id === d.id)?.status !== 'complete');
  const need = todo.reduce((s, d) => s + d.bytes, 0);
  const tooBig = free !== undefined && need * QUOTA_MARGIN > free;
  const Heading = depth === 0 ? 'h3' : 'h4';
  return (
    <li className="region-group" data-testid={`group-${region.id}`}>
      <Heading><FolderTree size={16} aria-hidden /> {displayName(region, lang)}{region.testFixture && <span className="badge">{t('regions.testBadge')}</span>}</Heading>
      {all.length === 0 && <p className="note" data-testid={`empty-${region.id}`}>{t('regions.emptyGroup')}</p>}
      {todo.length > 1 && (
        <>
          <button type="button" className="secondary" data-testid={`download-all-${region.id}`} disabled={!online || tooBig}
            onClick={() => void r.installMany(todo)}>
            <Download size={16} aria-hidden /> {t('regions.downloadAll', { count: todo.length, size: formatBytes(need, lang) })}
          </button>
          {tooBig && <p className="error" role="alert"><TriangleAlert size={16} aria-hidden /> {t('regions.notEnoughSpace', { need: formatBytes(need * QUOTA_MARGIN, lang), free: formatBytes(free ?? 0, lang) })}</p>}
        </>
      )}
      {node.children.length > 0 && (
        <ul className="region-list">
          {node.children.map((c) => <GroupNode key={c.region.id} node={c} lang={lang} online={online} free={free} depth={depth + 1} onChanged={onChanged} />)}
        </ul>
      )}
    </li>
  );
}

export default function RegionsScreen({ online }: { online: boolean }) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'id';
  const r = useRegions();
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [persistMsg, setPersistMsg] = useState<string | null>(null);

  const refreshSummary = useCallback(() => { void storageSummary().then(setSummary); }, []);
  const jobStates = Object.values(r.jobs).map((j) => `${j.id}:${j.state}`).join(',');
  useEffect(refreshSummary, [refreshSummary, r.installed, jobStates]);

  const free = summary?.quota !== undefined && summary.usage !== undefined ? Math.max(0, summary.quota - summary.usage) : undefined;
  const catalog = r.catalog.phase === 'fresh' || r.catalog.phase === 'cached' ? r.catalog.catalog : null;
  const tree = useMemo(() => (catalog ? buildTree(catalog.regions) : []), [catalog]);
  const listed = new Set(catalog?.regions.map((x) => x.id));
  const orphans = r.installed.filter((d) => !listed.has(d.id));

  const persist = async () => {
    const ok = await requestPersistence();
    setPersistMsg(ok ? t('regions.persisted') : t('regions.persistDenied'));
    refreshSummary();
  };

  return (
    <div className="screen" data-testid="screen-regions">
      <h2>{t('regions.title')}</h2>
      <p>{t('regions.intro')}</p>

      <section className="card" aria-labelledby="stor-h">
        <h3 id="stor-h"><HardDrive size={18} aria-hidden /> {t('regions.storage')}</h3>
        {summary?.quota !== undefined && summary.usage !== undefined ? (
          <>
            <p data-testid="storage-usage">{t('regions.storageUsage', { usage: formatBytes(summary.usage, lang), quota: formatBytes(summary.quota, lang) })}</p>
            <div className="bar" role="progressbar" aria-label={t('regions.storage')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((summary.usage / Math.max(1, summary.quota)) * 100)}>
              <span style={{ width: `${Math.min(100, (summary.usage / Math.max(1, summary.quota)) * 100)}%` }} />
            </div>
          </>
        ) : <p data-testid="storage-usage">{t('regions.storageUnknown')}</p>}
        {summary?.persisted !== undefined && (
          <p className="note" data-testid="persist-state">{persistMsg ?? (summary.persisted ? t('regions.persisted') : t('regions.notPersisted'))}</p>
        )}
        {summary?.persisted === false && <div className="row"><button type="button" className="secondary" onClick={persist}>{t('regions.requestPersist')}</button></div>}
      </section>

      <p className="note" data-testid="catalog-status" role="status">
        {r.catalog.phase === 'loading' && t('regions.catalogLoading')}
        {r.catalog.phase === 'fresh' && t('regions.catalogFresh')}
        {r.catalog.phase === 'cached' && t('regions.catalogCached', { when: formatWhen(r.catalog.fetchedAt, lang) })}
        {r.catalog.phase === 'unavailable' && t('regions.catalogUnavailable')}
        {' '}
        {r.catalog.phase !== 'loading' && online && <button type="button" className="chip" onClick={() => void r.refreshCatalog()}><RefreshCw size={14} aria-hidden /> {t('regions.refresh')}</button>}
      </p>

      <ul className="region-list" data-testid="region-tree">
        {tree.map((n) => <GroupNode key={n.region.id} node={n} lang={lang} online={online} free={free} depth={0} onChanged={refreshSummary} />)}
        {orphans.length > 0 && (
          <li className="region-group">
            <h3><FolderTree size={16} aria-hidden /> {catalog ? t('regions.orphan') : t('regions.installed')}</h3>
            <ul className="region-list">
              {orphans.map((d) => (
                <DatasetCard key={d.id} lang={lang} online={online} free={free} onChanged={refreshSummary}
                  row={{ id: d.id, name: d.name, testFixture: false, bytes: d.totalBytes, dataVersion: d.dataVersion }} />
              ))}
            </ul>
          </li>
        )}
      </ul>
      <p className="note">{t('regions.resumeNote')}</p>
    </div>
  );
}
