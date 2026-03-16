/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow hardcoded city or locale string literals' },
    schema: [
      {
        type: 'object',
        properties: {
          checkLocales: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      hardcodedCity: "Don't hardcode city name '{{value}}'. Import CITY from src/lib/config/config.ts.",
      hardcodedLocale: "Don't hardcode locale '{{value}}'. Derive from city config locales.",
      cityFallbackDefault: "Don't use '{{value}}' as a fallback default for CITY. A silent default can cause content to be committed to the wrong directory. Make the value required instead.",
    },
  },
  create(context) {
    const CITY_NAMES = ['ottawa', 'montreal', 'toronto', 'vancouver', 'demo'];
    // Only flag bare locale codes used as standalone strings, not as object keys in i18n files
    const LOCALE_CODES = ['en', 'fr', 'es'];
    const options = context.options[0] || {};
    const checkLocales = options.checkLocales !== false; // default true

    /** Check a string value for hardcoded city/locale and report on the given node. */
    function checkStringValue(node, val, { skipFallbackCheck = false } = {}) {
      const lower = val.toLowerCase();
      const matchedCity = CITY_NAMES.find(c => lower === c || lower.startsWith(c + '/'));
      if (matchedCity) {
        if (!skipFallbackCheck) {
          const p = node.parent;
          if (p.type === 'LogicalExpression' && (p.operator === '||' || p.operator === '??') && p.right === node) {
            context.report({ node, messageId: 'cityFallbackDefault', data: { value: matchedCity } });
            return;
          }
        }
        context.report({ node, messageId: 'hardcodedCity', data: { value: matchedCity } });
      }
      if (checkLocales && LOCALE_CODES.includes(lower) && val.length <= 2) {
        context.report({ node, messageId: 'hardcodedLocale', data: { value: val } });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;

        // Skip import paths and template expressions
        if (node.parent.type === 'ImportDeclaration') return;
        if (node.parent.type === 'ImportExpression') return;

        // Skip object property keys (i18n JSON patterns)
        if (node.parent.type === 'Property' && node.parent.key === node) return;

        // Skip type annotations and enums
        if (node.parent.type === 'TSLiteralType') return;

        checkStringValue(node, node.value);
      },

      TemplateLiteral(node) {
        // Check each static segment of a template literal for city names.
        // e.g. `ottawa/${key}` has quasis[0].value.raw === 'ottawa/'
        for (const quasi of node.quasis) {
          const raw = quasi.value.raw;
          if (!raw) continue;
          const lower = raw.toLowerCase();
          const matchedCity = CITY_NAMES.find(c =>
            lower === c || lower.startsWith(c + '/') || lower.endsWith('/' + c) ||
            lower.includes('/' + c + '/'),
          );
          if (matchedCity) {
            context.report({ node, messageId: 'hardcodedCity', data: { value: matchedCity } });
          }
        }
      },
    };
  },
};
