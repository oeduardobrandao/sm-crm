/** SSR build of the landing's server entry (src/entry-server.tsx), run by
 * scripts/seo/prerender.tsx. It reuses the client config (aliases, plugins, defines such as
 * __BUILD_YEAR__, envDir), so the server bundle sees the same `import.meta.env` and module
 * graph as the browser one. Output goes to node_modules/.cache/landing-ssr, never dist/, and
 * writes no manifest: dist/build-manifest.json is the client's and prerender reads it. */
import path from 'path';
import { defineConfig, mergeConfig, type UserConfig } from 'vite';
import clientConfig from './vite.config';

// scripts/seo/prerender.tsx imports the bundle from here (keep the two in sync).
const LANDING_SSR_OUT_DIR = path.resolve(__dirname, '../../node_modules/.cache/landing-ssr');

export default defineConfig((env) => {
  // vite.config.ts exports a defineConfig callback; mergeConfig only takes plain objects.
  const base =
    typeof clientConfig === 'function'
      ? (clientConfig({ ...env, command: 'build', mode: env.mode || 'production' }) as UserConfig)
      : clientConfig;
  return mergeConfig(base, {
    // public/ is the client's; copying it into the SSR output would only waste time.
    publicDir: false,
    build: {
      ssr: 'src/entry-server.tsx',
      outDir: LANDING_SSR_OUT_DIR,
      manifest: false,
      emptyOutDir: true,
      // Read by Node at prerender time only: no minification, keep stack traces useful.
      minify: false,
      sourcemap: false,
      // One file, no chunks. prerender.tsx runs under tsx, whose loader tags the modules it
      // imports: a chunk's own `import '../entry-server.mjs'` then resolves to a second
      // instance of the entry, with its own React, and every hook throws on a null dispatcher.
      rollupOptions: {
        output: { entryFileNames: 'entry-server.mjs', inlineDynamicImports: true },
      },
    },
    // Bundled deps (React above all) branch on process.env.NODE_ENV at runtime, which Vite
    // leaves alone in SSR builds. Pin it, or the markup would depend on the prerender's shell
    // env (development React locally and in CI, production on Vercel).
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    ssr: {
      // Bundle every dependency: some import CSS (dropped in SSR builds) or ship ESM that
      // Node cannot load bare, and a self-contained bundle makes the server see exactly the
      // module graph the client does.
      noExternal: true,
    },
  } satisfies UserConfig);
});
