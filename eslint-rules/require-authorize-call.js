/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require authorize() call in API handlers outside /api/auth/' },
    messages: {
      missingAuthorize:
        'API handler exports GET/POST without calling authorize(). ' +
        'Add authorize(locals, action) or saveContent() (which calls it internally). ' +
        'If this endpoint is intentionally public, add // eslint-disable-next-line with a reason.',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename();

    // Only apply to src/pages/api/ (not src/pages/api/auth/ which is intentionally public)
    if (!filename.match(/src\/pages\/api\//) || filename.match(/src\/pages\/api\/auth\//)) return {};

    let hasAuthorize = false;
    let hasRouteHandler = false;
    const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL'];

    return {
      // Detect authorize() or saveContent() calls anywhere in the file
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && (node.callee.name === 'authorize' || node.callee.name === 'saveContent')) {
          hasAuthorize = true;
        }
      },
      ExportNamedDeclaration(node) {
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
        if (hasRouteHandler && !hasAuthorize) {
          context.report({ node, messageId: 'missingAuthorize' });
        }
      },
    };
  },
};
