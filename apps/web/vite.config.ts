import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  // The repo keeps one .env at the workspace root.
  const rootDir = resolve(process.cwd(), '../..');
  const env = loadEnv(mode, rootDir, 'VITE_');

  // A build that shipped the service-role key would leak it to every visitor,
  // so fail the build rather than warn. The API performs the same check.
  for (const [key, value] of Object.entries(env)) {
    if (/service[_-]?role/i.test(String(value))) {
      throw new Error(`${key} looks like a service-role key. It must never reach the browser.`);
    }
  }

  return {
    plugins: [react()],
    envDir: rootDir,
    server: { port: 5173, strictPort: true },
    build: { outDir: 'dist', sourcemap: mode !== 'production' },
  };
});
