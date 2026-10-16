/**
 * Best-effort screen wake lock for navigation (phones throttle location updates when the screen sleeps).
 * Unsupported or refused requests are not errors: navigation still works, the screen may just dim.
 */
interface Sentinel { release(): Promise<void>; addEventListener(t: 'release', cb: () => void): void }
interface WakeLockApi { request(type: 'screen'): Promise<Sentinel> }

export class ScreenWakeLock {
  private sentinel: Sentinel | null = null;
  private wanted = false;
  private readonly onVisible = () => { if (this.wanted && document.visibilityState === 'visible') void this.acquire(); };

  /** true if the browser exposes the API at all */
  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  private async acquire(): Promise<void> {
    if (!ScreenWakeLock.supported || this.sentinel) return;
    try {
      const api = (navigator as unknown as { wakeLock: WakeLockApi }).wakeLock;
      const s = await api.request('screen');
      s.addEventListener('release', () => { if (this.sentinel === s) this.sentinel = null; });
      this.sentinel = s;
    } catch { /* denied (battery saver, hidden tab): carry on without it */ }
  }

  async enable(): Promise<void> {
    this.wanted = true;
    document.addEventListener('visibilitychange', this.onVisible);
    await this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisible);
    const s = this.sentinel;
    this.sentinel = null;
    try { await s?.release(); } catch { /* already released */ }
  }
}
