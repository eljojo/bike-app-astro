import { describe, it, expect } from 'vitest';
import { serializeMdFile, serializeYamlFile } from '../src/lib/file-serializers';

describe('serializeMdFile', () => {
  it('serializes frontmatter + body', () => {
    const result = serializeMdFile({ title: 'Hello', status: 'published' }, 'Some content');
    expect(result).toMatch(/^---\n/);
    expect(result).toContain('title: Hello');
    expect(result).toContain('status: published');
    expect(result).toContain('---\n\nSome content\n');
  });

  it('serializes frontmatter only (no body)', () => {
    const result = serializeMdFile({ name: 'Test' });
    expect(result).toMatch(/^---\n/);
    expect(result).toContain('name: Test');
    expect(result).toMatch(/---\n$/);
  });

  it('trims body whitespace', () => {
    const result = serializeMdFile({ a: 1 }, '  content  ');
    expect(result).toContain('---\n\ncontent\n');
  });

  it('handles empty body as no body', () => {
    const result = serializeMdFile({ a: 1 }, '   ');
    expect(result).toMatch(/---\n$/);
  });

  it('uses long line width (no wrapping)', () => {
    const longValue = 'a'.repeat(200);
    const result = serializeMdFile({ description: longValue });
    // With lineWidth: -1, the value should not be wrapped
    expect(result).toContain(`description: ${longValue}`);
  });
});

describe('serializeYamlFile', () => {
  it('serializes array to YAML', () => {
    const result = serializeYamlFile([{ key: 'abc', caption: 'test' }]);
    expect(result).toContain('key: abc');
    expect(result).toContain('caption: test');
  });

  it('serializes nested objects', () => {
    const result = serializeYamlFile([{ key: 'x', nested: { a: 1 } }]);
    expect(result).toContain('key: x');
    expect(result).toContain('a: 1');
  });
});
