import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { installDataset, openTab, pickPlace } from './helpers';

/**
 * Automated accessibility audit (axe-core, WCAG 2.0/2.1 A + AA rules) of every screen, in both themes.
 * This catches roughly the machine-detectable subset of WCAG issues (missing names, contrast, ARIA misuse).
 * It does NOT replace manual keyboard/screen-reader testing, which has not been done.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => ({
    rule: v.id, impact: v.impact, count: v.nodes.length,
    targets: v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} :: ${(n.failureSummary ?? '').split('\n').slice(0, 2).join(' | ')}`),
  }));
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

async function planRoute(page: Page) {
  await pickPlace(page, 'casino', 'Casino de Monte Carlo', 'set-from');
  await pickPlace(page, 'balmoral', 'Balmoral', 'set-to');
  await expect(page.getByTestId('route-summary')).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) {
  test(`axe: every screen, ${theme} theme`, async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'settings');
    await page.getByTestId(`theme-${theme}`).click();
    await openTab(page, 'map');
    await audit(page, `map without data (${theme})`);

    await installDataset(page);
    await audit(page, `map with data (${theme})`);

    await planRoute(page);
    await audit(page, `map with route and steps (${theme})`);

    await openTab(page, 'regions');
    await expect(page.getByTestId('status-monaco')).toBeVisible();
    await audit(page, `regions manager (${theme})`);

    await openTab(page, 'settings');
    await audit(page, `settings (${theme})`);

    await openTab(page, 'about');
    await audit(page, `about (${theme})`);

    await openTab(page, 'map');
    await page.getByTestId('sim-speed').selectOption('1');
    await page.getByTestId('start-sim').click();
    await expect(page.getByTestId('nav-view')).toBeVisible();
    await audit(page, `navigation view (${theme})`);
  });
}

test('harness control: axe really flags violations and really inspects the page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('net-status')).toBeVisible();
  const clean = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(clean.violations).toEqual([]);
  expect(clean.passes.length, 'axe should have evaluated many rules on the real page').toBeGreaterThan(10);

  // Inject two known WCAG failures: an unnamed button and low-contrast text.
  await page.evaluate(() => {
    const box = document.createElement('div');
    box.innerHTML = '<button id="bad-btn"></button><p id="bad-contrast" style="color:#c8c8c8;background:#ffffff">faint text</p>';
    document.body.appendChild(box);
  });
  const bad = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const ids = bad.violations.map((v) => v.id);
  expect(ids).toContain('button-name');
  expect(ids).toContain('color-contrast');
});
