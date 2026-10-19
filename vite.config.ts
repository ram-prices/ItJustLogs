import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** The app's top-level pages; each gets its own copy of index.html in the build. */
const PAGES = ['operators', 'arsenal', 'stats', 'settings'];

/**
 * GitHub Pages only serves files, so clean paths like /operators need a file
 * there: copy index.html into a folder per page. Deeper paths
 * (/operators/<poolId>) fall back to 404.html, which is the same app.
 */
function pageCopies(): Plugin {
  let outDir = 'dist';
  return {
    name: 'page-copies',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const index = join(outDir, 'index.html');
      for (const page of PAGES) {
        mkdirSync(join(outDir, page), { recursive: true });
        copyFileSync(index, join(outDir, page, 'index.html'));
      }
      copyFileSync(index, join(outDir, '404.html'));
    },
  };
}

export default defineConfig({
  // Absolute asset paths: pages live at /operators/ etc., and the site is
  // served from the root of its own domain (itjustlogs.dev).
  base: '/',
  plugins: [pageCopies()],
  server: {
    port: 5173,
    strictPort: true,
    // fixtures/ holds real pull history; never serve it (the dev server may be reachable from the LAN).
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/fixtures/**'] },
  },
});
