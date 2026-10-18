import { expect, test } from '@playwright/test';
import { canvasInkPixels, guardExternal, installDataset, isLocal, openTab, pickPlace, setLanguage, waitForServiceWorker } from './helpers';

/**
 * Offline acceptance for the proof of concept (dataset: Monaco test fixture, NOT Indonesia).
 * Proves, in a real browser: install into IndexedDB -> go offline -> reload -> map draws ->
 * search works -> route + instructions work -> nothing ever touched a non-local origin.
 * GPS and navigation: see navigation.spec.ts. Not covered yet: cache upgrades, real hardware GPS.
 */

test('install -> offline reload -> search -> route, with zero external requests', async ({ page, context }) => {
  const leaked = await guardExternal(context);
  await installDataset(page);

  // The service worker must be active so the app shell can start without a network.
  await waitForServiceWorker(page);

  // --- network off, cold reload ---
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('net-status')).toContainText('Offline');
  await expect(page.getByTestId('data-status')).toContainText('Terpasang: Monaco');
  await expect.poll(() => canvasInkPixels(page), { message: 'map canvas should contain drawn features' }).toBeGreaterThan(1000);

  // --- from here on, search and routing must not cause ANY network request, even to localhost ---
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));

  await pickPlace(page, 'casino', 'Casino de Monte Carlo', 'set-from');
  await expect(page.getByTestId('from-label')).toHaveText('Casino de Monte Carlo');
  await pickPlace(page, 'balmoral', 'Balmoral', 'set-to');
  await expect(page.getByTestId('to-label')).toHaveText('Balmoral');

  await expect(page.getByTestId('route-summary')).toBeVisible();
  const steps = page.getByTestId('step-item');
  expect(await steps.count()).toBeGreaterThanOrEqual(2);
  await expect(steps.first()).toContainText('Mulai berkendara');
  await expect(steps.last()).toContainText('Anda telah tiba di tujuan');

  expect(requests, 'search + routing must be fully local').toEqual([]);

  // instructions follow the selected language. Opening Settings loads its (precached) code chunk, so
  // from here the only requests allowed are same-origin JS chunks served by the service worker.
  await setLanguage(page, 'en');
  await expect(steps.last()).toContainText('You have arrived at your destination');
  await setLanguage(page, 'id');

  // a place that is not in the downloaded data gets an honest message, not a guess
  await page.getByTestId('search-input').fill('zzzqqq tempat fiktif');
  await expect(page.getByTestId('no-results')).toContainText('Tidak ditemukan di data yang sudah diunduh');

  // the route layer is drawn on the map
  expect(await canvasInkPixels(page)).toBeGreaterThan(1000);

  expect(requests.every((u) => /^\/assets\/[\w.-]+\.js$/.test(new URL(u).pathname) && isLocal(u)),
    `unexpected requests while switching tabs offline: ${requests.join(', ')}`).toBe(true);
  expect(leaked, 'no request may leave localhost').toEqual([]);
});

test('category browsing and map-tap selection work offline', async ({ page, context }) => {
  const leaked = await guardExternal(context);
  await installDataset(page);
  await context.setOffline(true);

  // hospitals mapped without an emergency department are flagged, so nobody is sent there in an emergency
  await page.getByRole('button', { name: 'Rumah sakit', exact: true }).click();
  await expect(page.getByTestId('result-item').filter({ hasText: 'Farmacy des Anglais' })).toContainText('tanpa IGD menurut OSM');
  await page.getByRole('button', { name: 'Rumah sakit', exact: true }).click(); // toggle off

  await page.getByRole('button', { name: 'Apotek', exact: true }).click();
  const first = page.getByTestId('result-item').first();
  await expect(first).toBeVisible();
  await expect(first).toContainText('dari pusat peta'); // distance shown relative to map centre

  const box = await page.getByTestId('map').boundingBox();
  if (!box) throw new Error('map has no bounding box');
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await expect(page.getByTestId('from-label')).toContainText('Titik di peta');
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.45);
  await expect(page.getByTestId('to-label')).toContainText('Titik di peta');
  // a tapped point may or may not snap to a road: either outcome must be explained, never blank
  await expect(page.getByTestId('route-summary').or(page.getByTestId('route-error'))).toBeVisible();

  expect(leaked).toEqual([]);
});

test('without data: features are disabled and the UI says so', async ({ page, context }) => {
  const leaked = await guardExternal(context);
  await page.goto('/');
  await expect(page.getByTestId('data-status')).toContainText('Belum ada data peta');
  await expect(page.getByTestId('search-input')).toBeDisabled();
  await expect(page.getByTestId('no-results')).toHaveCount(0);
  expect(leaked).toEqual([]);
});

test('a failed download is reported, offers retry, and leaves search disabled', async ({ page }) => {
  await page.route('**/data/monaco/graph.bin*', (route) => route.abort('failed'));
  await page.goto('/');
  await openTab(page, 'regions');
  await page.getByTestId('dl-monaco').click();
  await expect(page.getByTestId('status-monaco')).toContainText('Gagal: Unduhan gagal');
  await expect(page.getByTestId('retry-monaco')).toBeVisible();
  await openTab(page, 'map');
  await expect(page.getByTestId('search-input')).toBeDisabled();
});

test('a corrupt download is rejected by the checksum', async ({ page }) => {
  await page.route('**/data/monaco/graph.bin*', async (route) => {
    const res = await route.fetch();
    const body = await res.body();
    const bad = Buffer.from(body);
    bad[100] ^= 0xff; // same size, one flipped byte: only the SHA-256 can catch this
    await route.fulfill({ response: res, body: bad });
  });
  await page.goto('/');
  await openTab(page, 'regions');
  await page.getByTestId('dl-monaco').click();
  await expect(page.getByTestId('status-monaco')).toContainText('rusak atau tidak cocok dengan checksum');
  await openTab(page, 'map');
  await expect(page.getByTestId('search-input')).toBeDisabled();
});

test.describe('harness control', () => {
  // Proves the offline assertions above are meaningful: with the service worker blocked, the app
  // shell is NOT available offline, so a reload must fail. If this ever "passes" offline, the main test proves nothing.
  test.use({ serviceWorkers: 'block' });
  test('without a service worker an offline reload fails', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByTestId('data-status')).toBeVisible();
    await context.setOffline(true);
    await expect(page.reload()).rejects.toThrow(/ERR_INTERNET_DISCONNECTED|net::/);
  });
});
