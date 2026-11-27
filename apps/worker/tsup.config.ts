import { defineConfig } from 'tsup';

// Workspace packages export TypeScript source, so bundle them into the app. Everything else stays an
// import resolved from node_modules at runtime (the Docker image installs production dependencies
// hoisted): third-party CommonJS bundled into ESM output fails on its first require() of a Node
// built-in ("Dynamic require of "assert" is not supported"), and native modules like sharp can't be
// bundled at all.
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  noExternal: [/^@tricity\//],
  skipNodeModulesBundle: true,
});
