/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow hardcoded city or locale string literals' },
    messages: {
      hardcodedCity: "Don't hardcode city name '{{value}}'. Import CITY from src/lib/config/config.ts.",
      hardcodedLocale: "Don't hardcode locale '{{value}}'. Derive from city config locales.",
      cityFallbackDefault: "Don't use '{{value}}' as a fallback default for CITY. A silent default can cause content to be committed to the wrong directory. Make the value required instead.",
    },
  },
  create(context) {
    const CITY_NAMES = ['ottawa', 'montreal', 'toronto', 'vancouver'];
    // Only flag bare locale codes used as standalone strings, not as object keys in i18n files
    const LOCALE_CODES = ['en', 'fr', 'es'];

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        const val = node.value.toLowerCase();

        // Skip import paths and template expressions
        if (node.parent.type === 'ImportDeclaration') return;
        if (node.parent.type === 'ImportExpression') return;

        // Skip object property keys (i18n JSON patterns)
        if (node.parent.type === 'Property' && node.parent.key === node) return;

        // Skip type annotations and enums
        if (node.parent.type === 'TSLiteralType') return;

        // Detect `X || 'ottawa'` or `X ?? 'ottawa'` — a city name used as fallback.
        // This is dangerous because the fallback silently applies when the env var
        // is unset (e.g. in Cloudflare Workers at runtime), causing content to be
        // committed to the wrong directory.
        if (CITY_NAMES.includes(val)) {
          const p = node.parent;
          if (p.type === 'LogicalExpression' && (p.operator === '||' || p.operator === '??') && p.right === node) {
            context.report({ node, messageId: 'cityFallbackDefault', data: { value: node.value } });
            return;
          }
          context.report({ node, messageId: 'hardcodedCity', data: { value: node.value } });
        }
        // Only flag exact matches for locale codes (not substrings)
        if (LOCALE_CODES.includes(val) && node.value.length <= 2) {
          context.report({ node, messageId: 'hardcodedLocale', data: { value: node.value } });
        }
      },
    };
  },
};
