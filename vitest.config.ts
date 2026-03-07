import { defineConfig } from 'vitest/config';
import { buildDataPlugin } from './src/build-data-plugin';

export default defineConfig({
  plugins: [buildDataPlugin()],
  test: {
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
