import * as fs from 'fs';
import * as path from 'path';
import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';

const PHASE_DIRS = [
  '01_Discover',
  '02_TRL',
  '03_Analyze',
  '04_Synthesize',
  '05_Deliver',
  '06_References',
  '07_Patent',
] as const;

type PhaseDir = typeof PHASE_DIRS[number];

interface PhaseInfo {
  dir: PhaseDir;
  title: string;
  purpose: string;
  bullets: string[];
  commands: string;
  methodology: string[];
  antiPatterns: string[];
}

const PHASE_INFO: Record<PhaseDir, PhaseInfo> = {
  '01_Discover': {
    dir: '01_Discover',
    title: '01_Discover — Exploration & problem framing',
    purpose: 'Free-form exploration. Everything you chat about with the AI before you commit to a structured analysis lands here.',
    bullets: [
      'Free-form notes, scope discussions, brainstorming with the AI.',
      'Problem statement drafts, stakeholder maps, raw interview snippets.',
      'Anything you want to remember from early conversations.',
    ],
    commands: 'No slash command writes here directly. Use the Trinno chat panel; the AI auto-saves key points.',
    methodology: [
      '**Frame before solving.** Write a one-paragraph problem statement: who has the pain, what is the cost of inaction, and what does "solved" look like. If you can\'t fill all three, you don\'t yet have a problem.',
      '**Talk to 3+ stakeholders** with different lenses (operator, regulator, payer). Disagreements between them are usually the actual problem.',
      '**Read 1 paper from each adjacent field.** A solution in aerospace, biology, or software often ports over. The most original ideas are usually importations, not inventions.',
      '**Capture the "why now?"** What changed in the last 2 years (cost curve, regulation, new theory) that makes this problem solvable today? Without that, the timing is wrong.',
      '**Time-box.** Set a hard deadline (usually 1–3 days of focused work) to move from Discover to Analyze. Endless exploration is a sign of avoidance, not depth.',
      '**Keep a question log.** Every open question goes here with an owner. Review the log before moving to the next phase — every unanswered question is a risk.',
    ],
    antiPatterns: [
      'Anchoring on the first solution you hear. The first idea is rarely the best.',
      'Treating "I\'d buy that" as validation. Customers are bad at predicting their own behavior; ask about past spend.',
      'Skipping the failure-mode brainstorm. If you can\'t name 3 ways the idea could fail, you don\'t understand it.',
    ],
  },
  '02_TRL': {
    dir: '02_TRL',
    title: '02_TRL — Maturity & S-curve',
    purpose: 'Technology Readiness Level (TRL) assessments and S-curve positioning for your technology and adjacent ones.',
    bullets: [
      'One file per technology, containing the S-curve chart, stage detection, and recommendations.',
      'Use to argue why your topic is on a growth, maturity, or decline curve.',
      'Helps decide whether to invest in the current S-curve or pivot to a next-gen one.',
    ],
    commands: '`/s-curve "<topic>" <param> <TRL>` — one file per run, named `s_curve_<topic>_<timestamp>.json`.',
    methodology: [
      '**Use the NASA TRL scale (1–9) consistently.** 1=basic principles observed, 3=proof of concept, 6=demo in relevant environment, 9=proven in operational environment. Resist the urge to inflate; reviewers can tell.',
      '**Pick the right metric.** The metric on the y-axis must be the one the field actually optimizes (e.g., Wh/kg for batteries, $/Mbps for telecom, MTBF for storage). Convenience metrics lie.',
      '**Plot at least 5 historical data points.** Two points is a line, not a curve. Use peer-reviewed data, patents, or industry reports — not vendor decks.',
      '**Look for the "S" inflection.** A logistic curve has 4 stages: embryonic, growth, maturity, decline. The crossover between growth→maturity is where ROI plummets for new entrants.',
      '**Always compare to the next-gen S-curve.** The dominant question is "is this S1 or already-S2?" — incumbents on a dying S1 lose to challengers on a young S2.',
      '**Re-assess every 6 months.** TRL claims decay. A 2023 TRL 6 is not a 2025 TRL 6 — the field has moved.',
    ],
    antiPatterns: [
      'Letting proponents set the TRL. The technology owner always rates higher than the independent assessor.',
      'Confusing engineering maturity with market maturity. A tech can be TRL 9 and still commercially unviable.',
      'Using the same metric across technologies. Comparing batteries by Wh/kg and motors by RPM is meaningless.',
    ],
  },
  '03_Analyze': {
    dir: '03_Analyze',
    title: '03_Analyze — Contradictions, ideality, Su-Field',
    purpose: 'Structured TRIZ analysis artifacts. The three core techniques for finding the root cause of a problem.',
    bullets: [
      '**Contradictions** — technical (`improving` vs `worsening` parameter) and physical (one part needs two opposing states).',
      '**Ideality** — score Benefits / (Costs + Harms); track dominant factor and confidence.',
      '**Su-Field** — Substance-Field decomposition with the 76 standard solutions for harmful / insufficient / excessive / complete models.',
    ],
    commands: '`/contradiction <i> vs <j> [desc]` · `/ideality benefits:… costs:… harms:…` · `/su-field <s1> <s2> <field> [type]`',
    methodology: [
      '**Start with contradictions, not solutions.** If you can\'t state the contradiction, you don\'t have a problem — you have a complaint.',
      '**Distinguish technical vs physical.** Technical = two parameters trade off (e.g., weight vs strength). Physical = one part must have two opposing properties (e.g., rigid AND flexible in the same region). The 39 parameters only handle technical — physical needs the separation-in-time/space principles.',
      '**Score ideality with numbers, not adjectives.** "Heavy" → weight in kg; "expensive" → cost in $. Adjectives hide what you can\'t actually measure.',
      '**Be brutal about harms.** Every solution has side effects. If the harm list is empty, you haven\'t thought hard enough.',
      '**Build the complete Su-Field first.** A working system has S1 (tool), S2 (object), F (field). If you can\'t draw all three, the model is incomplete — fix that before adding "harmful" or "insufficient".',
      '**Generate at least 3 candidate solutions per problem.** Quantity breeds quality; the third idea is usually better than the first.',
    ],
    antiPatterns: [
      'Treating "no contradiction found" as success. Often it means the problem is under-specified — dig deeper.',
      'Skipping the harm list to make a solution look better. The ideality score will punish you anyway.',
      'Picking one inventive principle from the matrix and stopping. The matrix is a starting set, not the answer.',
    ],
  },
  '04_Synthesize': {
    dir: '04_Synthesize',
    title: '04_Synthesize — Inventive principles & solutions',
    purpose: 'Generated solution candidates. Outputs from the principle engine and synthesis tools.',
    bullets: [
      '40 TRIZ inventive principles — search by keyword or browse full list.',
      'Solution candidates generated from contradiction analysis.',
      'Notes on which principle fits the current problem and why.',
    ],
    commands: '`/principles search <keyword>` · `/principles list` · `/principles <number>`',
    methodology: [
      '**Read the full principle, not just the name.** "Segmentation" and "Taking out" look similar but solve different problems. Skim 1–2 examples per principle to see if it fits.',
      '**Combine 2–3 principles.** Most real innovations use 2–3 inventive principles together (e.g., segmentation + dynamization). Single-principle solutions tend to be incremental.',
      '**Generate broadly before evaluating.** Make 5–10 candidates first; kill them in a later phase. Filtering while generating kills creativity.',
      '**Map each candidate back to the contradiction it solves.** If a candidate doesn\'t address a contradiction you named, it\'s a different idea — note it separately or drop it.',
      '**Prefer principles that are sub-system local.** Changes confined to one component are easier to prototype and less risky than whole-architecture changes.',
      '**Use the AI to brainstorm at the sub-principle level.** Once you\'ve picked a principle, ask "what are 5 ways to apply segmentation here?" — that\'s where the real novelty lives.',
    ],
    antiPatterns: [
      'Picking the principle with the highest matrix count. Frequency ≠ fit; the rare 4x4 hit can be the breakthrough.',
      'Falling in love with one candidate before evaluation. Selection criteria live in 05_Deliver — don\'t pre-judge.',
      'Treating the principle as the answer. The principle is the lever; you still have to design the actual mechanism.',
    ],
  },
  '05_Deliver': {
    dir: '05_Deliver',
    title: '05_Deliver — Selected concepts & prototype plans',
    purpose: 'What survives the funnel. The chosen solutions, with rationale, risk, and a path to a working prototype.',
    bullets: [
      'Selected concept(s) from 04_Synthesize, with rejection notes for the rest.',
      'Prototype plan: bill of materials, fabrication method, test plan.',
      'Risk register: failure modes, mitigations, go/no-go criteria.',
    ],
    commands: 'No slash command writes here directly. Add files manually as you make selection decisions.',
    methodology: [
      '**Use a weighted Pugh matrix** to score candidates on the same criteria (cost, risk, time-to-prototype, alignment with stakeholders). Don\'t skip weighting — equal weights hide what actually matters.',
      '**Prototype the riskiest assumption first**, not the whole concept. If the highest-risk part fails, you want to know in week 2, not month 6.',
      '**Set go/no-go criteria up front.** Decide now what result will make you kill the concept. Post-hoc decisions are sunk-cost decisions.',
      '**Build the cheapest prototype that answers the key question.** Foam-core mockup before CAD, CAD before CNC, CNC before injection mold. Each fidelity jump costs 10x.',
      '**Document rejected concepts.** A "rejection journal" is gold 6 months later when the requirements change and yesterday\'s no is today\'s yes.',
      '**Plan the test before building the prototype.** If you don\'t know how you\'ll measure success, you\'re not prototyping — you\'re tinkering.',
    ],
    antiPatterns: [
      'Selecting the most innovative concept. Innovation is a cost, not a benefit — choose the lowest-risk concept that meets the success criteria.',
      'Skipping the risk register. Every prototype has a "thing that will go wrong" — name it before it surprises you.',
      'Building in secret. Show the prototype to a skeptic in week 1; their questions reveal gaps you\'re blind to.',
    ],
  },
  '06_References': {
    dir: '06_References',
    title: '06_References — Literature & downloaded papers',
    purpose: 'Everything you read, search, or download. Search results and full-text PDFs/documents.',
    bullets: [
      'Search-result JSON files from `/search`.',
      'Downloaded papers (PDF, DOCX, HTML, EPUB, etc.) from `/download` and `papers_download`.',
      'Notes pulled from the AI\'s reading of these papers.',
    ],
    commands: '`/search <query> [limit N]` · `/download <doi|arxiv|url>` · `papers_download` tool from chat',
    methodology: [
      '**Snowball from one good paper.** Found a great paper? Read its references (backward) and its citing articles (forward). The 5th iteration usually finds the real breakthroughs.',
      '**Triangulate every key claim.** 3+ independent sources for any claim that drives a design decision. One paper is a hypothesis; three is a fact.',
      '**Skim-abstract, deep-read intro+conclusion first.** Most papers are 80% routine method, 20% insight. The insight lives in intro and conclusion.',
      '**Read methods only if you\'ll replicate.** If you\'re using the result, not reproducing it, methods is skimmed at best.',
      '**Check for predatory venues.** Journal name unfamiliar + no DOI prefix + email-only contact = suspect. Use the Beall\'s list or your field\'s equivalent.',
      '**Maintain a citation graph in your head.** When you cite paper A in 03_Analyze, also note paper B that refutes A. Disagreements in the literature are research opportunities.',
    ],
    antiPatterns: [
      'Stopping at the first result. First-page Google results are usually the most-cited, not the most relevant — and citation count ≠ correctness.',
      'Reading only abstracts. The most-cited findings are sometimes the ones the authors retracted in a footnote on page 7.',
      'Citing without reading. AI summaries are a starting point, never the citation. Always check the primary source.',
    ],
  },
  '07_Patent': {
    dir: '07_Patent',
    title: '07_Patent — Patent drafts',
    purpose: 'Patent applications built incrementally by the AI. Each section is drafted in its own turn so you can review before the next.',
    bullets: [
      'Claims (independent + dependent).',
      'Abstract, background, summary, detailed description, drawings notes.',
      'Prior-art citations pulled from 06_References.',
    ],
    commands: '`/patent "<topic>"` — starts a new draft. Re-run with the same topic to append the next section.',
    methodology: [
      '**Write claims first, then description.** Claims define what you\'re actually patenting. Everything else (abstract, background, detailed description) exists to support the claims\' validity.',
      '**Distinguish independent vs dependent claims.** Independent = stands alone. Dependent = narrows an independent claim and adds fall-back positions if the independent is invalidated.',
      '**Do a real prior-art search before drafting.** Use 06_References. If you can\'t find anything similar, you haven\'t searched hard enough — change keywords, fields, languages.',
      '**Follow the standard order.** Background → Summary → Brief Description of Drawings → Detailed Description → Claims. Examiners expect this structure; deviating raises red flags.',
      '**Use the "person having ordinary skill in the art" test.** Write enough detail that a skilled practitioner can reproduce your invention without inventing anything new themselves. Less = unenforceable; more = unnecessary disclosure.',
      '**One concept per patent.** Filing three narrow patents > one broad one. Broad claims are easier to invalidate; narrow ones survive.',
    ],
    antiPatterns: [
      'Drafting the description before the claims. You\'ll write 10 pages of beautiful prose around claims you didn\'t actually want.',
      'Skipping dependent claims. They\'re your fallback when an examiner invalidates the independent claim — without them you have no second line of defense.',
      'Disclosing trade secrets in the description. Once filed, the patent is public. Anything in the spec is no longer secret.',
    ],
  },
};

