/* global console, process */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { frontmatterProblems } from './skill-frontmatter.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillNames = [
  'tadori-spec-guardian',
  'tadori-validation',
  'tadori-indexer',
  'tadori-visual-workflow',
];
const targets = ['.claude/skills', '.agents/skills'];
let failed = false;

for (const name of skillNames) {
  let canonical;
  try { canonical = await readFile(join(root, 'agent-skills', name, 'SKILL.md')); }
  catch { console.error(`Missing canonical source: agent-skills/${name}/SKILL.md`); failed = true; continue; }
  for (const problem of frontmatterProblems(name, canonical)) {
    console.error(`Invalid canonical skill: ${problem}`); failed = true;
  }
  for (const target of targets) {
    const display = `${target}/${name}/SKILL.md`;
    try {
      if (!(await readFile(join(root, target, name, 'SKILL.md'))).equals(canonical)) {
        console.error(`Stale generated skill: ${display}`); failed = true;
      }
    } catch { console.error(`Missing generated skill: ${display}`); failed = true; }
  }
}

for (const target of targets) {
  try {
    const manifest = JSON.parse(await readFile(join(root, target, '.tadori-generated.json'), 'utf8'));
    if (JSON.stringify(manifest.generatedSkills) !== JSON.stringify(skillNames)) {
      console.error(`Unexpected generated manifest: ${target}/.tadori-generated.json`); failed = true;
    }
  } catch { console.error(`Missing or invalid manifest: ${target}/.tadori-generated.json`); failed = true; }
}

if (failed) process.exitCode = 1;
else console.log(`Verified ${skillNames.length} canonical skills against Claude and Codex copies.`);
