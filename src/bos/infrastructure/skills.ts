import * as fs from 'fs';
import * as path from 'path';

export interface SkillInfo {
  name: string;
  description: string;
  dir: string;
}

const SKILL_FILE = 'SKILL.md';

function parseSkillFrontmatter(content: string): { name: string; description: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { name: '', description: '' };
  const fm = fmMatch[1] || '';
  const nameMatch = fm.match(/^name:\s*["']?([^"'\n]+)["']?/m);
  const descMatch = fm.match(/^description:\s*["']?([^"'\n]+)["']?/m);
  return {
    name: (nameMatch?.[1] || '').trim(),
    description: (descMatch?.[1] || '').trim(),
  };
}

export function listSkillsInDir(skillsDir: string): SkillInfo[] {
  if (!fs.existsSync(skillsDir)) return [];
  const skills: SkillInfo[] = [];
  let entries: string[] = [];
  try { entries = fs.readdirSync(skillsDir); } catch { return []; }
  for (const entry of entries) {
    const full = path.join(skillsDir, entry);
    let stat: fs.Stats;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const skillFile = path.join(full, SKILL_FILE);
    if (!fs.existsSync(skillFile)) continue;
    try {
      const content = fs.readFileSync(skillFile, 'utf-8');
      const meta = parseSkillFrontmatter(content);
      skills.push({
        name: meta.name || entry,
        description: meta.description || '',
        dir: full,
      });
    } catch { /* skip unreadable */ }
  }
  return skills;
}

export function listAvailableSkills(skillsDirs: string[]): SkillInfo[] {
  const seen = new Set<string>();
  const out: SkillInfo[] = [];
  for (const dir of skillsDirs) {
    for (const skill of listSkillsInDir(dir)) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      out.push(skill);
    }
  }
  return out;
}
