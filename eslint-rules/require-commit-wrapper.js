/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require commitToContentRepo() instead of direct writeFiles() calls' },
    messages: {
      useCommitWrapper:
        'Use commitToContentRepo() from src/lib/git/commit.ts instead of calling writeFiles() directly. ' +
        'The wrapper appends system-level trailers (App-Branch). ' +
        'If this is an adapter implementation, add // eslint-disable-next-line with a reason.',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename();

    // Only apply to application code under src/
    if (!filename.match(/src\//)) return {};

    // Exempt the wrapper itself and adapter implementations
    if (filename.match(/src\/lib\/git\/commit\.ts$/)) return {};
    if (filename.match(/src\/lib\/git\/git\.adapter-/)) return {};

    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'writeFiles'
        ) {
          context.report({ node, messageId: 'useCommitWrapper' });
        }
      },
    };
  },
};
