#!/usr/bin/env bash
# verify-cold-start.sh — Extract and compare per-phase timing from logs
# Usage: bash scripts/verify-cold-start.sh [logfile]
# Defaults to ~/.trinno/logs/trinno.log

set -euo pipefail

LOG_FILE="${1:-$HOME/.trinno/logs/trinno.log}"

if [ ! -f "$LOG_FILE" ]; then
  echo "ERROR: log not found at $LOG_FILE"
  exit 1
fi

node -e "
const fs = require('fs');
const log = fs.readFileSync('$LOG_FILE', 'utf-8');

// Parse all [PHASE] entries
const phases = [];
for (const line of log.split('\\n').filter(Boolean)) {
  try {
    const o = JSON.parse(line);
    if (o.msg && (o.msg.includes('[PHASE]') || o.msg.includes('[COLD-START]'))) {
      phases.push(o);
    }
  } catch {}
}

if (phases.length === 0) {
  console.log('❌ No [PHASE] log entries found.');
  console.log('   The instrumentation was just added — you need to send a few');
  console.log('   chat messages and restart VS Code for data to appear.');
  process.exit(0);
}

console.log('');
console.log('=== Per-Message Phase Timing ===');
console.log('');

// Group by PID then by insertion order
const byPid = [];
let currentGroup = null;
let chatCount = 0;

for (const p of phases) {
  if (p.phase === 'deps-init' || p.phase === 'agent-start' || p.phase === 'stream-start' || p.phase === 'first-token') {
    if (p.phase === 'first-token') chatCount++;
    const key = p.pid + '-' + chatCount;
    if (!byPid[key]) byPid[key] = { pid: p.pid, seq: chatCount, phases: [], isNew: p.isNew };
    byPid[key].phases.push(p);
  }
}

const groups = Object.values(byPid);
groups.sort((a, b) => a.pid - b.pid || a.seq - b.seq);

// Show per-worker timeline
let lastPid = null;
for (const g of groups) {
  if (g.pid !== lastPid) {
    console.log('Worker PID ' + g.pid);
    lastPid = g.pid;
  }
  const tag = g.isNew ? ' [NEW AGENT]' : ' [REUSED]';
  console.log('  Msg #' + g.seq + tag);
  for (const p of g.phases) {
    console.log('    ' + p.phase + ': ' + (p.elapsedMs || 0) + 'ms' + (p.streamLatencyMs !== undefined ? ' (streamLatency=' + p.streamLatencyMs + 'ms)' : ''));
  }
  console.log('');
}

// Cold-start comparison: first message vs subsequent per PID
console.log('=== Cold-Start Analysis ===');
console.log('');

const pidGroups = {};
for (const g of groups) {
  if (!pidGroups[g.pid]) pidGroups[g.pid] = [];
  pidGroups[g.pid].push(g);
}

for (const [pid, msgs] of Object.entries(pidGroups)) {
  msgs.sort((a, b) => a.seq - b.seq);
  const firstToken = msgs.map(m => m.phases.find(p => p.phase === 'first-token'));
  
  if (firstToken.length < 2) {
    console.log('Worker ' + pid + ': only ' + firstToken.length + ' message(s) — need 2+ for comparison');
    continue;
  }

  const firstElapsed = firstToken[0]?.elapsedMs || 0;
  const restElapsed = firstToken.slice(1).map(p => p?.elapsedMs || 0);
  const avgRest = restElapsed.reduce((s, v) => s + v, 0) / restElapsed.length;
  const ratio = firstElapsed / avgRest;

  console.log('Worker ' + pid + ' (' + firstToken.length + ' msgs)');
  console.log('  1st msg total:    ' + firstElapsed + 'ms' + (msgs[0]?.isNew ? ' (new agent)' : ''));
  console.log('  Subsequent avg:   ' + avgRest.toFixed(0) + 'ms');
  console.log('  Ratio:            ' + ratio.toFixed(1) + 'x');
  
  if (firstElapsed > 10000 && ratio > 3) {
    console.log('  ▶ First msg is ' + ratio.toFixed(1) + 'x slower — likely cold start');
  } else if (firstElapsed > 10000) {
    console.log('  ▶ First msg is ' + firstElapsed + 'ms (slow startup)');
  } else {
    console.log('  ▶ No cold start detected (first=' + firstElapsed + 'ms, rest=' + avgRest.toFixed(0) + 'ms)');
  }
  console.log('');
}
"
