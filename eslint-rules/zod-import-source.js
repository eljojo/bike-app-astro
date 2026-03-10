/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Enforce importing Zod from astro/zod' },
    messages: {
      wrongZodImport: "Import from 'astro/zod' instead of '{{source}}'. This project uses Zod v4 via Astro.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (source === 'zod' || source === 'astro:content') {
          // Only flag if importing z or zod symbols
          const hasZodImport = node.specifiers.some(s =>
            (s.type === 'ImportSpecifier' && s.imported.name === 'z') ||
            s.type === 'ImportNamespaceSpecifier'
          );
          if (source === 'zod' || hasZodImport) {
            context.report({ node, messageId: 'wrongZodImport', data: { source } });
          }
        }
      },
    };
  },
};
