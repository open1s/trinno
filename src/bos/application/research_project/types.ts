export interface ResearchProjectConfig {
  name: string;
  problem: string;
  rootDir: string;
}

export type PhaseId = '00_Init' | '01_Survey' | '02_TRL' | '03_Analyze' | '04_Synthesize' | '05_Deliver' | '06_References';

export interface PhaseDef {
  id: PhaseId;
  title: string;
  titleZh: string;
  order: number;
}

export const ALL_PHASES: PhaseDef[] = [
  { id: '00_Init',       title: 'Init',             titleZh: '初始化与规划',       order: 0 },
  { id: '01_Survey',     title: 'Survey',           titleZh: '调研扫描',           order: 1 },
  { id: '02_TRL',        title: 'TRL Assessment',   titleZh: 'TRL 技术成熟度评估', order: 2 },
  { id: '03_Analyze',    title: 'Analyze',          titleZh: '分析解构',           order: 3 },
  { id: '04_Synthesize', title: 'Synthesize',       titleZh: '创新综合',           order: 4 },
  { id: '05_Deliver',    title: 'Deliver',          titleZh: '输出交付',           order: 5 },
  { id: '06_References', title: 'References',       titleZh: '文献资料管理',       order: 6 },
];

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'blocked';

export interface TaskDef {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  dependsOn?: string[];
  outputFile?: string;
}

export interface PhaseState {
  id: PhaseId;
  status: TaskStatus;
  completion: number;
  tasks: TaskDef[];
}

export interface ProjectState {
  name: string;
  problem: string;
  createdAt: string;
  updatedAt: string;
  phases: PhaseState[];
}

export interface TodoChange {
  phaseId: PhaseId;
  taskId: string;
  newStatus: TaskStatus;
  note?: string;
}
