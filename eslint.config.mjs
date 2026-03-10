import tseslint from 'typescript-eslint';
import noHardcodedCityLocale from './eslint-rules/no-hardcoded-city-locale.js';
import requirePrerenderExport from './eslint-rules/require-prerender-export.js';
import vendorIsolation from './eslint-rules/vendor-isolation.js';
import zodImportSource from './eslint-rules/zod-import-source.js';
import requireAuthorizeCall from './eslint-rules/require-authorize-call.js';
import enforceModelLayer from './eslint-rules/enforce-model-layer.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/**/*.d.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      'bike-app': {
        rules: {
          'no-hardcoded-city-locale': noHardcodedCityLocale,
          'require-prerender-export': requirePrerenderExport,
          'vendor-isolation': vendorIsolation,
          'zod-import-source': zodImportSource,
          'require-authorize-call': requireAuthorizeCall,
          'enforce-model-layer': enforceModelLayer,
        },
      },
    },
    rules: {
      'bike-app/no-hardcoded-city-locale': 'error',
      'bike-app/require-prerender-export': 'error',
      'bike-app/vendor-isolation': 'error',
      'bike-app/zod-import-source': 'warn',
      'bike-app/require-authorize-call': 'error',
      'bike-app/enforce-model-layer': 'error',
    },
  },
  {
    // Config files define the defaults — they must use literal city/locale values
    files: ['src/lib/config.ts', 'src/content.config.ts'],
    rules: {
      'bike-app/no-hardcoded-city-locale': 'off',
    },
  },
  {
    // Exclude test files and config files from most rules
    files: ['tests/**/*.ts', 'e2e/**/*.ts', '*.config.*'],
    rules: {
      'bike-app/no-hardcoded-city-locale': 'off',
      'bike-app/require-prerender-export': 'off',
    },
  },
  {
    // i18n and integration files legitimately use locale strings as fallbacks
    files: ['src/i18n/**/*.ts', 'src/integrations/**/*.ts'],
    rules: {
      'bike-app/no-hardcoded-city-locale': 'off',
    },
  },
];
