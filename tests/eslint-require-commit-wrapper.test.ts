import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../eslint-rules/require-commit-wrapper.js';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

describe('require-commit-wrapper', () => {
  it('passes valid and catches invalid cases', () => {
    tester.run('require-commit-wrapper', rule, {
      valid: [
        // commitToContentRepo is fine
        { code: 'commitToContentRepo(msg, files, author, git);', filename: 'src/lib/content/content-save.ts' },
        // writeFiles inside commit.ts is fine (it's the wrapper itself)
        { code: 'service.writeFiles(files, msg, author);', filename: 'src/lib/git/commit.ts' },
        // writeFiles in adapter implementations is fine
        { code: 'this.writeFiles(files, msg, author);', filename: 'src/lib/git/git.adapter-github.ts' },
        // writeFiles in tests is fine
        { code: 'git.writeFiles(files, msg, author);', filename: 'tests/some-test.ts' },
        // Non-writeFiles member calls are fine
        { code: 'git.readFile(path);', filename: 'src/views/api/route-save.ts' },
      ],
      invalid: [
        {
          code: 'git.writeFiles(files, msg, author);',
          filename: 'src/views/api/route-save.ts',
          errors: [{ messageId: 'useCommitWrapper' }],
        },
        {
          code: 'git.writeFiles(files, msg, author, deletePaths);',
          filename: 'src/lib/content/content-save.ts',
          errors: [{ messageId: 'useCommitWrapper' }],
        },
        {
          code: 'service.writeFiles(files, msg, author);',
          filename: 'src/lib/media/video-completion.webhook.ts',
          errors: [{ messageId: 'useCommitWrapper' }],
        },
      ],
    });
  });
});
