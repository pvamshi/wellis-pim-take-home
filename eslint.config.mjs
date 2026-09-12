// Shared ESLint flat config for the whole repository.
//
// Each app extends this by reference — `import base from '../../eslint.config.mjs'`
// — and adds only its own globals and plugins. No app re-declares these rules,
// and eslint, @eslint/js, typescript-eslint, eslint-config-prettier and prettier
// stay hoisted to the root package.json.
//
// The type-checked presets (recommendedTypeChecked / strictTypeChecked) are
// deliberately not used: they need per-app `parserOptions.project` plumbing that
// the scaffold does not need.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules',
      'dist',
      'build',
      'coverage',
      '.vite',
      'legacy_export',
      'apps/*/dist',
      // The committed workflow scripts run under the workflow runner, which
      // injects `agent`, `log`, `phase` and `pipeline`. They are not plain Node
      // modules and declaring those runner globals here is not the root config's
      // job. TODO: decide who owns linting .claude/workflows/*.js.
      '.claude',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Last, so it switches off every formatting rule that would fight Prettier.
  prettier,
];
