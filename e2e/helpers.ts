import { expect, type BrowserContext, type Page } from '@playwright/test';

export const isLocal = (url: string) => {
  if (url.startsWith('data:') || url.startsWith('blob:')) return true;
  const { hostname } = new URL(url);
  return hostname === '127.0.0.1' || hostname === 'localhost';
};

/** Aborts and records every request that leaves localhost, so a leak fails the test even if offline mode hid it. */
export async function guardExternal(context: BrowserContext): Promise<string[]> {
  const leaked: string[] = [];
  await context.route((url) => !isLocal(url.href), (route) => {
    leaked.push(route.request().url());
    return route.abort();
  });
  return leaked;
}

export type TabId = 'map' | 'regions' | 'settings' | 'about';
export const openTab = (page: Page, id: TabId) => page.getByTestId(`tab-${id}`).click();

/** Installs the Monaco fixture through the Offline Map Manager, then returns to the map. */
export async function installDataset(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('data-status')).toContainText('Belum ada data peta');
  await openTab(page, 'regions');
  await page.getByTestId('dl-monaco').click();
  await expect(page.getByTestId('status-monaco')).toHaveText('Terpasang', { timeout: 30_000 });
  await openTab(page, 'map');
  await expect(page.getByTestId('data-status')).toContainText('Terpasang: Monaco');
}

/** Language lives in Settings; the map screen stays mounted underneath, so route/state are kept. */
export async function setLanguage(page: Page, lang: 'id' | 'en') {
  await openTab(page, 'settings');
  await page.getByTestId(`lang-${lang}`).click();
  await openTab(page, 'map');
}

/** Waits until the service worker controls the page, so a later offline reload can be served from its cache. */
export async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

export async function pickPlace(page: Page, query: string, expectedName: string, role: 'set-from' | 'set-to') {
  const input = page.getByTestId('search-input');
  await input.fill(query);
  const item = page.getByTestId('result-item').filter({ hasText: expectedName }).first();
  await expect(item).toBeVisible();
  await item.getByTestId(role).click();
  await input.fill('');
}

export async function canvasInkPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    let ink = 0;
    for (const c of Array.from(document.querySelectorAll<HTMLCanvasElement>('.leaflet-overlay-pane canvas'))) {
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
    }
    for (const c of Array.from(document.querySelectorAll<HTMLCanvasElement>('.maplibregl-canvas'))) {
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (gl) {
        const pixels = new Uint8Array(c.width * c.height * 4);
        (gl as WebGLRenderingContext).readPixels(0, 0, c.width, c.height, (gl as WebGLRenderingContext).RGBA, (gl as WebGLRenderingContext).UNSIGNED_BYTE, pixels);
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) ink++;
      }
    }
    return ink;
  });
}

