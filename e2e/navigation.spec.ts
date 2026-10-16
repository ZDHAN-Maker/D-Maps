import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { RoutingEngine } from '../src/routing';
import { routeFixes } from '../src/gps';
import { loadDataset } from '../tests/helpers/loadDataset';
import { guardExternal, installDataset, pickPlace } from './helpers';

/**
 * Navigation acceptance in a real browser, fully offline. Position comes from Playwright's geolocation
 * override, which exercises the real DeviceGps -> navigator.geolocation path (not the simulator).
 * Real GPS hardware, heading, drift and background throttling are NOT covered here: see README.
 */

const CASINO = { lat: 43.73926, lon: 7.428548 };
const BALMORAL = { lat: 43.737776, lon: 7.423681 };
const CAP_ESTEL = { lat: 43.718405, lon: 7.374079 };

const ds = loadDataset();
const engine = new RoutingEngine(ds.graph, { bbox: ds.manifest.bbox });
const planned = (() => {
  const r = engine.route(CASINO, BALMORAL);
  if (!r.ok) throw new Error(`fixture route failed: ${r.code}`);
  return r;
})();

async function setPos(context: BrowserContext, lat: number, lon: number, accuracy = 6) {
  await context.setGeolocation({ latitude: lat, longitude: lon, accuracy });
}

/** Installs data, goes offline, and plans Casino -> Balmoral using the device position as the start. */
async function planFromMyLocation(page: Page, context: BrowserContext) {
  await installDataset(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('data-status')).toContainText('Terpasang: Monaco');

  await context.grantPermissions(['geolocation']);
  await setPos(context, CASINO.lat, CASINO.lon);
  await page.getByTestId('locate-me').click();
  await expect(page.getByTestId('from-label')).toHaveText('Lokasi saya');
  await pickPlace(page, 'balmoral', 'Balmoral', 'set-to');
  await expect(page.getByTestId('route-summary')).toBeVisible();
}

test('device GPS: follows the route offline, next maneuver changes, arrives with a summary', async ({ page, context }) => {
  const leaked = await guardExternal(context);
  await planFromMyLocation(page, context);

  await page.getByTestId('start-nav').click();
  await expect(page.getByTestId('nav-view')).toBeVisible();
  await expect(page.getByTestId('gps-chip')).toContainText('GPS ±6 m');

  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));

  const seen: string[] = [];
  const remaining: string[] = [];
  const fixes = routeFixes(planned.geometry, { speedMps: 20, intervalS: 1, accuracyM: 6 });
  for (const f of fixes) {
    await setPos(context, f.lat, f.lon);
    await page.waitForTimeout(90);
    if (await page.getByTestId('nav-summary').isVisible()) break;
    const instr = await page.getByTestId('nav-instruction').textContent();
    if (instr && seen[seen.length - 1] !== instr) seen.push(instr);
    const rem = await page.getByTestId('nav-remaining').textContent();
    if (rem) remaining.push(rem);
  }

  await expect(page.getByTestId('nav-summary')).toBeVisible();
  await expect(page.getByTestId('nav-summary')).toContainText('Anda telah tiba');
  await expect(page.getByTestId('nav-summary')).toContainText('Hitung ulang rute0'); // no reroute on a faithful drive

  // the instruction card moved through more than one maneuver and ended on arrival
  expect(seen.length, `instructions seen: ${JSON.stringify(seen)}`).toBeGreaterThanOrEqual(2);
  expect(remaining[0]).not.toEqual(remaining[remaining.length - 1]);

  await page.getByTestId('nav-done').click();
  await expect(page.getByTestId('nav-view')).toHaveCount(0);
  expect(requests, 'navigation must not make any network request').toEqual([]);
  expect(leaked).toEqual([]);
});

