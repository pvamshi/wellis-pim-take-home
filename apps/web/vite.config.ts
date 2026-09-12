import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vite loads .env files from the package root, which here is apps/web. The
  // single .env this repository documents lives at the repository root, so
  // without this VITE_API_BASE_URL would be silently ignored. `__dirname` is
  // not defined — this package is "type": "module", so the config is ESM.
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
});
