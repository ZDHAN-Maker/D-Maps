import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { initI18n, savedLanguage } from './i18n';
import App from './App';

// App shell is precached by the service worker so the app starts with no network.
// Map data is NOT in this cache: it lives in IndexedDB (src/storage).
registerSW({ immediate: true });

const lang = savedLanguage();
document.documentElement.lang = lang;

void initI18n(lang).then(() => {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
