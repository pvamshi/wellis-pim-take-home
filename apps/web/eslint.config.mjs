// Frontend ESLint config.
//
// The repository-wide rules live in the root config and are pulled in by
// reference (tech-stack §4.9). Nothing from that config is restated here — this
// file adds only what is specific to a browser React app built by Vite.

import base from '../../eslint.config.mjs';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  ...base,
  { ignores: ['dist'] },
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
];