export const initCommand: SlashCommand = {
  name: 'init',
  description: 'Initialize a Trinno research workspace (creates 7 phase folders, each with a README)',
  usage: '/init [project name] [optional one-line goal]',
  async execute(args, deps, emit, _signal) {
    const root = deps.phaseWriter.getWorkspaceRoot();
    if (!root) {
      emit('token', {
        tokenType: 'Text',
        text: [
          '**Trinno workspace is not set.**',
          '',
          '1. Open the folder where you want to run your research (Command Palette → **File: Open Folder**).',
          '2. Run **Trinno: Set Workspace** from the Command Palette, or set `trinno.chat.trpWorkspace` in VS Code settings to that folder\'s absolute path.',
          '3. Re-run `/init` from the Trinno chat panel.',
        ].join('\n'),
      });
      emit('done', {});
      return;
    }

    const parsed = parseInitArgs(args.trim());
    const projectName = parsed.name || path.basename(root) || 'Untitled Project';
    const goal = parsed.goal || '';

    const created: string[] = [];
    const existing: string[] = [];
    for (const dir of PHASE_DIRS) {
      const full = path.join(root, dir);
      if (fs.existsSync(full)) {
        existing.push(dir);
      } else {
        fs.mkdirSync(full, { recursive: true });
        created.push(dir);
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const rootReadmePath = path.join(root, 'README.md');
    const rootReadmeExisted = fs.existsSync(rootReadmePath);
    if (!rootReadmeExisted) {
      fs.writeFileSync(rootReadmePath, buildRootReadme(projectName, goal, today, root), 'utf-8');
    }

    const phaseReadmes: { phase: string; created: boolean }[] = [];
    for (const phase of PHASE_DIRS) {
      const phaseReadmePath = path.join(root, phase, 'README.md');
      const phaseExisted = fs.existsSync(phaseReadmePath);
      if (!phaseExisted) {
        fs.writeFileSync(phaseReadmePath, buildPhaseReadme(phase, projectName, rootReadmeExisted), 'utf-8');
      }
      phaseReadmes.push({ phase, created: !phaseExisted });
    }

    const initRecord = {
      projectName,
      goal,
      workspaceRoot: root,
      createdDirs: created,
      existingDirs: existing,
      rootReadmeCreated: !rootReadmeExisted,
      phaseReadmes,
      initializedAt: new Date().toISOString(),
    };
    deps.phaseWriter.write({
      phase: '01_Discover',
      name: 'init',
      data: initRecord,
      format: 'json',
    });

    const lines: string[] = [];
    lines.push('## Trinno workspace initialized\n');
    lines.push(`**Project:** ${projectName}`);
    if (goal) lines.push(`**Goal:** ${goal}`);
    lines.push(`**Workspace:** \`${root}\``);
    lines.push('');
    lines.push('**Folders:**');
    if (created.length) lines.push(`- created: ${created.map(d => `\`${d}\``).join(', ')}`);
    if (existing.length) lines.push(`- already existed: ${existing.map(d => `\`${d}\``).join(', ')}`);
    lines.push(`- root README: ${rootReadmeExisted ? 'kept existing' : 'created'}`);
    const phaseReadmeCreated = phaseReadmes.filter(p => p.created).map(p => `\`${p.phase}\``).join(', ');
    const phaseReadmeKept = phaseReadmes.filter(p => !p.created).map(p => `\`${p.phase}\``).join(', ');
    if (phaseReadmeCreated) lines.push(`- phase READMEs created: ${phaseReadmeCreated}`);
    if (phaseReadmeKept) lines.push(`- phase READMEs kept: ${phaseReadmeKept}`);
    lines.push('');
    lines.push('### Suggested next steps');
    lines.push('1. Edit `README.md` to fill in the problem statement and success criteria.');
    lines.push('2. Chat with the AI to scope the problem — anything you say goes into `01_Discover/`.');
    lines.push('3. Run `/s-curve "<topic>" <param> <TRL>` to place your topic on the maturity curve.');
    lines.push('4. Use `/contradiction`, `/ideality`, `/su-field` as the problem crystallizes.');
    lines.push('5. `/search` to pull literature into `06_References/`; `/download <doi>` to grab a paper.');
    lines.push('6. `/patent "<topic>"` drafts a patent into `07_Patent/` when you\'re ready.');
    lines.push('');
    lines.push('Re-running `/init` is safe — it will not overwrite anything.');

    emit('token', { tokenType: 'Text', text: lines.join('\n') });
    emit('done', {});
  },
};

