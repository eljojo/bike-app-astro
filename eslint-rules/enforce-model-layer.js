/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Components may only import types from model files, not runtime functions; must not redefine canonical types locally' },
    messages: {
      runtimeModelImport:
        "Components must only use 'import type' from model files. " +
        'Runtime functions (fromGit, fromCache, buildFresh, etc.) belong in the save pipeline and loaders.',
      duplicateCanonicalType:
        "Don't redefine '{{ name }}' locally — import it from '{{ source }}'.",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename();

    // Only apply to component files
    if (!filename.match(/src\/components\//)) return {};

    // Canonical types and where to import them from.
    // Keys are type names that must not be redefined in components.
    // Values are the canonical import path (for the error message).
    const canonicalTypes = {
      // types/admin.ts
      AdminOrganizer: '@/types/admin',
      RouteOption: '@/types/admin',
      TourSummary: '@/types/admin',
      // models
      RouteDetail: '@/lib/models/route-model',
      AdminMediaItem: '@/lib/models/route-model',
      AdminVariant: '@/lib/models/route-model',
      EventDetail: '@/lib/models/event-model',
      EventWaypoint: '@/lib/models/event-model',
      EventResult: '@/lib/models/event-model',
      EventRegistration: '@/lib/models/event-model',
      EventOrganizerRef: '@/lib/models/event-model',
      RideDetail: '@/lib/models/ride-model',
      RideMediaItem: '@/lib/models/ride-model',
      PlaceDetail: '@/lib/models/place-model',
      BaseMediaItem: '@/lib/models/content-model',
      // Previous aliases that should not resurface
      OrganizerData: '@/types/admin (as AdminOrganizer)',
      OrganizerPayload: '@/types/admin (as AdminOrganizer)',
      TourInfo: '@/types/admin (as TourSummary)',
    };

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        // Only check imports from model files
        if (!source.match(/\/models\/(route|event|place|ride|content)-model/)) return;

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

      // Flag local interface/type declarations that shadow canonical types
      TSInterfaceDeclaration(node) {
        const name = node.id.name;
        if (name in canonicalTypes) {
          context.report({
            node: node.id,
            messageId: 'duplicateCanonicalType',
            data: { name, source: canonicalTypes[name] },
          });
        }
      },
      TSTypeAliasDeclaration(node) {
        const name = node.id.name;
        if (name in canonicalTypes) {
          context.report({
            node: node.id,
            messageId: 'duplicateCanonicalType',
            data: { name, source: canonicalTypes[name] },
          });
        }
      },
    };
  },
};
