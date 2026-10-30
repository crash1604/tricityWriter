import { defineConfig } from 'tsup';

// Workspace packages export TypeScript source, so bundle them into the app.
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  noExternal: [/^@tricity\//],
});