interface InitArgs {
  name: string;
  goal: string;
}

function parseInitArgs(raw: string): InitArgs {
  if (!raw) return { name: '', goal: '' };
  const m = raw.match(/^"([^"]+)"(?:\s+(.+))?$/);
  if (m) return { name: m[1] ?? '', goal: (m[2] ?? '').trim() };
  const tokens = raw.split(/\s+/);
  return { name: tokens[0] ?? '', goal: tokens.slice(1).join(' ').trim() };
}

function buildRootReadme(name: string, goal: string, today: string, root: string): string {
  return [
    `# ${name}`,
    '',
    goal ? `> ${goal}` : '> _One-line problem statement / research goal goes here._',
    '',
    `Trinno research workspace — initialized ${today}.`,
    '',
    '## Phase folders',
    '',
    '| Folder | Purpose | Read me |',
    '|---|---|---|',
    '| `01_Discover/` | Free-form exploration, problem framing. | [`01_Discover/README.md`](01_Discover/README.md) |',
    '| `02_TRL/` | S-curve / TRL maturity assessments. | [`02_TRL/README.md`](02_TRL/README.md) |',
    '| `03_Analyze/` | Contradictions, ideality scores, Su-Field decompositions. | [`03_Analyze/README.md`](03_Analyze/README.md) |',
    '| `04_Synthesize/` | Inventive principles, solution candidates. | [`04_Synthesize/README.md`](04_Synthesize/README.md) |',
    '| `05_Deliver/` | Selected concepts, prototype plans. | [`05_Deliver/README.md`](05_Deliver/README.md) |',
    '| `06_References/` | Literature search results, downloaded papers. | [`06_References/README.md`](06_References/README.md) |',
    '| `07_Patent/` | Patent drafts. | [`07_Patent/README.md`](07_Patent/README.md) |',
    '',
    '## Problem statement',
    '',
    '_Describe the technical problem in 1–3 paragraphs. What are the stakes? Who is affected?_',
    '',
    '## Success criteria',
    '',
    '_What does "solved" look like? Quantitative targets, constraints, and non-goals._',
    '',
    '## Stakeholders',
    '',
    '_Who cares about the outcome? End users, regulators, suppliers, internal sponsors._',
    '',
    '## Constraints & assumptions',
    '',
    '_Cost, weight, environment, regulation, available materials, prior art to avoid._',
    '',
    '## Notes',
    '',
    `- Workspace path: \`${root}\``,
    '- Each `/command` you run writes a timestamped file into the matching phase folder.',
    '- Each phase folder has its own `README.md` describing what it\'s for and which commands populate it.',
    '- Re-run `/init` to add missing folders or READMEs — it never overwrites existing files.',
    '',
  ].join('\n');
}

