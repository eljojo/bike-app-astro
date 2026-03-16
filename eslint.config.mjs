import tseslint from 'typescript-eslint';
import noHardcodedCityLocale from './eslint-rules/no-hardcoded-city-locale.js';
import requirePrerenderExport from './eslint-rules/require-prerender-export.js';
import vendorIsolation from './eslint-rules/vendor-isolation.js';
import zodImportSource from './eslint-rules/zod-import-source.js';
import requireAuthorizeCall from './eslint-rules/require-authorize-call.js';
import enforceModelLayer from './eslint-rules/enforce-model-layer.js';
import noCityDefaultParam from './eslint-rules/no-city-default-param.js';
import requireCommitWrapper from './eslint-rules/require-commit-wrapper.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/**/*.d.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'bike-app': {
        rules: {
          'no-hardcoded-city-locale': noHardcodedCityLocale,
          'require-prerender-export': requirePrerenderExport,
          'vendor-isolation': vendorIsolation,
          'zod-import-source': zodImportSource,
          'require-authorize-call': requireAuthorizeCall,
          'enforce-model-layer': enforceModelLayer,
          'no-city-default-param': noCityDefaultParam,
          'require-commit-wrapper': requireCommitWrapper,
        },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'bike-app/no-hardcoded-city-locale': 'error',
      'bike-app/require-prerender-export': 'error',
      'bike-app/vendor-isolation': 'error',
      'bike-app/zod-import-source': 'error',
      'bike-app/require-authorize-call': 'error',
      'bike-app/enforce-model-layer': 'error',
      'bike-app/no-city-default-param': 'error',
      'bike-app/require-commit-wrapper': 'error',
    },
  },
  {
    // content.config.ts runs at build time only — locale-adjacent strings are OK
    files: ['src/content.config.ts'],
    rules: {
      'bike-app/no-hardcoded-city-locale': 'off',
    },
  },
  {
    // Test files get no-hardcoded-city-locale for city names only — assertions
    // must derive CITY from imports, not hardcode 'ottawa' (CI runs CITY=demo).
    // Locale codes ('en', 'fr') are OK in tests since i18n tests need them.
    files: ['tests/**/*.ts', 'e2e/**/*.ts'],
    plugins: {
      'bike-app': {
        rules: {
          'no-hardcoded-city-locale': noHardcodedCityLocale,
        },
      },
    },
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      'bike-app/no-hardcoded-city-locale': ['error', { checkLocales: false }],
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
