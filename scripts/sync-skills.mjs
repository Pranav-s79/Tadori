/* global console */

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillNames = [
  'tadori-spec-guardian',
  'tadori-validation',
  'tadori-indexer',
  'tadori-visual-workflow',
];
const targets = ['.claude/skills', '.agents/skills'];

for (const target of targets) {
  const targetRoot = join(root, target);
  await mkdir(targetRoot, { recursive: true });
  for (const name of skillNames) {
    const source = join(root, 'agent-skills', name, 'SKILL.md');
    const destination = join(targetRoot, name, 'SKILL.md');
    const contents = await readFile(source);
    await mkdir(dirname(destination), { recursive: true });
    try {
      if ((await readFile(destination)).equals(contents)) continue;
    } catch { /* copy missing generated file */ }
    await cp(source, destination);
  }
  const manifest = `${JSON.stringify({ generatedSkills: skillNames }, null, 2)}\n`;
  await writeFile(join(targetRoot, '.tadori-generated.json'), manifest);
}

for (const target of targets) {
  const targetRoot = join(root, target);
  const manifest = JSON.parse(await readFile(join(targetRoot, '.tadori-generated.json'), 'utf8'));
  for (const entry of await readdir(targetRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !manifest.generatedSkills.includes(entry.name)) continue;
    if (!skillNames.includes(entry.name)) await rm(join(targetRoot, entry.name), { recursive: true });
  }
}

console.log(`Synchronized ${skillNames.length} Tadori skills to .claude/skills and .agents/skills.`);
