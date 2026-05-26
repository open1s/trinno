import { composeRoot } from '../infrastructure/config/di.js';

async function main() {
  console.log('=== E2E Search Test ===\n');

  const start = Date.now();
  const deps = await composeRoot();

  console.log('Problem: "lithium battery cathode"\n');

  const result = await deps.aiResearchOrchestrator.research(
    'lithium battery cathode',
    {
      maxSearchResults: 1,
      onProgress: (phase, msg) => console.log(`  [${phase}] ${msg}`),
      showThinking: false,
    },
  );

  const elapsed = Math.round((Date.now() - start) / 1000);

  console.log('\n' + '='.repeat(50));
  console.log('RESULTS:');
  for (const type of ['patents', 'papers', 'techSolutions'] as const) {
    const items = result.priorArt[type];
    console.log(`  ${type}: ${items.length}`);
    for (const p of items) {
      console.log(`    - ${p.title}`);
      console.log(`      Snippet: ${(p.snippet || '').slice(0, 150)}`);
    }
  }
  console.log('\nMETADATA:');
  console.log('  Duration:', elapsed, 's');
  console.log('  AI calls:', result.metadata?.aiCallsMade);
  console.log('  Sources used:', result.metadata?.sourcesUsed?.join(', '));
  console.log('  Errors:', result.errors?.length);
  for (const e of result.errors || []) {
    console.log(`    [${e.severity}] ${e.component}: ${e.message}`);
  }
  console.log('\nREPORT (first 800 chars):');
  console.log((result.summary || '(empty)').slice(0, 800));

  await deps.aiResearchOrchestrator.close();
  await deps.brain.stop();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
