import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  InstallJob, listDatasets, removeDataset, verifyDataset, type DatasetRecord, type JobSnapshot, type VerifyResult,
} from '../storage';
import { CatalogError, datasetBaseUrl, fetchCatalog, loadCachedCatalog, type CatalogDataset, type CatalogFile } from './catalog';
import { loadRegion } from './load';
import { RegionSet, type RegionRuntime } from './regionSet';

export type CatalogState =
  | { phase: 'loading' }
  | { phase: 'fresh'; catalog: CatalogFile; fetchedAt: number }
  /** fetch failed (offline or host down) but an earlier copy exists */
  | { phase: 'cached'; catalog: CatalogFile; fetchedAt: number }
  | { phase: 'unavailable' };

export interface RegionsApi {
  /** false until the first read of local storage has finished */
  ready: boolean;
  installed: DatasetRecord[];
  regionSet: RegionSet;
  catalog: CatalogState;
  jobs: Record<string, JobSnapshot>;
  catalogBase: string;
  refreshCatalog(): Promise<void>;
  /** download, resume, retry and update all go through here: verified files are never fetched twice */
  install(region: CatalogDataset): void;
  /** download several regions one after another; stops at the first pause, cancel or failure */
  installMany(regions: CatalogDataset[]): Promise<void>;
  pause(id: string): void;
  cancel(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  verify(id: string): Promise<VerifyResult[]>;
}

const Ctx = createContext<RegionsApi | null>(null);

export function useRegions(): RegionsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRegions must be used inside <RegionsProvider>');
  return v;
}

const CATALOG_BASE = `${import.meta.env.BASE_URL}data`;

export function RegionsProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState<DatasetRecord[]>([]);
  const [runtimes, setRuntimes] = useState<Record<string, RegionRuntime>>({});
  const [catalog, setCatalog] = useState<CatalogState>({ phase: 'loading' });
  const [jobs, setJobs] = useState<Record<string, JobSnapshot>>({});
  const jobObjs = useRef(new Map<string, InstallJob>());
  const catalogRef = useRef<CatalogFile | null>(null);

  const loaded = useRef(new Map<string, { version: string; runtime: RegionRuntime }>());
  const syncSeq = useRef(0);

  /** Re-reads IndexedDB and (re)loads runtimes for complete datasets; drops runtimes whose dataset is gone or changed version. */
  const syncInstalled = useCallback(async () => {
    const seq = ++syncSeq.current;
    const all = await listDatasets();
    if (seq !== syncSeq.current) return; // a newer sync superseded this one
    setInstalled(all);
    const complete = all.filter((r) => r.status === 'complete');
    for (const id of [...loaded.current.keys()]) {
      if (!complete.some((r) => r.id === id && r.dataVersion === loaded.current.get(id)?.version)) loaded.current.delete(id);
    }
    for (const r of complete) {
      if (loaded.current.has(r.id)) continue;
      try {
        const { runtime } = await loadRegion(r.id);
        loaded.current.set(r.id, { version: r.dataVersion, runtime });
      } catch { /* evicted or corrupt: the manager shows it as partial; Verify explains */ }
    }
    if (seq !== syncSeq.current) return;
    setRuntimes(Object.fromEntries([...loaded.current].map(([id, v]) => [id, v.runtime])));
  }, []);

  useEffect(() => {
    void syncInstalled().finally(() => setReady(true));
  }, [syncInstalled]);

  const refreshCatalog = useCallback(async () => {
    setCatalog((c) => (c.phase === 'fresh' || c.phase === 'cached' ? c : { phase: 'loading' }));
    try {
      const { catalog: c, fetchedAt } = await fetchCatalog(CATALOG_BASE);
      catalogRef.current = c;
      setCatalog({ phase: 'fresh', catalog: c, fetchedAt });
    } catch (err) {
      const cached = await loadCachedCatalog();
      if (cached) { catalogRef.current = cached.catalog; setCatalog({ phase: 'cached', ...cached }); }
      else setCatalog({ phase: 'unavailable' });
      if (err instanceof CatalogError) console.warn(err.message);
    }
  }, []);

  useEffect(() => { void refreshCatalog(); }, [refreshCatalog]);

  const onJob = useCallback((s: JobSnapshot) => {
    setJobs((j) => ({ ...j, [s.id]: s }));
    if (s.state === 'done' || s.state === 'cancelled') {
      void syncInstalled();
      if (s.state === 'done') void navigator.storage?.persist?.().catch(() => false);
    }
    if (s.state === 'paused' || s.state === 'failed') void syncInstalled(); // keeps the partial record visible
  }, [syncInstalled]);

  const jobFor = useCallback((region: CatalogDataset): InstallJob => {
    let job = jobObjs.current.get(region.id);
    if (!job) {
      job = new InstallJob(region.id, { baseUrl: datasetBaseUrl(region, CATALOG_BASE) }, onJob, region.bytes);
      jobObjs.current.set(region.id, job);
    }
    return job;
  }, [onJob]);

  const install = useCallback((region: CatalogDataset) => { void jobFor(region).start(); }, [jobFor]);
  const pause = useCallback((id: string) => { void jobObjs.current.get(id)?.pause(); }, []);
  const installMany = useCallback(async (regions: CatalogDataset[]) => {
    for (const r of regions) {
      const job = jobFor(r);
      await job.start();
      if (job.snapshot.state !== 'done') break;
    }
  }, [jobFor]);
  const cancel = useCallback(async (id: string) => {
    const job = jobObjs.current.get(id);
    if (job) await job.cancel(); else await removeDataset(id);
    jobObjs.current.delete(id);
    setJobs((j) => { const n = { ...j }; delete n[id]; return n; });
    await syncInstalled();
  }, [syncInstalled]);
  const remove = useCallback(async (id: string) => {
    await removeDataset(id);
    jobObjs.current.delete(id);
    setJobs((j) => { const n = { ...j }; delete n[id]; return n; });
    await syncInstalled();
  }, [syncInstalled]);
  const verify = useCallback((id: string) => verifyDataset(id), []);

  const regionSet = useMemo(() => new RegionSet(Object.values(runtimes)), [runtimes]);

  const api: RegionsApi = {
    ready, installed, regionSet, catalog, jobs, catalogBase: CATALOG_BASE,
    refreshCatalog, install, installMany, pause, cancel, remove, verify,
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
