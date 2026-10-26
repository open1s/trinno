import type { InventivePrinciple } from '../../domain/principle/entity.js';

/** Upper bound for one model answer, so a runaway reply cannot bloat a turn. */
export const MAX_INSIGHT_CHARS = 4000;

/**
 * Turn a raw model reply into usable prose.
 *
 * Models occasionally answer a prose request with a wrapping code fence or with
 * a JSON-quoted empty string ("\"\""), which reads as a successful call carrying
 * nothing. Blank answers become '' so callers can retry or fall back instead of
 * reporting an empty insight as a result.
 */
export function sanitizeProse(text: string): string {
  let out = (text || '').trim();

  // A single wrapping fence (the common ```markdown answer).
  out = out.replace(/^```[a-zA-Z0-9]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

  // Quotes the model wrapped the whole answer in, including the "" case.
  out = out.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();

  if (out === '{}' || out === '[]' || out === 'null' || out === 'undefined') return '';

  return out.slice(0, MAX_INSIGHT_CHARS);
}

/**
 * A labelled, deterministic scaffold for a principle.
 *
 * Used only when the model returns nothing: it states the principle, the
 * problem, the canonical examples and the three questions that turn the
 * principle into a solution. It is explicitly marked as a scaffold so nobody
 * mistakes it for a model answer.
 */
export function buildInsightScaffold(
  principle: InventivePrinciple,
  problem: string,
  context?: string,
  language: 'zh' | 'en' = 'en',
): string {
  const examples = principle.examples.slice(0, 3).join('; ');
  const topic = context ? `${problem} (${context})` : problem;

  if (language === 'zh') {
    return [
      '[确定性脚手架 — 模型未返回文本]',
      `原理 #${principle.index} ${principle.name}：${principle.description}`,
      `应用对象：${topic}`,
      `经典示例：${examples}`,
      '请依次回答：',
      '1. 哪个现有部件可以在不新增零件的前提下承载该原理？',
      '2. 哪个可测量指标应改善，哪个指标不能变差？',
      '3. 最小可行实验（≤3 天）是什么，验收阈值是多少？',
    ].join('\n');
  }

  return [
    '[Deterministic scaffold — the model returned no text]',
    `Principle #${principle.index} ${principle.name}: ${principle.description}`,
    `Applied to: ${topic}`,
    `Canonical examples: ${examples}`,
    'Answer these in order:',
    '1. Which existing component can carry this principle without adding a part?',
    '2. Which measurable property should improve, and which must not get worse?',
    '3. What is the smallest experiment (≤3 days), and what is its acceptance threshold?',
  ].join('\n');
}
