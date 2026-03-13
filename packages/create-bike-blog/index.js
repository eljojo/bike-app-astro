#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import readline from 'node:readline';

// --- Template engine ---

export function renderTemplate(content, vars) {
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in vars ? vars[key] : match;
  });
}

// --- File operations ---

function copyTemplate(templateDir, destDir, vars) {
  for (const entry of fs.readdirSync(templateDir, { withFileTypes: true })) {
    const srcPath = path.join(templateDir, entry.name);
    const destName = entry.name.replace(/\.tpl$/, '');
    const destPath = path.join(destDir, destName);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyTemplate(srcPath, destPath, vars);
    } else {
      let content = fs.readFileSync(srcPath, 'utf-8');
      if (entry.name.endsWith('.tpl')) {
        content = renderTemplate(content, vars);
      }
      fs.writeFileSync(destPath, content);
    }
  }
}

// --- Prompts ---

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    console.log(`
  Usage: npx create-bike-blog <folder> <domain>

  Example: npx create-bike-blog bike-blog eljojo.bike
`);
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  const folder = args[0];
  const domain = args[1];
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const destDir = path.resolve(folder);

  if (fs.existsSync(destDir)) {
    console.error(`\n  Error: ${folder}/ already exists.\n`);
    process.exit(1);
  }

  console.log(`
  Welcome to whereto.bike!

  Here's how setting up your blog works:

    1. Bootstrap (you are here)
       Creating your project in ${folder}/

    2. Edit
       Customize your config, write your about page, add some rides

    3. npm run setup
       Connects GitHub and Cloudflare so deploys work automatically

    4. git push
       Your blog is live at ${domain}!
`);

  // Create project directory
  fs.mkdirSync(destDir, { recursive: true });

  const folderName = path.basename(destDir);
  const vars = {
    FOLDER: folderName,
    DOMAIN: domain,
    TIMEZONE: timezone,
  };

  // Copy and render templates
  const templateDir = new URL('./templates', import.meta.url).pathname;
  copyTemplate(templateDir, destDir, vars);

  // Rename dotfiles (npm strips .gitignore from published packages)
  const renames = { gitignore: '.gitignore', gitattributes: '.gitattributes', env: '.env' };
  for (const [from, to] of Object.entries(renames)) {
    const src = path.join(destDir, from);
    const dest = path.join(destDir, to);
    if (fs.existsSync(src)) fs.renameSync(src, dest);
  }

  // Move github/ to .github/
  const githubSrc = path.join(destDir, 'github');
  const githubDest = path.join(destDir, '.github');
  if (fs.existsSync(githubSrc)) {
    fs.renameSync(githubSrc, githubDest);
  }

  // Move city/ to blog/
  const citySrc = path.join(destDir, 'city');
  const cityDest = path.join(destDir, 'blog');
  if (fs.existsSync(citySrc)) {
    fs.renameSync(citySrc, cityDest);
  }

  console.log(`  Files created in ${folder}/\n`);

  // Install dependencies
  const install = await ask('  Install dependencies? (npm install) [Y/n] ');
  if (install.toLowerCase() !== 'n') {
    try {
      execSync('npm install', { cwd: destDir, stdio: 'inherit' });
    } catch {
      console.error('\n  npm install failed. You can retry manually: cd ' + folder + ' && npm install\n');
    }
  } else {
    console.log(`\n  Skipped. Run it yourself:\n\n    cd ${folder} && npm install\n`);
  }

  // Initialize git repo
  const gitInit = await ask('  Initialize git repo? (git init + first commit) [Y/n] ');
  if (gitInit.toLowerCase() !== 'n') {
    execSync('git init', { cwd: destDir, stdio: 'pipe' });
    execSync('git add -A', { cwd: destDir, stdio: 'pipe' });
    execSync('git commit -m "initial blog scaffold"', { cwd: destDir, stdio: 'pipe' });
    console.log('\n  ✓ Git repo initialized with first commit.\n');
  } else {
    console.log(`\n  Skipped. Run it yourself:\n\n    cd ${folder} && git init && git add -A && git commit -m "initial blog scaffold"\n`);
  }

  console.log(`  Next steps:

    cd ${folder}
    # edit blog/config.yml and blog/pages/about.md
    npm run setup
`);

  rl.close();
}

// Only run when invoked directly (not when imported for tests)
const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith('/index.js') || process.argv[1].endsWith('/create-bike-blog'));
if (isDirectRun) {
  main();
}
