import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@finance-flow/types': fileURLToPath(
        new URL('../../packages/types/src/index.ts', import.meta.url),
      ),
      '@finance-flow/validation': fileURLToPath(
        new URL('../../packages/validation/src/index.ts', import.meta.url),
      ),
    },
  },
  envDir: '../..',
  server: { port: 5173, strictPort: true },
  test: { environment: 'jsdom', clearMocks: true },
});