test('leaving the route triggers an offline reroute, and ending early is reported as not completed', async ({ page, context }) => {
  const leaked = await guardExternal(context);
  await planFromMyLocation(page, context);
  await page.getByTestId('start-nav').click();
  await expect(page.getByTestId('nav-view')).toBeVisible();

  const cut = Math.floor(planned.geometry.length * 0.3);
  const head = planned.geometry.slice(0, cut + 1);
  const toWaypoint = engine.route({ lat: head[cut][0], lon: head[cut][1] }, CAP_ESTEL);
  if (!toWaypoint.ok) throw new Error('fixture detour failed');
  const path: [number, number][] = [...head, ...toWaypoint.geometry.slice(0, 60)];

  let rerouted = false;
  for (const f of routeFixes(path, { speedMps: 15, intervalS: 1, accuracyM: 6 })) {
    await setPos(context, f.lat, f.lon);
    await page.waitForTimeout(90);
    if (await page.getByTestId('rerouted').isVisible()) { rerouted = true; break; }
  }
  expect(rerouted, 'a reroute notice must appear after leaving the route').toBe(true);

  await page.getByTestId('nav-end').click();
  const summary = page.getByTestId('nav-summary');
  await expect(summary).toContainText('Navigasi dihentikan');
  await expect(summary).not.toContainText('Anda telah tiba');
  await expect(summary).not.toContainText('Hitung ulang rute0');
  expect(leaked).toEqual([]);
});

test('GPS permission denied is explained, and nothing is faked', async ({ page }) => {
  // Playwright cannot make Chromium *deny* geolocation (headless leaves it "prompt" and hangs), so stub the browser API
  // to fail exactly as a denial does (PositionError code 1). Everything above it (DeviceGps, UI) is the real code.
  await page.addInitScript(() => {
    const deny = (_ok: unknown, err: (e: { code: number; message: string }) => void) => err({ code: 1, message: 'User denied Geolocation' });
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: deny, watchPosition: (ok: unknown, err: (e: { code: number; message: string }) => void) => { deny(ok, err); return 1; }, clearWatch: () => {} },
    });
  });
  await installDataset(page);
  await page.getByTestId('locate-me').click();
  await expect(page.getByTestId('loc-error')).toContainText('Izin lokasi ditolak');
  await expect(page.getByTestId('from-label')).toHaveText('Belum dipilih');

  // plan a route by hand and start device navigation: the error is shown, no position is invented
  await pickPlace(page, 'casino', 'Casino de Monte Carlo', 'set-from');
  await pickPlace(page, 'balmoral', 'Balmoral', 'set-to');
  await expect(page.getByTestId('route-summary')).toBeVisible();
  await page.getByTestId('start-nav').click();
  await expect(page.getByTestId('gps-error')).toContainText('Izin lokasi ditolak');
  await expect(page.getByTestId('gps-chip')).toHaveCount(0);
  await page.getByTestId('nav-end').click();
  await expect(page.getByTestId('nav-summary')).toContainText('Navigasi dihentikan');
});

test('a position that stops updating is marked as stale', async ({ page, context }) => {
  await planFromMyLocation(page, context);
  await page.getByTestId('start-nav').click();
  await expect(page.getByTestId('gps-chip')).toContainText('GPS ±6 m');
  // no further position updates: after > 10 s the UI must stop presenting it as current
  await expect(page.getByTestId('gps-chip')).toContainText('Posisi tidak diperbarui', { timeout: 20_000 });
});

test('simulation mode is clearly labelled and drives the whole route to arrival', async ({ page, context }) => {
  const leaked = await guardExternal(context);
  await installDataset(page);
  await context.setOffline(true);
  await pickPlace(page, 'casino', 'Casino de Monte Carlo', 'set-from');
  await pickPlace(page, 'balmoral', 'Balmoral', 'set-to');
  await expect(page.getByTestId('route-summary')).toBeVisible();
  await page.getByTestId('sim-speed').selectOption('5');
  await page.getByTestId('start-sim').click();

  await expect(page.getByTestId('sim-note')).toContainText('bukan posisi asli Anda');
  await expect(page.getByTestId('gps-chip')).toHaveText('Simulasi');
  await expect(page.getByTestId('nav-summary')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('nav-summary')).toContainText('Anda telah tiba');
  expect(leaked).toEqual([]);
});
