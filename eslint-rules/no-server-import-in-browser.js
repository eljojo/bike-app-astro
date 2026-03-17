/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow .server module imports from shared/browser code' },
    messages: {
      serverImport:
        "'{{source}}' is a server-only module (.server.ts) and cannot be imported from shared/browser code. Import from the shared module instead, or move this logic server-side.",
    },
  },
  create(context) {
    function checkSource(node, sourceNode) {
      if (!sourceNode) return;
      const source = sourceNode.value;
      if (typeof source !== 'string' || !source.includes('.server')) return;

      const filename = context.filename || context.getFilename();

      // .tsx files are always browser code
      if (filename.endsWith('.tsx')) {
        context.report({ node, messageId: 'serverImport', data: { source } });
        return;
      }

      // Within src/lib/: non-.server .ts files are shared code
      if (filename.includes('/src/lib/') && !filename.includes('.server.') && filename.endsWith('.ts')) {
        context.report({ node, messageId: 'serverImport', data: { source } });
      }
    }

    return {
      ImportDeclaration(node) { checkSource(node, node.source); },
      ExportNamedDeclaration(node) { checkSource(node, node.source); },
      ExportAllDeclaration(node) { checkSource(node, node.source); },
      ImportExpression(node) {
        if (node.source && node.source.type === 'Literal') {
          checkSource(node, node.source);
        }
      },
    };
  },
};
