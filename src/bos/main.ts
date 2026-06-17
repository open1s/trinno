import { composeRoot } from './infrastructure/config/di.js';
import { createModuleLogger } from './infrastructure/logging/logger.js';

const log = createModuleLogger('main');
log.level = 'info';

async function main() {
  log.info('=== TRIZ Methodology Library with AI-Powered Domain Analysis ===');

  const deps = await composeRoot();

  log.info('1. Analyzing contradiction: Speed vs Force');
  const result = await deps.analyzeContradictionHandler.execute({
    improvingParameter: 9,
    worseningParameter: 10,
    description: 'Need higher processing speed but increased force causes wear',
    type: 'technical',
  });

  log.info({ contradictionId: result.contradictionId }, 'Contradiction ID');
  log.info('Recommended Principles:');
  for (const p of result.recommendedPrinciples) {
    log.info({ index: p.index, name: p.name }, `#${p.index}: ${p.name} - ${p.description}`);
  }

  log.info('2. Generating AI-enhanced solutions...');
  const solutions = await deps.generateSolutionsHandler.execute({
    contradictionId: result.contradictionId,
    aiEnhanced: false,
  });

  log.info('Generated Solutions:');
  for (const s of solutions.solutions) {
    log.info({ principleName: s.principleName }, `[${s.principleName}] ${s.description}`);
  }

  log.info('3. Searching principles for "segmentation"...');
  const searchResults = deps.principleEngine.searchPrinciples('segmentation');
  for (const p of searchResults) {
    log.info({ index: p.index, name: p.name }, `#${p.index}: ${p.name}`);
  }

  log.info('4. Evaluating ideality...');
  const ideality = await deps.idealityHandler.execute({
    problemId: 'prob_1',
    benefits: ['Faster processing', 'Lower latency', 'Better throughput'],
    costs: ['Higher energy consumption', 'More cooling needed'],
    harms: ['Increased wear on components'],
  });

  log.info({ score: ideality.ideality.score, level: ideality.ideality.level }, 'Ideality Score & Level');
  log.info('Recommendations:');
  for (const r of ideality.ideality.recommendations) {
    log.info({ recommendation: r }, `- ${r}`);
  }

  log.info('5. Available EZBOS Tools:');
  for (const tool of deps.tools) {
    log.info({ toolName: tool.name }, `- ${tool.name}: ${tool.description}`);
  }

  log.info('6. S-Curve Analysis: Battery Technology');
  const sCurveResult = await deps.sCurveHandler.execute({
    technologyName: 'Lithium-ion Batteries',
    performanceMetric: 'Wh/kg',
    dataPoints: [
      { x: 2010, y: 80 },
      { x: 2013, y: 120 },
      { x: 2016, y: 160 },
      { x: 2019, y: 200 },
      { x: 2022, y: 240 },
      { x: 2025, y: 265 },
    ],
  });

  log.info({ chart: sCurveResult.unicodeChart }, 'S-Curve Chart');
  log.info({ s1Stage: sCurveResult.s1Stage, s2Stage: sCurveResult.s2Stage }, 'Stages');
  log.info({ crossoverYear: sCurveResult.crossoverYear }, 'Crossover Year');
  if (sCurveResult.s1TRL) {
    log.info({ trl: sCurveResult.s1TRL.level, title: sCurveResult.s1TRL.title }, 'S1 TRL');
  }
  if (sCurveResult.s2TRLRange) {
    log.info({ min: sCurveResult.s2TRLRange.min, max: sCurveResult.s2TRLRange.max }, 'S2 TRL Range');
  }
  log.info('Recommendations:');
  for (const r of sCurveResult.recommendations) {
    log.info({ recommendation: r }, `  ${r}`);
  }

  log.info('=== TRIZ Library Ready ===');
  log.info('Use the tools with an EZBOS AgentBuilder:');
  log.info('  const agent = new AgentBuilder("triz-agent")');
  log.info('    .with_tools(...deps.tools)');
  log.info('    .start();');

  await deps.aiAgent.close();
  await deps.brain.stop();
}

main().catch((err) => { log.error({ err }, 'main failed'); });
