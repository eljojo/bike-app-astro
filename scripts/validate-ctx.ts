/**
 * Validate the _ctx/ context system.
 *
 * Checks:
 * 1. All _ctx/ links in AGENTS.md files resolve to real files
 * 2. All _ctx/ files have required frontmatter (description, type)
 * 3. All _ctx/ files are listed in root AGENTS.md index
 * 4. No _ctx/ files have stray code fences at the end
 * 5. Related references point to existing _ctx/ files
 *
 * Run: npx tsx scripts/validate-ctx.ts
 * Exit code: 0 if valid, 1 if errors found
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CTX_DIR = path.join(ROOT, '_ctx');
const AGENTS_ROOT = path.join(ROOT, 'AGENTS.md');
const CONTENT_DIR = process.env.CONTENT_DIR || path.join(process.env.HOME!, 'code', 'bike-routes');

let errors = 0;

function error(msg: string) {
  console.error(`  ERROR: ${msg}`);
  errors++;
}


// --- 1. Collect all _ctx/ files ---

const ctxFiles = fs.existsSync(CTX_DIR)
  ? fs.readdirSync(CTX_DIR).filter(f => f.endsWith('.md'))
  : [];

if (ctxFiles.length === 0) {
  error('No _ctx/ files found');
  process.exit(1);
}

console.log(`Found ${ctxFiles.length} _ctx/ files`);

// --- 2. Validate frontmatter in each _ctx/ file ---

const REQUIRED_FIELDS = ['description', 'type'];
const VALID_TYPES = ['vision', 'knowledge', 'rule', 'protocol', 'gotcha'];

for (const file of ctxFiles) {
  const content = fs.readFileSync(path.join(CTX_DIR, file), 'utf-8');

  // Check frontmatter exists
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    error(`${file}: missing frontmatter`);
    continue;
  }

  const fm = fmMatch[1];

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!fm.includes(`${field}:`)) {
      error(`${file}: missing frontmatter field '${field}'`);
    }
  }

  // Check type is valid
  const typeMatch = fm.match(/type:\s*(\w+)/);
  if (typeMatch && !VALID_TYPES.includes(typeMatch[1])) {
    error(`${file}: invalid type '${typeMatch[1]}' (expected: ${VALID_TYPES.join(', ')})`);
  }

  // Check related references point to existing files
  const relatedMatch = fm.match(/related:\s*\[([^\]]*)\]/);
  if (relatedMatch) {
    const related = relatedMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const ref of related) {
      if (!ctxFiles.includes(`${ref}.md`)) {
        error(`${file}: related reference '${ref}' does not exist in _ctx/`);
      }
    }
  }

  // Check for stray code fences at end
  const trimmed = content.trimEnd();
  if (trimmed.endsWith('```')) {
    error(`${file}: ends with stray code fence`);
  }
}

// --- 3. Check all _ctx/ files are listed in root AGENTS.md ---

const agentsRoot = fs.readFileSync(AGENTS_ROOT, 'utf-8');

for (const file of ctxFiles) {
  const stem = file.replace('.md', '');
  if (!agentsRoot.includes(`_ctx/${file}`) && !agentsRoot.includes(`_ctx/${stem}`)) {
    error(`${file}: not listed in root AGENTS.md index`);
  }
}

// --- 4. Check all _ctx/ links in AGENTS.md files resolve ---

function findAgentsMdFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.data') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findAgentsMdFiles(fullPath));
    } else if (entry.name === 'AGENTS.md') {
      results.push(fullPath);
    }
  }
  return results;
}

const allAgentsMd = findAgentsMdFiles(ROOT);

for (const agentsFile of allAgentsMd) {
  const content = fs.readFileSync(agentsFile, 'utf-8');
  const relPath = path.relative(ROOT, agentsFile);

  // Find all markdown links containing _ctx/
  const linkPattern = /\]\(([^)]*_ctx\/[^)]*)\)/g;
  let match;
  while ((match = linkPattern.exec(content)) !== null) {
    const linkTarget = match[1];
    // Resolve cross-repo references: ~/code/bike-routes → CONTENT_DIR,
    // ~/code/bike-app-astro → ROOT. Works on CI (CONTENT_DIR=$WORKSPACE/bike-routes)
    // and locally (~/code/bike-routes).
    let resolved: string;
    if (linkTarget.startsWith('~/code/bike-routes/')) {
      resolved = path.resolve(CONTENT_DIR, linkTarget.replace('~/code/bike-routes/', ''));
    } else if (linkTarget.startsWith('~/code/bike-app-astro/')) {
      resolved = path.resolve(ROOT, linkTarget.replace('~/code/bike-app-astro/', ''));
    } else if (linkTarget.startsWith('~/')) {
      // Other ~/code/ repos — skip, can't resolve
      continue;
    } else {
      resolved = path.resolve(path.dirname(agentsFile), linkTarget);
    }
    if (!fs.existsSync(resolved)) {
      error(`${relPath}: broken link to '${linkTarget}' (resolves to ${path.relative(ROOT, resolved)})`);
    }
  }
}

// --- Summary ---

if (errors > 0) {
  console.error(`\n${errors} error(s) found`);
  process.exit(1);
} else {
  console.log('\nAll context validation checks passed');
}
