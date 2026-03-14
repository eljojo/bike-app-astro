/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow using CITY as a default parameter value' },
    messages: {
      cityDefaultParam:
        "Don't use CITY as a default parameter. Pass it explicitly at call sites so the dependency is visible.",
    },
  },
  create(context) {
    return {
      AssignmentPattern(node) {
        // Only flag when it's a function parameter default, not a destructuring default
        if (
          node.parent.type !== 'FunctionDeclaration' &&
          node.parent.type !== 'FunctionExpression' &&
          node.parent.type !== 'ArrowFunctionExpression'
        ) return;

        // Check if the default value is the identifier CITY
        if (node.right.type === 'Identifier' && node.right.name === 'CITY') {
          context.report({ node: node.right, messageId: 'cityDefaultParam' });
        }
      },
    };
  },
};
