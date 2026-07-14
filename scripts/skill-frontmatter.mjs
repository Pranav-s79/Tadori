/** Validate a SKILL.md's YAML frontmatter; returns a list of problems. */
export function frontmatterProblems(skillName, contents) {
  const problems = [];
  const text = contents.toString('utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return [`${skillName}: missing or unterminated frontmatter block`];
  const fields = new Map();
  for (const line of match[1].split('\n')) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!field) problems.push(`${skillName}: malformed frontmatter line: ${JSON.stringify(line)}`);
    else fields.set(field[1], field[2].trim());
  }
  if (fields.get('name') !== skillName) {
    problems.push(`${skillName}: frontmatter name must be ${JSON.stringify(skillName)}, got ${JSON.stringify(fields.get('name') ?? null)}`);
  }
  if (!fields.get('description')) problems.push(`${skillName}: frontmatter description is missing or empty`);
  return problems;
}
