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
    // The apex 308-redirects to www; listing it keeps absolute apex links in the app.
    allowNavigation: [appHost, 'mesaas.com.br'],
  },
  ios: {
    // The CRM already pads itself with env(safe-area-inset-*) (viewport-fit=cover).
    contentInset: 'never',
  },
  plugins: {
    SplashScreen: {
      // The remote CRM needs a moment on cold start. The CRM hides the splash at
      // first paint once it ships the native module; this is the fallback for
      // older web builds that don't call SplashScreen.hide().
      launchAutoHide: true,
      launchShowDuration: 1500,
      launchFadeOutDuration: 200,
      showSpinner: false,
    },
    Keyboard: {
      // Shrink the web view above the keyboard so composers and inputs stay visible.
      resize: 'native',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
