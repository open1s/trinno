import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface MilestoneRawFact {
  year: number;
  label: string;
  description: string;
  type: string;
  rawFact: string;
}

export interface SCurveRawFacts {
  technologyName: string;
  performanceMetric: string;
  timestamp: string;
  rawResponse?: string | undefined;
  searchSnippets?: Array<{ title: string; snippet: string; url: string; date: string }> | undefined;
  milestones: MilestoneRawFact[];
}

export class RawFactsSaver {
  private outputDir: string;

  constructor(outputDir?: string) {
    this.outputDir = outputDir || join(process.cwd(), 'output');
  }

  async saveFacts(facts: SCurveRawFacts): Promise<string> {
    mkdirSync(this.outputDir, { recursive: true });

    const timestamp = facts.timestamp || new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = facts.technologyName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    const filename = `facts_${safeName}_${timestamp}.json`;
    const filepath = join(this.outputDir, filename);

    const content = JSON.stringify(facts, null, 2);
    writeFileSync(filepath, content, 'utf-8');

    return filepath;
  }

  async saveMilestoneFacts(
    technologyName: string,
    performanceMetric: string,
    milestones: MilestoneRawFact[],
    rawResponse?: string,
    searchSnippets?: Array<{ title: string; snippet: string; url: string; date: string }>,
  ): Promise<string> {
    return this.saveFacts({
      technologyName,
      performanceMetric,
      timestamp: new Date().toISOString(),
      rawResponse,
      searchSnippets,
      milestones,
    });
  }
}
