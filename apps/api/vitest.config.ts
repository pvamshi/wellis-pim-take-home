import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // Vitest's default esbuild transform cannot emit decorator metadata, and
    // without it Nest's dependency injection cannot resolve constructor types.
    // The SWC options live here rather than in a .swcrc so there is one place
    // to look.
    swc.vite({
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
  ],
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['reflect-metadata'],
    include: ['test/**/*.spec.ts'],
  },
});
