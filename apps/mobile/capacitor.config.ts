import type { CapacitorConfig } from '@capacitor/cli';

// The app loads the live CRM instead of a bundled build (DECISIONS.md D3), so every
// web deploy reaches installed apps without an App Store release. `www/` only holds
// the offline page shown when the site cannot load.
//
// MESAAS_APP_URL lets a developer point a Simulator build at a local or staging CRM
// (e.g. http://localhost:5173). Release builds must be synced without it.
const appUrl = process.env.MESAAS_APP_URL ?? 'https://www.mesaas.com.br';
const appHost = new URL(appUrl).host;

const config: CapacitorConfig = {
  appId: 'br.com.mesaas.app',
  appName: 'Mesaas',
  webDir: 'www',
  server: {
    url: `${appUrl}/dashboard`,
    errorPath: 'offline.html',
    cleartext: appUrl.startsWith('http://'),
    // Only our own origin renders inside the app. Everything else (Instagram
    // permalinks, help links, Meta/TikTok OAuth) opens outside the web view.
    allowNavigation: [appHost],
  },
  ios: {
    // The CRM already pads itself with env(safe-area-inset-*) (viewport-fit=cover).
    contentInset: 'never',
  },
};

export default config;
