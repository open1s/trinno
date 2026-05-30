import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';
import { ResearchProject } from '../application/research_project/research_project.js';
import { ALL_PHASES, PhaseId } from '../application/research_project/types.js';
import { readProjectState, suggestNextStep } from '../application/research_project/todos.js';
import * as path from 'path';
import * as fs from 'fs';

const PHASE_CHAIN: PhaseId[] = ALL_PHASES.map(p => p.id);

function getRoot(): string {
  return (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd();
}

function loadProject(deps: TrizDeps): ResearchProject | null {
  const root = getRoot();
  const state = readProjectState(root);
  if (!state) return null;
  return new ResearchProject(state, deps.searchService, deps.analysisTools, root);
}

const PHASE_NAME_MAP: Record<string, PhaseId> = {
  survey: '01_Survey', trl: '02_TRL', analyze: '03_Analyze',
  synthesize: '04_Synthesize', deliver: '05_Deliver',
  references: '06_References', reference: '06_References', refs: '06_References',
};

function getFirstUnfinished(state: any): PhaseId | null {
  for (const pid of PHASE_CHAIN) {
    const p = state.phases.find((ph: any) => ph.id === pid);
    if (p && p.status !== 'done') return pid;
  }
  return null;
}

async function runPhaseTask(
  project: ResearchProject, phaseId: PhaseId, emit: (type: string, data: any) => void, signal: AbortSignal,
): Promise<void> {
  const pd = ALL_PHASES.find(p => p.id === phaseId);
  emit('token', { tokenType: 'Text', text: `\n### ▶️ ${pd?.titleZh || phaseId}\n\n` });
  await project.runPhase(phaseId, (msg) => {
    if (signal.aborted) return;
    emit('token', { tokenType: 'Text', text: `> ${msg}\n` });
  }, (type, text) => {
    if (signal.aborted) return;
    emit('token', { tokenType: type, text });
  });
  emit('token', { tokenType: 'Text', text: `✅ ${pd?.titleZh || phaseId} 完成\n` });
}

async function runAllPhases(
  project: ResearchProject, emit: (type: string, data: any) => void, signal: AbortSignal,
): Promise<void> {
  for (const phaseId of PHASE_CHAIN) {
    if (signal.aborted) { emit('token', { tokenType: 'Text', text: '\n已取消。\n' }); emit('done', {}); return; }
    try {
      await runPhaseTask(project, phaseId, emit, signal);
    } catch (err) {
      if (signal.aborted) throw err;
      const pd = ALL_PHASES.find(p => p.id === phaseId);
      emit('token', { tokenType: 'Text', text: `⚠️ ${pd?.titleZh || phaseId} 出错: ${err instanceof Error ? err.message : String(err)}\n` });
    }
  }
}

async function doInit(
  problem: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal,
): Promise<void> {
  emit('token', { tokenType: 'Text', text: `## 📁 ${path.basename(getRoot())}\n\n**问题:** ${problem}\n\n` });

    // Derive project name from the problem description (more meaningful than dirname)
  const projectName = problem.replace(/[^\w\s一-鿿]/g, '').trim().split(/\s+/).slice(0, 6).join(' ')
    || path.basename(getRoot());

  const project = ResearchProject.create(
    { name: projectName, problem, rootDir: getRoot() },
    deps.searchService,
    deps.analysisTools,
  );
  project.save();
  emit('token', { tokenType: 'Text', text: `在 \`${getRoot()}\` 下创建了研究项目。\n\n` });

  emit('token', { tokenType: 'Text', text: '---\n**开始执行全部阶段...**\n\n' });
  await runAllPhases(project, emit, signal);
  if (!signal.aborted) {
    emit('token', { tokenType: 'Text', text: `\n---\n**全部完成。**\n` });
  }
  emit('done', {});
}

async function doAmend(
  targetPhase: PhaseId, amendment: string, deps: TrizDeps,
  emit: (type: string, data: any) => void, signal: AbortSignal,
): Promise<void> {
  const amendFile = path.join(getRoot(), targetPhase, 'amendments.json');
  let existing: string[] = [];
  if (fs.existsSync(amendFile)) {
    try { existing = JSON.parse(fs.readFileSync(amendFile, 'utf-8')); } catch {}
  }
  existing.push(amendment);
  const amendDir = path.dirname(amendFile);
  if (!fs.existsSync(amendDir)) fs.mkdirSync(amendDir, { recursive: true });
  fs.writeFileSync(amendFile, JSON.stringify(existing, null, 2), 'utf-8');

  const pd = ALL_PHASES.find(p => p.id === targetPhase);
  emit('token', { tokenType: 'Text', text: `📝 补充到 **${pd?.titleZh || targetPhase}**，重新执行...\n\n` });

  const project = loadProject(deps);
  if (!project) { emit('token', { tokenType: 'Text', text: '项目未找到。\n' }); emit('done', {}); return; }

  try {
    await runPhaseTask(project, targetPhase, emit, signal);
    const newState = readProjectState(getRoot());
    if (newState) {
      const phase = newState.phases.find(p => p.id === targetPhase);
      if (phase) {
        const barLen = 15;
        const filled = Math.round((phase.completion / 100) * barLen);
        const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
        emit('token', { tokenType: 'Text', text: `\n**阶段完成:** \`${bar} ${phase.completion}%\`\n\n` });
      }
    }
    emit('token', { tokenType: 'Text', text: `\n✅ ${pd?.titleZh || targetPhase} 重新执行完成。\n` });

    // Cascade: re-run all downstream phases that depend on this phase's output
    const targetIdx = PHASE_CHAIN.indexOf(targetPhase);
    if (targetIdx >= 0) {
      const downstreamPhases = PHASE_CHAIN.slice(targetIdx + 1);
      if (downstreamPhases.length > 0) {
        emit('token', { tokenType: 'Text', text: `\n🔄 **级联重新执行下游阶段**: ${downstreamPhases.map(p => ALL_PHASES.find(ap => ap.id === p)?.titleZh || p).join(' → ')}\n\n` });
        for (const downstreamId of downstreamPhases) {
          if (signal.aborted) break;
          const downstreamPd = ALL_PHASES.find(p => p.id === downstreamId);
          emit('token', { tokenType: 'Text', text: `\n### 📌 由于 ${pd?.titleZh || targetPhase} 已更新，重新执行 ${downstreamPd?.titleZh || downstreamId}...\n\n` });
          try {
            await runPhaseTask(project, downstreamId, emit, signal);
          } catch (derr) {
            if (signal.aborted) return;
            emit('token', { tokenType: 'Text', text: `⚠️ ${downstreamPd?.titleZh || downstreamId} 级联失败: ${derr instanceof Error ? derr.message : String(derr)}\n` });
          }
        }
        emit('token', { tokenType: 'Text', text: `\n✅ 级联完成。所有依赖阶段已更新。\n` });
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    emit('token', { tokenType: 'Text', text: `\n❌ 错误: ${err instanceof Error ? err.message : String(err)}\n` });
  }
  emit('done', {});
}

async function doResume(
  deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal,
): Promise<void> {
  const project = loadProject(deps);
  if (!project) {
    emit('token', { tokenType: 'Text', text: '未找到研究项目。输入研究问题开始：`/trp 你的研究问题`\n' });
    emit('done', {});
    return;
  }

  const state = readProjectState(getRoot());
  const nextPhase = getFirstUnfinished(state);
  if (!nextPhase) {
    emit('token', { tokenType: 'Text', text: '🎉 所有阶段已完成！\n\n' });
    doStatus(emit);
    emit('done', {});
    return;
  }

  const pd = ALL_PHASES.find(p => p.id === nextPhase);
  emit('token', { tokenType: 'Text', text: `▶️ 继续执行：**${pd?.titleZh || nextPhase}**\n\n` });

  try {
    await runPhaseTask(project, nextPhase, emit, signal);

    const newState = readProjectState(getRoot());
    if (newState) {
      const phase = newState.phases.find(p => p.id === nextPhase);
      if (phase) {
        const barLen = 15;
        const filled = Math.round((phase.completion / 100) * barLen);
        const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
        emit('token', { tokenType: 'Text', text: `\n**阶段完成:** \`${bar} ${phase.completion}%\`\n\n` });
      }
    }

    const suggestion = suggestNextStep(readProjectState(getRoot())!, getRoot());
    emit('token', { tokenType: 'Text', text: `**💡 建议:** ${suggestion}\n` });
  } catch (err) {
    if (signal.aborted) { emit('token', { tokenType: 'Text', text: '\n已取消。\n' }); emit('done', {}); return; }
    emit('token', { tokenType: 'Text', text: `\n❌ 错误: ${err instanceof Error ? err.message : String(err)}\n` });
  }
  emit('done', {});
}

function doStatus(emit: (type: string, data: any) => void): void {
  const state = readProjectState(getRoot());
  if (!state) {
    emit('token', { tokenType: 'Text', text: '当前目录未找到研究项目。输入研究问题开始：`/trp 你的研究问题`\n' });
    return;
  }

  emit('token', { tokenType: 'Text', text: `## ${path.basename(getRoot())} — 进度\n\n**问题:** ${state.problem}\n\n` });
  for (const phase of state.phases) {
    const barLen = 20;
    const filled = Math.round((phase.completion / 100) * barLen);
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
    const pd = ALL_PHASES.find(p => p.id === phase.id);
    const icon = phase.status === 'done' ? '✅' : phase.status === 'in_progress' ? '🔄' : '⏳';
    emit('token', { tokenType: 'Text', text: `${icon} **${pd?.titleZh || phase.id}** \`${bar} ${phase.completion}%\`\n` });
    for (const task of phase.tasks) {
      const ti: Record<string, string> = { done: '✅', in_progress: '🔄', pending: '⬜', blocked: '🚫', skipped: '⏭️' };
      emit('token', { tokenType: 'Text', text: `  ${ti[task.status] || '⬜'} **${task.id}** ${task.title}\n` });
    }
  }
  emit('token', { tokenType: 'Text', text: `\n**💡 建议:** ${suggestNextStep(state, getRoot())}\n` });
}

function showHelp(emit: (type: string, data: any) => void): void {
  emit('token', { tokenType: 'Text', text: `## /trp — TRIZ Research Project

**智能调度模式：** 无需记子命令，AI 自动理解意图。

\`\`\`
/trp                         — 继续执行下一阶段
/trp 电池技术发展             — 创建新研究项目并执行全流程
/trp 加上钠离子电池数据        — 补充信息到调研阶段，重新搜索
/trp 分析成本瓶颈              — 补充信息到分析阶段
/trp references               — 管理参考文献与引用
/trp 看看状态                 — 查看项目进度
\`\`\`

**流程:** 初始化 → 调研搜索 → TRL评估 → 矛盾分析 → 方案综合 → 报告交付 → 文献管理
` });
  emit('done', {});
}

export const trpCommand: SlashCommand = {
  name: 'trp',
  description: 'AI-driven TRIZ research: auto-detects intent, no sub-commands needed',
  usage: '/trp [研究问题 or 补充信息]',
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) {
    const input = args.trim();
    const hasProject = !!readProjectState(getRoot());

    if (!input) {
      if (hasProject) { await doResume(deps, emit, signal); return; }
      showHelp(emit);
      return;
    }

    // Legacy sub-command shortcuts
    const firstWord = input.split(/\s+/)[0]?.toLowerCase() || '';
    if (firstWord === 'help') { showHelp(emit); return; }
    if (firstWord === 'status') { doStatus(emit); emit('done', {}); return; }
    if (firstWord === 'suggest') {
      const state = readProjectState(getRoot());
      if (!state) { emit('token', { tokenType: 'Text', text: '当前目录未找到项目。\n' }); emit('done', {}); return; }
      emit('token', { tokenType: 'Text', text: `**💡 建议:** ${suggestNextStep(state, getRoot())}\n` });
      emit('done', {}); return;
    }

    const phaseIdFromName = PHASE_NAME_MAP[firstWord];
    if (phaseIdFromName) {
      const project = loadProject(deps);
      if (!project) { emit('token', { tokenType: 'Text', text: '未找到项目。先输入研究问题：`/trp 你的研究问题`\n' }); emit('done', {}); return; }
      try {
        await runPhaseTask(project, phaseIdFromName, emit, signal);
        const newState = readProjectState(getRoot());
        if (newState) {
          const phase = newState.phases.find(p => p.id === phaseIdFromName);
          if (phase) {
            const barLen = 15;
            const filled = Math.round((phase.completion / 100) * barLen);
            const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
            emit('token', { tokenType: 'Text', text: `\n**阶段完成:** \`${bar} ${phase.completion}%\`\n\n` });
          }
        }
        emit('token', { tokenType: 'Text', text: `**💡 建议:** ${suggestNextStep(readProjectState(getRoot())!, getRoot())}\n` });
      } catch (err) {
        if (signal.aborted) { emit('token', { tokenType: 'Text', text: '\n已取消。\n' }); emit('done', {}); return; }
        emit('token', { tokenType: 'Text', text: `\n❌ 错误: ${err instanceof Error ? err.message : String(err)}\n` });
      }
      emit('done', {});
      return;
    }

    // AI classification for natural language input
    try {
      const state = readProjectState(getRoot());
      const classification = await deps.analysisTools.classifyTrpIntent(input, hasProject, state);

      if (classification.confirmation) {
        emit('token', { tokenType: 'Text', text: `🤖 ${classification.confirmation}\n\n` });
      }

      switch (classification.intent) {
        case 'init':
          await doInit(input, deps, emit, signal);
          return;
        case 'amend': {
          const targetPhase = classification.targetPhase as PhaseId
            || getFirstUnfinished(readProjectState(getRoot()))
            || '01_Survey';
          await doAmend(targetPhase, classification.amendment || input, deps, emit, signal);
          return;
        }
        case 'resume':
          await doResume(deps, emit, signal);
          return;
        case 'status':
          doStatus(emit);
          emit('done', {});
          return;
      }
    } catch {
      // AI classification failed, fallback to basic logic
      if (!hasProject) {
        await doInit(input, deps, emit, signal);
      } else {
        const nextPhase = getFirstUnfinished(readProjectState(getRoot())) || '01_Survey';
        await doAmend(nextPhase, input, deps, emit, signal);
      }
    }
  },
};