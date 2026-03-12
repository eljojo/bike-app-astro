import { describe, it, expect } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../eslint-rules/no-city-default-param.js';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

describe('no-city-default-param', () => {
  it('flags function parameters that use CITY as a default value', () => {
    expect(() => {
      tester.run('no-city-default-param', rule, {
        valid: [
          // Explicit city argument — fine
          'function getPaths(gpxPath, city) { return city + "/" + gpxPath; }',
          // CITY used in function body — fine (that's the correct pattern)
          'const basePath = `${CITY}/routes/${slug}`;',
          // Default param with a literal — fine (not CITY)
          'function foo(x = "default") {}',
          // CITY used in object — fine
          'const obj = { city: CITY };',
          // Arrow function with non-CITY default — fine
          'const fn = (x = 42) => x;',
        ],
        invalid: [
          {
            // Function declaration with CITY default param
            code: 'function rideFilePathsFromRelPath(gpxRelPath, city = CITY) {}',
            errors: [{ messageId: 'cityDefaultParam' }],
          },
          {
            // Arrow function with CITY default param
            code: 'const getPaths = (path, city = CITY) => {};',
            errors: [{ messageId: 'cityDefaultParam' }],
          },
          {
            // Method-like function expression
            code: 'const obj = { getPaths(path, city = CITY) {} };',
            errors: [{ messageId: 'cityDefaultParam' }],
          },
          {
            // TypeScript-style with type annotation (parsed as JS, type stripped)
            code: 'function foo(gpxRelPath, city = CITY) {}',
            errors: [{ messageId: 'cityDefaultParam' }],
          },
        ],
      });
    }).not.toThrow();
  });
});
