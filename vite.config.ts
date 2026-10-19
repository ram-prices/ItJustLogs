import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any GitHub Pages sub-path.
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    // fixtures/ holds real pull history; never serve it (the dev server may be reachable from the LAN).
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/fixtures/**'] },
  },
});
