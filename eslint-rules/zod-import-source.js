/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Enforce importing Zod from zod/v4' },
    messages: {
      wrongZodImport: "Import from 'zod/v4' instead of '{{source}}'. This project uses Zod v4.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (source === 'zod' || source === 'astro/zod' || source === 'astro:content') {
          // Only flag if importing z or zod symbols
          const hasZodImport = node.specifiers.some(s =>
            (s.type === 'ImportSpecifier' && s.imported.name === 'z') ||
            s.type === 'ImportNamespaceSpecifier'
          );
          if (source === 'zod' || source === 'astro/zod' || hasZodImport) {
            context.report({ node, messageId: 'wrongZodImport', data: { source } });
          }
        }
      },
    };
  },
};
