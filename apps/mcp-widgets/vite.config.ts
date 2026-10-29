import path from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build: every byte of JS and CSS inlined into index.html, so the card makes no
// network request of its own (the resource declares connectDomains: []). dev.html is only for
// `vite` dev serving and is not a build input. scripts/build-mcp-widgets.ts turns the output
// into supabase/functions/mcp/ui/generated/cards-v1.ts.
// zod 4 re-exports every locale as a namespace (`export * as locales`), and the sdk's
// `import * as z` keeps that namespace alive: ~40 unused locales, a third of the bundle.
// Only `en` is ever applied (classic/external.js calls config(en())), so zod's own
// locales index resolves to just `en` here. Build-only; tests and the server use plain zod.
const ZOD_LOCALES_STUB = '\0mcp-widgets:zod-locales';
function zodEnglishOnly(): Plugin {
  const enPath = createRequire(import.meta.url).resolve('zod/v4/locales/en.js');
  return {
    name: 'mcp-widgets:zod-english-only',
    enforce: 'pre',
    resolveId(source, importer) {
      if (
        source === '../locales/index.js' &&
        importer &&
        /[\\/]node_modules[\\/]zod[\\/]/.test(importer)
      ) {
        return ZOD_LOCALES_STUB;
      }
      return null;
    },
    load(id) {
      return id === ZOD_LOCALES_STUB
        ? `export { default as en } from ${JSON.stringify(enPath)};`
        : null;
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname),
  publicDir: false,
  plugins: [zodEnglishOnly(), react(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    outDir: path.resolve(__dirname, '../../node_modules/.cache/mcp-widgets'),
    emptyOutDir: true,
    target: 'es2021',
    reportCompressedSize: false,
    rollupOptions: { input: path.resolve(__dirname, 'index.html') },
  },
});
