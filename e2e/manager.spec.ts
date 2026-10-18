import { expect, test, type Page } from '@playwright/test';
import { canvasInkPixels, guardExternal, installDataset, openTab, pickPlace, waitForServiceWorker } from './helpers';

/**
 * Offline Map Manager, Settings, history and About, in a real browser.
 * Dataset: Monaco test fixture (the only one in the catalog). Nothing here claims Indonesian coverage.
 */

const status = (page: Page) => page.getByTestId('status-monaco');

test('manager: catalog tree, per-component status, verify, and delete with confirmation', async ({ page, context }) => {
  const leaked = await guardExternal(context);
  await page.goto('/');
  await openTab(page, 'regions');

  // the hierarchy is shown, and Indonesian regions or empty placeholder are present
  await expect(page.getByTestId('group-test-fixtures')).toBeVisible();
  await expect(page.getByTestId('group-indonesia')).toBeVisible();
  await expect(page.getByTestId('region-jambi').or(page.getByTestId('empty-indonesia'))).toBeVisible();
  await expect(status(page)).toHaveText('Belum diunduh');
  await expect(page.getByTestId('storage-usage')).toBeVisible();

  await page.getByTestId('dl-monaco').click();
  await expect(status(page)).toHaveText('Terpasang', { timeout: 30_000 });

  // rendering, routing and search data are reported separately
  for (const c of ['rendering', 'routing', 'search']) {
    await expect(page.getByTestId(`comp-monaco-${c}`)).toHaveAttribute('data-state', 'installed');
  }

  await page.getByTestId('verify-monaco').click();
  await expect(page.getByTestId('verify-result-monaco')).toContainText('lolos verifikasi');

  // deleting needs an explicit confirmation, and cancelling keeps the data
  await page.getByTestId('delete-monaco').click();
  await page.getByRole('button', { name: 'Batal' }).click();
  await expect(status(page)).toHaveText('Terpasang');
  await page.getByTestId('delete-monaco').click();
  await page.getByTestId('confirm-delete-monaco').click();
  await expect(status(page)).toHaveText('Belum diunduh');

  await openTab(page, 'map');
  await expect(page.getByTestId('data-status')).toContainText('Belum ada data peta');
  await expect(page.getByTestId('search-input')).toBeDisabled();
  expect(leaked).toEqual([]);
});

test('offline: installed data keeps working, the stale catalog is labelled, downloading is disabled', async ({ page, context }) => {
  const leaked = await guardExternal(context);
  await installDataset(page);
  await waitForServiceWorker(page);
  await context.setOffline(true);
  await page.reload();

  await openTab(page, 'regions');
  await expect(page.getByTestId('catalog-status')).toContainText('Offline: daftar wilayah dari');
  await expect(status(page)).toHaveText('Terpasang');
  await page.getByTestId('verify-monaco').click();
  await expect(page.getByTestId('verify-result-monaco')).toContainText('lolos verifikasi');

  // remove it while offline: re-downloading must be refused with an explanation, not attempted
  await page.getByTestId('delete-monaco').click();
  await page.getByTestId('confirm-delete-monaco').click();
  await expect(status(page)).toHaveText('Belum diunduh');
  await expect(page.getByTestId('dl-monaco')).toBeDisabled();
  await expect(page.getByTestId('region-monaco')).toContainText('butuh koneksi internet');
  expect(leaked).toEqual([]);
});

test('pause keeps verified files, resume downloads only what is missing', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (r) => { const m = /\/data\/monaco\/([^/?]+)/.exec(r.url()); if (m) requested.push(m[1]); });

  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  let hold = true;
  await page.route('**/data/monaco/features.json*', async (route) => {
    if (hold) { await gate; }
    await route.continue().catch(() => { /* the request was aborted by Pause */ });
  });

  await page.goto('/');
  await openTab(page, 'regions');
  await page.getByTestId('dl-monaco').click();
  // the last file has been requested and is held at the gate (the label only changes when bytes arrive)
  await expect.poll(() => requested.includes('features.json')).toBe(true);
  await page.getByTestId('pause-monaco').click();
  await expect(status(page)).toContainText('Dijeda');
  hold = false; release();

  await page.getByTestId('resume-monaco').click();
  await expect(status(page)).toHaveText('Terpasang', { timeout: 30_000 });

  // graph.bin, ways.json and places.json were verified before the pause: never fetched a second time
  for (const f of ['graph.bin', 'ways.json', 'places.json']) {
    expect(requested.filter((x) => x === f), `${f} must be downloaded once`).toHaveLength(1);
  }
});

