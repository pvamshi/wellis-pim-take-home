// The api extends the shared root config by reference and re-declares none of
// its rules. eslint, @eslint/js, typescript-eslint, eslint-config-prettier and
// globals all stay hoisted in the root package.json.

import globals from 'globals';
import base from '../../eslint.config.mjs';

export default [
  ...base,
  {
    ignores: ['dist'],
  },
  {
    // The plain config files at the root of this workspace run under Node.
    files: ['eslint.config.mjs', 'vitest.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
];
