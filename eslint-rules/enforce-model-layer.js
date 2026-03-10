/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Components may only import types from model files, not runtime functions' },
    messages: {
      runtimeModelImport:
        "Components must only use 'import type' from model files. " +
        'Runtime functions (fromGit, fromCache, buildFresh, etc.) belong in the save pipeline and loaders.',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename();

    // Only apply to component files
    if (!filename.match(/src\/components\//)) return {};

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        // Only check imports from model files
        if (!source.match(/\/models\/(route|event|place)-model/)) return;

        // Check that ALL specifiers are type-only imports
        const hasRuntimeImport = node.specifiers.some(s => {
          // `import type { Foo }` — the whole declaration is type-only
          if (node.importKind === 'type') return false;
          // `import { type Foo }` — individual specifier is type-only
          if (s.type === 'ImportSpecifier' && s.importKind === 'type') return false;
          // Namespace or default imports, or value specifiers
          return true;
        });

        if (hasRuntimeImport) {
          context.report({ node, messageId: 'runtimeModelImport' });
        }
      },
    };
  },
};
