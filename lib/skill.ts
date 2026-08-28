import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Attributes } from './types';

const SKILL_DIR = path.join(
  process.cwd(),
  'plugins',
  'do-04-product-description',
  'skills',
  'do-04-product-description',
);

export type SkillConfig = {
  categories: Record<string, { required: string[]; optional: string[] }>;
  limits: { title: number; meta_description: number; bullet: number; bullets_count: number; long_copy: number };
  regulated_terms: Record<string, string[]>;
  regulated_terms_by_locale?: Record<string, Record<string, string[]>>;
  banned_words: string[];
  keyword_plan: Record<string, { primary: string; secondary: string[] }>;
};

export type Skill = { instructions: string; voice: string; config: SkillConfig };

let cached: Skill | null = null;

/** Load the DO-04 skill from disk. The skill is the plugin: its SKILL.md becomes the
 *  system prompt and its config drives both the prompt and the checker, so editing the
 *  skill folder changes the app's behaviour without touching app code. */
export async function loadSkill(): Promise<Skill> {
  if (cached) return cached;
  const [instructions, voice, configRaw] = await Promise.all([
    readFile(path.join(SKILL_DIR, 'SKILL.md'), 'utf8'),
    readFile(path.join(SKILL_DIR, 'references', 'voice-reference.md'), 'utf8'),
    readFile(path.join(SKILL_DIR, 'assets', 'config.json'), 'utf8'),
  ]);
  cached = { instructions, voice, config: JSON.parse(configRaw) as SkillConfig };
  return cached;
}

/** The per-product user message: the record, the keyword plan for its category, the
 *  banned list, and the voice reference. Everything the model may ground a claim in. */
export function buildPrompt(skill: Skill, category: string, sku: string, attrs: Attributes): string {
  const plan = skill.config.keyword_plan[category];
  const lines = Object.entries(attrs).map(([k, v]) => `  ${k}: ${v}`).join('\n');
  return [
    `## Product record (SKU ${sku}, category ${category})`,
    '',
    'These attributes are the ONLY facts you may use. Nothing else is known about this',
    'product. If something you want to say is not below, do not say it.',
    '',
    lines,
    '',
    '## Keyword plan for this category',
    plan ? `primary: ${plan.primary}\nsecondary: ${plan.secondary.join(', ')}` : '(none for this category — write without keyword targeting and say so in keywords_used)',
    '',
    '## Banned words',
    skill.config.banned_words.join(', '),
    '',
    '## Voice reference',
    skill.voice,
    '',
    '## Limits',
    `title ≤ ${skill.config.limits.title} chars · meta_description ≤ ${skill.config.limits.meta_description} · each bullet ≤ ${skill.config.limits.bullet} · at most ${skill.config.limits.bullets_count} bullets`,
    '',
    'Return the JSON object now. No other text.',
  ].join('\n');
}
