import yaml from 'js-yaml';

const FRONTMATTER_OPTIONS = { lineWidth: -1, quotingType: '"' as const, forceQuotes: false };
const YAML_LIST_OPTIONS = { flowLevel: -1, lineWidth: -1 };

/** Serialize frontmatter (and optional body) into a markdown file string with YAML front matter. */
export function serializeMdFile(frontmatter: Record<string, unknown>, body?: string): string {
	const fmStr = yaml.dump(frontmatter, FRONTMATTER_OPTIONS).trimEnd();
	const trimmedBody = body?.trim();
	if (trimmedBody) {
		return `---\n${fmStr}\n---\n\n${trimmedBody}\n`;
	}
	return `---\n${fmStr}\n---\n`;
}

/** Serialize data (typically an array of objects) into a YAML file string. */
export function serializeYamlFile(data: unknown): string {
	return yaml.dump(data, YAML_LIST_OPTIONS);
}
