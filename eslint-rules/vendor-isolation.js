/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Restrict platform-specific imports to boundary files' },
    messages: {
      vendorImport: "'{{source}}' can only be imported in {{allowed}}. See src/lib/AGENTS.md.",
    },
  },
  create(context) {
    const VENDOR_RULES = {
      'cloudflare:workers': ['src/lib/env.ts'],
    };

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        const allowed = VENDOR_RULES[source];
        if (!allowed) return;

        const filename = context.filename || context.getFilename();
        const isAllowed = allowed.some(f => filename.endsWith(f));
        if (!isAllowed) {
          context.report({
            node,
            messageId: 'vendorImport',
            data: { source, allowed: allowed.join(', ') },
          });
        }
      },
    };
  },
};
