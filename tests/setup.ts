import 'fake-indexeddb/auto';
// Test guard: any accidental remote network call from code under test fails loudly.
// Local resources (relative URLs / file paths) are allowed; http(s) absolute URLs are not.
import { beforeEach, vi } from 'vitest';

beforeEach(() => {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/^https?:\/\//i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url)) {
      throw new Error(`Blocked remote request in test: ${url}`);
    }
    return realFetch(input, init);
  });
});
