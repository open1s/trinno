import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../logging/logger.js';

const log = createModuleLogger('phase-writer');

export type PhaseDir =
  | '01_Discover'
  | '02_TRL'
  | '03_Analyze'
  | '04_Synthesize'
  | '05_Deliver'
  | '06_References'
  | '07_Patent';

export type PhaseFormat = 'json' | 'markdown' | 'svg';

export interface PhaseWriteResult {
  phase: PhaseDir;
  filePath: string;
  format: PhaseFormat;
  writtenAt: string;
}

export class PhaseWriter {
  constructor(private workspaceRoot?: string) {}

  isEnabled(): boolean {
    return Boolean(this.workspaceRoot && this.workspaceRoot.length > 0);
  }

  getWorkspaceRoot(): string | undefined {
    return this.workspaceRoot;
  }

  write(opts: {
    phase: PhaseDir;
    name: string;
    data: unknown;
    format?: PhaseFormat;
    suffix?: string;
  }): PhaseWriteResult | null {
    if (!this.isEnabled()) return null;

    const format = opts.format ?? 'json';
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = this.sanitize(opts.name);
    const safeSuffix = opts.suffix ? this.sanitize(opts.suffix) : '';
    const ext = format === 'svg' ? 'svg' : format === 'markdown' ? 'md' : 'json';
    const base = safeSuffix ? `${safeName}_${safeSuffix}` : safeName;
    const filename = `${base}_${ts}.${ext}`;
    const dir = path.join(this.workspaceRoot!, opts.phase);

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const filePath = path.join(dir, filename);
      const body = format === 'svg' ? (typeof opts.data === 'string' ? opts.data : String(opts.data)) : format === 'markdown'
        ? (typeof opts.data === 'string' ? opts.data : this.toMarkdown(opts.data))
        : JSON.stringify(opts.data, null, 2);
      fs.writeFileSync(filePath, body, 'utf-8');
      return {
        phase: opts.phase,
        filePath,
        format,
        writtenAt: new Date().toISOString(),
      };
    } catch (err) {
      log.error({ err, phase: opts.phase, filename }, 'failed to write phase file');
      return null;
    }
  }

  private sanitize(text: string): string {
    const cleaned = text
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80);
    return cleaned || 'untitled';
  }

  private toMarkdown(data: unknown): string {
    return '```json\n' + JSON.stringify(data, null, 2) + '\n```';
  }
}

export const PHASE_BY_COMMAND: Record<string, { phase: PhaseDir; suffix: string; format: PhaseFormat }> = {
  contradiction: { phase: '03_Analyze', suffix: 'contradiction', format: 'json' },
  contradictionAI: { phase: '03_Analyze', suffix: 'contradiction_ai', format: 'json' },
  sCurve: { phase: '02_TRL', suffix: 's_curve', format: 'json' },
  ideality: { phase: '03_Analyze', suffix: 'ideality', format: 'json' },
  suField: { phase: '03_Analyze', suffix: 'su_field', format: 'json' },
  search: { phase: '06_References', suffix: 'search', format: 'json' },
  principles: { phase: '04_Synthesize', suffix: 'principles', format: 'markdown' },
};
