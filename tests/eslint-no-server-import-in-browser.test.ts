import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../eslint-rules/no-server-import-in-browser.js';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

describe('no-server-import-in-browser', () => {
  it('passes valid and catches invalid cases', () => {
    tester.run('no-server-import-in-browser', rule, {
      valid: [
        // Server file can import .server
        { code: "import { x } from './foo.server';", filename: '/src/lib/foo.server.ts' },
        // View can import .server (outside src/lib/)
        { code: "import { x } from '../../lib/config/config.server';", filename: '/src/views/api/route-save.ts' },
        // Loader can import .server
        { code: "import { x } from '../lib/config/config.server';", filename: '/src/loaders/routes.ts' },
        // Shared file importing non-server is fine
        { code: "import { CITY } from './config';", filename: '/src/lib/config/instance-features.ts' },
        // tsx importing non-server is fine
        { code: "import { slugify } from '../../lib/slug';", filename: '/src/components/admin/RouteEditor.tsx' },
        // export from non-server is fine in shared file
        { code: "export { rideGpxFilename } from './filenames';", filename: '/src/lib/gpx/paths.ts' },
      ],
      invalid: [
        // tsx importing .server
        {
          code: "import { cityDir } from '../../lib/config/config.server';",
          filename: '/src/components/admin/RouteEditor.tsx',
          errors: [{ messageId: 'serverImport' }],
        },
        // shared lib file importing .server
        {
          code: "import { computeHashFromParts } from './content-hash.server';",
          filename: '/src/lib/models/route-model.ts',
          errors: [{ messageId: 'serverImport' }],
        },
        // export from .server in shared file
        {
          code: "export { computeHashFromParts } from './content-hash.server';",
          filename: '/src/lib/models/content-model.ts',
          errors: [{ messageId: 'serverImport' }],
        },
        // export * from .server in shared file
        {
          code: "export * from './content-hash.server';",
          filename: '/src/lib/models/content-model.ts',
          errors: [{ messageId: 'serverImport' }],
        },
        // dynamic import of .server in tsx
        {
          code: "const mod = import('./foo.server');",
          filename: '/src/components/admin/Foo.tsx',
          errors: [{ messageId: 'serverImport' }],
        },
      ],
    });
  });
});
