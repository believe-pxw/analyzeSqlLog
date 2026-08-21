import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    worker: 'src/parser/worker.ts',
  },
  format: ['cjs'],
  target: 'node18',
  sourcemap: true,
  dts: false,
  clean: false,
  splitting: false,
  shims: true,
});
