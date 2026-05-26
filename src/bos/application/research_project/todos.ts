import { ProjectState, PhaseState, TaskDef, TaskStatus, PhaseId, TodoChange } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

export function readProjectState(rootDir: string): ProjectState | null {
  const jsonPath = path.join(rootDir, 'project.json');
  if (fs.existsSync(jsonPath)) {
    try {
      return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    } catch {}
  }
  return null;
}

export function writeProjectState(rootDir: string, state: ProjectState): void {
  const jsonPath = path.join(rootDir, 'project.json');
  fs.writeFileSync(jsonPath, JSON.stringify(state, null, 2), 'utf-8');

  const yamlPath = path.join(rootDir, 'TODOS.yaml');
  fs.writeFileSync(yamlPath, serializeYaml(state), 'utf-8');

  writeMarkdownTodos(rootDir, state);
}

export function updateTodo(rootDir: string, change: TodoChange): ProjectState {
  const state = readProjectState(rootDir);
  if (!state) throw new Error(`No project state at ${rootDir}`);

  const phase = state.phases.find(p => p.id === change.phaseId);
  if (!phase) throw new Error(`Phase ${change.phaseId} not found`);

  const task = phase.tasks.find(t => t.id === change.taskId);
  if (!task) throw new Error(`Task ${change.taskId} not found in phase ${change.phaseId}`);

  task.status = change.newStatus;
  state.updatedAt = new Date().toISOString();
  recalcCompletion(phase);
  writeProjectState(rootDir, state);
  return state;
}

export function suggestNextStep(state: ProjectState, rootDir?: string): string {
  const allPhases = state.phases;

  const surveyPhase = allPhases.find(p => p.id === '01_Survey');
  if (surveyPhase && (surveyPhase.status === 'done' || surveyPhase.status === 'in_progress')) {
    const surveyComplete = surveyPhase.tasks.every(t => t.status === 'done');
    if (surveyComplete && rootDir) {
      const allResults = loadSearchResultsForSuggestion(rootDir);
      if (allResults < 10) {
        return `调研结果较少（仅 ${allResults} 条）。建议用 \`/trp amend survey 补充关键词和描述\` 完善搜索，获取更多文献后再继续。`;
      }
    }
  }

  const allTasks = state.phases.flatMap(p => p.tasks.map(t => ({ ...t, phaseId: p.id, phaseTitle: p.id })));
  const pending = allTasks.filter(t => t.status === 'pending');
  const inProgress = allTasks.filter(t => t.status === 'in_progress');

  if (inProgress.length > 0) {
    const t = inProgress[0]!;
    const phaseName = PHASE_NAMES[t.phaseId] || t.phaseId;
    return `继续完成 **${phaseName}** 的 **${t.title}**（进行中）`;
  }

  const ready = pending.filter(t =>
    !t.dependsOn || t.dependsOn.every(depId =>
      allTasks.some(dep => dep.id === depId && dep.status === 'done')
    )
  );

  if (ready.length > 0) {
    const t = ready[0]!;
    const phaseName = PHASE_NAMES[t.phaseId] || t.phaseId;
    return `建议开始 **${phaseName}** → **${t.title}**`;
  }

  if (pending.length === 0) return '所有任务已完成！可以进入输出交付阶段。';
  return `有 ${pending.length} 个任务被阻塞，等待前置任务完成。`;
}

function loadSearchResultsForSuggestion(rootDir: string): number {
  try {
    const resultsDir = path.join(rootDir, '01_Survey', 'search_results');
    if (!fs.existsSync(resultsDir)) return 0;
    let total = 0;
    const files = ['patents.json', 'papers.json', 'tech_solutions.json'];
    for (const file of files) {
      const fp = path.join(resultsDir, file);
      if (fs.existsSync(fp)) {
        try { total += JSON.parse(fs.readFileSync(fp, 'utf-8')).length; } catch {}
      }
    }
    return total;
  } catch { return 0; }
}

function recalcCompletion(phase: PhaseState): void {
  if (phase.tasks.length === 0) { phase.completion = 0; return; }
  const doneCount = phase.tasks.filter(t => t.status === 'done').length;
  phase.completion = Math.round((doneCount / phase.tasks.length) * 100);
}

function serializeYaml(state: ProjectState): string {
  const lines: string[] = [];
  lines.push('# Research Project: ' + state.name);
  lines.push('---');
  lines.push(`name: "${state.name}"`);
  lines.push(`problem: "${state.problem}"`);
  lines.push(`created_at: "${state.createdAt}"`);
  lines.push(`updated_at: "${state.updatedAt}"`);
  lines.push('phases:');
  for (const phase of state.phases) {
    lines.push(`  ${phase.id}:`);
    lines.push(`    status: "${phase.status}"`);
    lines.push(`    completion: ${phase.completion}`);
    lines.push('    tasks:');
    for (const task of phase.tasks) {
      lines.push(`      - id: "${task.id}"`);
      lines.push(`        title: "${task.title}"`);
      if (task.description) lines.push(`        description: "${task.description}"`);
      lines.push(`        status: "${task.status}"`);
      if (task.dependsOn && task.dependsOn.length > 0) {
        lines.push(`        depends_on: ["${task.dependsOn.join('", "')}"]`);
      }
      if (task.outputFile) lines.push(`        output_file: "${task.outputFile}"`);
    }
  }
  return lines.join('\n') + '\n';
}

function writeMarkdownTodos(rootDir: string, state: ProjectState): void {
  const lines: string[] = [
    `# ${state.name} — 研究进度追踪`,
    '',
    `**问题**: ${state.problem}`,
    `**更新**: ${state.updatedAt}`,
    '',
    '---',
    '',
  ];

  for (const phase of state.phases) {
    const emoji = phase.status === 'done' ? '✅' : phase.status === 'in_progress' ? '🔄' : '⏳';
    const barLen = 20;
    const filled = Math.round((phase.completion / 100) * barLen);
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
    const phaseName = PHASE_NAMES[phase.id] || phase.id;
    lines.push(`## ${emoji} ${phaseName} \`${bar} ${phase.completion}%\``);
    lines.push('');
    for (const task of phase.tasks) {
      const statusIcon = task.status === 'done' ? '[x]' : task.status === 'in_progress' ? '[~]' : task.status === 'blocked' ? '[!]' : '[ ]';
      lines.push(`- ${statusIcon} **${task.id}** ${task.title}`);
      if (task.description) lines.push(`  - ${task.description}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('> 由 Research Project 框架自动生成。编辑 TODOS.yaml 后重新生成此文件。');
  lines.push('');

  fs.writeFileSync(path.join(rootDir, 'TODOS.md'), lines.join('\n'), 'utf-8');
}

const PHASE_NAMES: Record<string, string> = {
  '00_Init': '00 — 初始化与规划',
  '01_Survey': '01 — 调研扫描',
  '02_TRL': '02 — TRL 技术成熟度评估',
  '03_Analyze': '03 — 分析解构',
  '04_Synthesize': '04 — 创新综合',
  '05_Deliver': '05 — 输出交付',
  '06_References': '06 — 文献资料管理',
};
