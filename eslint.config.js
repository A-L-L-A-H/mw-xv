import baseConfig from './packages/eslint-config/index.js';

export default [
  ...baseConfig,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      // .mjs files in this workspace are Node.js scripts, CLI tools, and tests.
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Promise: 'readonly',
        fetch: 'readonly',
        globalThis: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Promise: 'readonly',
        fetch: 'readonly',
        globalThis: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },
  {
    files: ['**/*.test.mjs', '**/*.spec.mjs'],
    languageOptions: {
      globals: {
        document: 'readonly',
        KeyboardEvent: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        IS_REACT_ACT_ENVIRONMENT: 'writable',
      },
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/dist-board/**',
      '**/.next*/**',
      '**/node_modules/**',
      '.qoder-tmp/**',
      'services/**',
      'apps/desktop/src-tauri/target/**',
      '.claude/**',
      'vendor/**',
      'pnpm-lock.yaml',
      '.env*',
    ],
  },
];
