/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require explicit prerender export in page/API files' },
    messages: {
      missingPrerender: 'Files in src/views/ and src/pages/ must export `prerender` (true or false).',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    // Only apply to .ts files in src/views/ and src/pages/ (not .astro — those are handled differently)
    if (!filename.match(/src\/(views|pages)\/.*\.ts$/)) return {};

    let hasPrerender = false;
    let hasRouteHandler = false;
    const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL'];

    return {
      ExportNamedDeclaration(node) {
        if (node.declaration?.type === 'VariableDeclaration') {
          for (const decl of node.declaration.declarations) {
            if (decl.id?.type === 'Identifier' && decl.id.name === 'prerender') {
              hasPrerender = true;
            }
          }
        }
        if (node.declaration?.type === 'FunctionDeclaration') {
          if (node.declaration.id && HTTP_METHODS.includes(node.declaration.id.name)) {
            hasRouteHandler = true;
          }
        }
        if (node.declaration?.type === 'VariableDeclaration') {
          for (const decl of node.declaration.declarations) {
            if (decl.id?.type === 'Identifier' && HTTP_METHODS.includes(decl.id.name)) {
              hasRouteHandler = true;
            }
          }
        }
      },
      'Program:exit'(node) {
        // Only require prerender if the file exports an HTTP route handler
        if (!hasPrerender && hasRouteHandler) {
          context.report({ node, messageId: 'missingPrerender' });
        }
      },
    };
  },
};
