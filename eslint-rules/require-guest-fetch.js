/**
 * Require fetchWithGuest() for anonymous-contribution writes.
 *
 * The 2026-05 "Unauthorized dead-end" class happened when a client island
 * POSTed to a contribution endpoint with a raw fetch(): an anonymous visitor
 * got a bare 401 and no way forward. fetchWithGuest() (src/lib/guest-fetch.ts)
 * bootstraps a guest session on 401 and retries, so the contribution lands.
 *
 * Literal-based, no type-aware analysis. Flags a raw `fetch()` whose first
 * argument is a string/template literal starting with '/api/' AND whose options
 * object declares a mutating method (POST/PUT/PATCH/DELETE). Reads (no options,
 * or method GET/HEAD) can't dead-end a contributor, so they're skipped. Dynamic
 * URLs or dynamic options it can't statically see are fine to miss.
 *
 * Escape hatch: some /api/ writes are authenticated-only (admin/auth/settings)
 * where a 401 must go to /login, not mint a guest. Those add an
 * eslint-disable comment with a justification.
 */
const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function urlPrefix(arg) {
  if (!arg) return null;
  if (arg.type === 'Literal' && typeof arg.value === 'string') return arg.value;
  if (arg.type === 'TemplateLiteral' && arg.quasis.length > 0) {
    return arg.quasis[0].value.cooked ?? arg.quasis[0].value.raw;
  }
  return null;
}

function isMutatingOptions(arg) {
  if (!arg || arg.type !== 'ObjectExpression') return false;
  for (const prop of arg.properties) {
    if (prop.type !== 'Property' || prop.computed) continue;
    const key = prop.key;
    const isMethod =
      (key.type === 'Identifier' && key.name === 'method') ||
      (key.type === 'Literal' && key.value === 'method');
    if (!isMethod) continue;
    // Only a statically-known mutating verb flags; a dynamic method is skipped.
    if (prop.value.type === 'Literal' && typeof prop.value.value === 'string') {
      return MUTATING_METHODS.includes(prop.value.value.toUpperCase());
    }
    return false;
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require fetchWithGuest() for anonymous-contribution writes to /api/' },
    messages: {
      useGuestFetch:
        "Raw fetch() to '{{url}}' can dead-end anonymous users on 401. Use fetchWithGuest " +
        'from src/lib/guest-fetch.ts, which bootstraps a guest session and retries. If this ' +
        'endpoint is authenticated-only (a 401 must go to /login, not mint a guest), add ' +
        '// eslint-disable-next-line bike-app/require-guest-fetch with a justification.',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    // The helper itself performs the raw guest-bootstrap fetch.
    if (filename.endsWith('guest-fetch.ts')) return {};

    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'fetch') return;
        const prefix = urlPrefix(node.arguments[0]);
        if (!prefix || !prefix.startsWith('/api/')) return;
        if (!isMutatingOptions(node.arguments[1])) return;
        context.report({ node, messageId: 'useGuestFetch', data: { url: prefix } });
      },
    };
  },
};
