// Rasterises the SVG icons into the PNG sizes PWA installers expect.
//   DMAPS_CHROMIUM=/path/to/chromium node scripts/gen_icons.mjs     (or omit it to use Playwright's own browser)
// Output is committed (public/icons/*.png); re-run only when the SVGs change.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'public', 'icons');
const jobs = [
  { svg: 'dmaps-icon.svg', out: 'icon-192.png', size: 192 },
  { svg: 'dmaps-icon.svg', out: 'icon-512.png', size: 512 },
  { svg: 'dmaps-maskable.svg', out: 'maskable-512.png', size: 512 },
  { svg: 'dmaps-maskable.svg', out: 'apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch({ executablePath: process.env.DMAPS_CHROMIUM || undefined, args: ['--no-sandbox'] });
const page = await browser.newPage();
for (const j of jobs) {
  const svg = readFileSync(join(dir, j.svg), 'utf8');
  await page.setViewportSize({ width: j.size, height: j.size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${j.size}px;height:${j.size}px}</style>${svg}`);
  await page.screenshot({ path: join(dir, j.out), omitBackground: true, clip: { x: 0, y: 0, width: j.size, height: j.size } });
  console.log('wrote', j.out);
}
await browser.close();