test('settings: theme and language persist across reloads; versions are shown', async ({ page }) => {
  await installDataset(page);
  await openTab(page, 'settings');

  await expect(page.getByTestId('app-version')).toHaveText(/^\d+\.\d+\.\d+/);
  await expect(page.getByTestId('data-versions')).toContainText('Monaco');

  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('lang-en').click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openTab(page, 'settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  // follow the OS again: the override disappears
  await page.getByTestId('theme-system').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);

  // a preference toggle persists too
  await page.getByTestId('opt-keepAwake').uncheck();
  await page.reload();
  await openTab(page, 'settings');
  await expect(page.getByTestId('opt-keepAwake')).not.toBeChecked();
});

test('dark theme still draws the map and the route', async ({ page }) => {
  await installDataset(page);
  await openTab(page, 'settings');
  await page.getByTestId('theme-dark').click();
  await openTab(page, 'map');
  await expect.poll(() => canvasInkPixels(page)).toBeGreaterThan(1000);
  await pickPlace(page, 'casino', 'Casino de Monte Carlo', 'set-from');
  await pickPlace(page, 'balmoral', 'Balmoral', 'set-to');
  await expect(page.getByTestId('route-summary')).toBeVisible();
});

test('search history and recent destinations are stored locally and can be cleared', async ({ page, context }) => {
  const leaked = await guardExternal(context);
  await installDataset(page);

  // nothing recorded yet
  await expect(page.getByTestId('history')).toHaveCount(0);

  await pickPlace(page, 'balmoral', 'Balmoral', 'set-to');
  await expect(page.getByTestId('history')).toBeVisible();
  await expect(page.getByTestId('history-query').first()).toHaveText('balmoral');
  await expect(page.getByTestId('recent-destination').first()).toContainText('Balmoral');

  // survives a reload (IndexedDB), and a recent query can be re-run
  await page.reload();
  await page.getByTestId('history-query').first().click();
  await expect(page.getByTestId('search-input')).toHaveValue('balmoral');
  await page.getByTestId('search-input').fill('');

  await page.getByTestId('clear-history').click();
  await expect(page.getByTestId('history')).toHaveCount(0);
  await expect(page.getByTestId('history-note')).toContainText('Riwayat dihapus');

  // and from Settings
  await pickPlace(page, 'casino', 'Casino de Monte Carlo', 'set-to');
  await expect(page.getByTestId('history')).toBeVisible();
  await openTab(page, 'settings');
  await page.getByTestId('settings-clear-history').click();
  await expect(page.getByTestId('settings-history-cleared')).toBeVisible();
  await openTab(page, 'map');
  await expect(page.getByTestId('history')).toHaveCount(0);
  expect(leaked).toEqual([]);
});

test('about: honest status, limitations, attribution and third-party licences', async ({ page }) => {
  await page.goto('/');
  await openTab(page, 'about');
  await expect(page.getByTestId('about-status')).toContainText('prototipe');
  await expect(page.getByTestId('screen-about')).toContainText('Larangan belok sederhana');
  await expect(page.getByTestId('screen-about')).toContainText('Open Database License');
  await expect(page.getByTestId('notices')).toContainText('leaflet');
  await expect(page.getByTestId('notices')).toContainText('BSD-2-Clause');
});

test('the map and a running state survive switching tabs', async ({ page }) => {
  await installDataset(page);
  await pickPlace(page, 'casino', 'Casino de Monte Carlo', 'set-from');
  await pickPlace(page, 'balmoral', 'Balmoral', 'set-to');
  await expect(page.getByTestId('route-summary')).toBeVisible();
  for (const t of ['regions', 'settings', 'about'] as const) await openTab(page, t);
  await openTab(page, 'map');
  await expect(page.getByTestId('route-summary')).toBeVisible();
  await expect.poll(() => canvasInkPixels(page)).toBeGreaterThan(1000);
});