function buildPhaseReadme(phase: PhaseDir, projectName: string, rootReadmeExisted: boolean): string {
  const info = PHASE_INFO[phase];
  const bullets = info.bullets.map(b => `- ${b}`).join('\n');
  const methodology = info.methodology.map(m => `- ${m}`).join('\n');
  const antiPatterns = info.antiPatterns.map(a => `- ${a}`).join('\n');
  const rootLink = rootReadmeExisted
    ? '[← Back to workspace root](../README.md)'
    : '[← Back to workspace root](../)';
  return [
    `# ${info.title}`,
    '',
    `_Project: **${projectName}**_`,
    '',
    '## Purpose',
    '',
    info.purpose,
    '',
    '## What goes here',
    '',
    bullets,
    '',
    '## Commands that populate this folder',
    '',
    info.commands,
    '',
    '## Research methodology — best practice',
    '',
    'How to actually do the work in this phase, not just what to file.',
    '',
    methodology,
    '',
    '## Anti-patterns to avoid',
    '',
    'Common failure modes. Skim before you start; re-read before you finish.',
    '',
    antiPatterns,
    '',
    '## File naming',
    '',
    'Slash commands write timestamped files in the form `<name>_<ISO-timestamp>.{json,md}`. Files sort newest-first, so the most recent run is always at the top of any directory listing.',
    '',
    '---',
    '',
    rootLink,
    '',
  ].join('\n');
}
