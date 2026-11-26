import { defineConfig } from 'vite';

// Relative base so the built site works from any path (GitHub Pages, IPFS, a USB stick...).
export default defineConfig({ base: './', build: { target: 'es2022', chunkSizeWarningLimit: 1200 } });
