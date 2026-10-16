import { expect, test } from '@playwright/test';

test('web app manifest is installable-shaped and every declared icon is actually served', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = await (await request.get(href as string)).json();

  expect(manifest.name).toBe("D'Maps");
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  expect(manifest.lang).toBe('id');

  const sizes = (manifest.icons as { sizes: string; purpose?: string }[]).map((i) => `${i.sizes}:${i.purpose ?? 'any'}`);
  expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));

  for (const icon of manifest.icons as { src: string; type: string }[]) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()['content-type'], icon.src).toContain(icon.type);
  }
  const apple = await request.get('/icons/apple-touch-icon.png');
  expect(apple.status()).toBe(200);
});

test('the service worker precaches the app shell but not the map datasets', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
    return urls;
  });
  expect(cached.some((u) => u.endsWith('.js'))).toBe(true);
  expect(cached.some((u) => u.endsWith('index.html') || u === '/')).toBe(true);
  expect(cached.filter((u) => u.startsWith('/data/')), 'datasets belong in IndexedDB, not the shell cache').toEqual([]);
});
