import { defineConfig } from 'vite';

export default defineConfig({
  /*
   * Relative asset URLs.
   *
   * A GitHub project page is served from https://<user>.github.io/<repo>/, not
   * the domain root. With Vite's default base of '/', the built index.html asks
   * for /assets/index.js — which resolves to the domain root and 404s, giving a
   * blank page with no obvious cause.
   *
   * './' is used rather than a hardcoded '/<repo>/' so the same build works at
   * the domain root, under any repo name, and from the local filesystem. The app
   * is a single page with no client-side routing, so there's no deep-link case
   * where a relative base would break down.
   */
  base: './',
  build: {
    // three.js is ~550 kB on its own. There are no routes to split along, so the
    // default 500 kB warning is pure noise here.
    chunkSizeWarningLimit: 900,
  },
});
