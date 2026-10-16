import { componentOf, COMPONENTS, type Component } from '../regions/catalog';
import {
  IntegrityError, StorageQuotaError, estimateStorage, getDataset, installDataset, listDatasets, removeDataset,
  type InstallOptions,
} from './datasets';
import { getDb } from './db';

export type ComponentState = 'installed' | 'partial' | 'missing';
export interface ComponentStatus {
  component: Component;
  state: ComponentState;
  bytes: number;
  files: { name: string; bytes: number; present: boolean }[];
}

/**
 * Per-component status of an installed (or half-installed) dataset, from what is physically in storage.
 * Cheap: presence only. A full SHA-256 re-check is `verifyDataset`.
 */
export async function componentStatus(id: string): Promise<ComponentStatus[]> {
  const rec = await getDataset(id);
  if (!rec) return COMPONENTS.map((component) => ({ component, state: 'missing' as const, bytes: 0, files: [] }));
  const db = await getDb();
  const byComp = new Map<Component, ComponentStatus['files']>();
  for (const f of rec.manifest.files) {
    const present = (await db.getKey('blobs', `${id}/${f.sha256}`)) !== undefined;
    const c = componentOf(f.name);
    byComp.set(c, [...(byComp.get(c) ?? []), { name: f.name, bytes: f.bytes, present }]);
  }
  return COMPONENTS.map((component) => {
    const files = byComp.get(component) ?? [];
    const have = files.filter((f) => f.present).length;
    const state: ComponentState = files.length === 0 || have === 0 ? 'missing' : have === files.length ? 'installed' : 'partial';
    return { component, state, bytes: files.reduce((s, f) => s + f.bytes, 0), files };
  });
}

export interface StorageSummary {
  quota?: number;
  usage?: number;
  /** undefined when the browser cannot tell */
  persisted?: boolean;
  /** bytes of each dataset's files that are actually stored */
  datasetBytes: Record<string, number>;
}

export async function storageSummary(estimate: () => ReturnType<typeof estimateStorage> = estimateStorage): Promise<StorageSummary> {
  const est = await estimate();
  let persisted: boolean | undefined;
  try { persisted = await navigator.storage?.persisted?.(); } catch { persisted = undefined; }
  const db = await getDb();
  const datasetBytes: Record<string, number> = {};
  for (const rec of await listDatasets()) {
    let sum = 0;
    for (const f of rec.manifest.files) if ((await db.getKey('blobs', `${rec.id}/${f.sha256}`)) !== undefined) sum += f.bytes;
    datasetBytes[rec.id] = sum;
  }
  return { quota: est.quota, usage: est.usage, persisted, datasetBytes };
}

export type JobState = 'running' | 'paused' | 'failed' | 'done' | 'cancelled';
export type JobError = 'quota' | 'integrity' | 'network';
export interface JobSnapshot {
  id: string;
  state: JobState;
  bytesDone: number;
  bytesTotal: number;
  file?: string;
  error?: JobError;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
export const jobErrorOf = (e: unknown): JobError =>
  e instanceof StorageQuotaError ? 'quota' : e instanceof IntegrityError ? 'integrity' : 'network';

/**
 * One dataset download that can be paused, resumed, cancelled and retried.
 *
 * Pause aborts the transfer but keeps every file already verified; resume skips those. Granularity is a
 * whole file: bytes of the file in flight at pause time are discarded and that file starts over.
 * Cancel also deletes what was stored. Failures keep stored files so Retry continues, not restarts.
 */
export class InstallJob {
  private ctrl: AbortController | null = null;
  private wantPause = false;
  private snap: JobSnapshot;
  private running: Promise<void> | null = null;

  constructor(
    readonly id: string,
    private readonly opts: Pick<InstallOptions, 'baseUrl' | 'fetchImpl' | 'estimate'>,
    private readonly onChange: (s: JobSnapshot) => void,
    totalBytes = 0,
  ) {
    this.snap = { id, state: 'paused', bytesDone: 0, bytesTotal: totalBytes };
  }

  get snapshot(): JobSnapshot { return this.snap; }
  /** resolves when the current run ends (done, paused, failed or cancelled) */
  get settled(): Promise<void> { return this.running ?? Promise.resolve(); }

  private set(patch: Partial<JobSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.onChange(this.snap);
  }

  /** Start or resume. No-op if already running. */
  start(): Promise<void> {
    if (this.snap.state === 'running') return this.settled;
    this.wantPause = false;
    this.ctrl = new AbortController();
    this.set({ state: 'running', error: undefined });
    this.running = installDataset({
      ...this.opts,
      signal: this.ctrl.signal,
      onProgress: (p) => this.set({ bytesDone: p.bytesDone, bytesTotal: p.bytesTotal, file: p.file }),
    }).then(
      () => this.set({ state: 'done', file: undefined }),
      (err) => {
        if (isAbort(err)) { this.set({ state: this.wantPause ? 'paused' : 'cancelled' }); return; }
        this.set({ state: 'failed', error: jobErrorOf(err) });
      },
    );
    return this.running;
  }

  pause(): Promise<void> {
    if (this.snap.state !== 'running') return Promise.resolve();
    this.wantPause = true;
    this.ctrl?.abort();
    return this.settled;
  }

  /** Stop and delete everything stored for this dataset (including already-verified files). */
  async cancel(): Promise<void> {
    this.wantPause = false;
    if (this.snap.state === 'running') { this.ctrl?.abort(); await this.settled; }
    await removeDataset(this.id);
    this.set({ state: 'cancelled', bytesDone: 0, file: undefined, error: undefined });
  }
}
