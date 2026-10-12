// Runs the review queue through the judge and records a verdict per candidate.
// Needs credentials for one provider - Cloudflare Workers AI (clef), OpenAI
// Decisions, Vercel's AI Gateway, or TypeSafe directly - in the environment or in .env.local.
//
//   node tools/triage.js                 judge every unjudged candidate
//   node tools/triage.js --limit=120     judge the top 120 only
//   node tools/triage.js --force         re-judge candidates already judged
import { resolveEndpoint, evaluate, describeMissingKeys } from './lib/judge.js';
import { reviewQueue } from './lib/queue.js';
import { readJson, writeJson } from './lib/store.js';
import { log, today } from './lib/util.js';

const TOPIC = process.env.TOPIC || 'example';
const config = readJson(`topics/${TOPIC}.json`);
const judge = config.judge ?? {};

// The one sentence that defines the list. Everything else in this repository is
// plumbing; this is the editorial decision, so it lives in the topic config.
const CRITERION = judge.criterion;
if (!CRITERION) {
  console.error(`topics/${TOPIC}.json has no judge.criterion, so there is nothing to judge against.`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
};
const FORCE = argv.includes('--force');
const BATCH = flag('batch', 40);
const LIMIT = flag('limit', 0);

const endpoint = resolveEndpoint(judge);
if (!endpoint) {
  console.error(describeMissingKeys());
  process.exit(1);
}

const verdicts = readJson('data/triage.json', {});
const scope = argv.includes('--scope=queue') ? 'queue' : 'all';
let queue = reviewQueue({ scope }).filter((entry) => FORCE || !verdicts[entry.id]);
if (LIMIT) queue = queue.slice(0, LIMIT);

log(`judging ${queue.length} candidates via ${endpoint.via} (${endpoint.model})`);

function asState(batch) {
  return {
    criterion: CRITERION,
    repos: batch.map((entry, index) => ({
      ref: index,
      name: entry.name,
      description: (entry.description || '').slice(0, 200) || null,
      topics: (entry.topics || []).slice(0, 6),
      readme: (entry.readmeExcerpt || '').replace(/\s+/g, ' ').slice(0, 400) || null,
    })),
  };
}

function asQuestions(batch) {
  return Object.fromEntries(
    batch.map((entry, index) => [
      `q${index}`,
      { type: 'noul', instructions: `Apply \`criterion\` to \`repos[${index}]\` (${entry.name}).` },
    ]),
  );
}

let judged = 0;
let failed = 0;

for (let offset = 0; offset < queue.length; offset += BATCH) {
  const batch = queue.slice(offset, offset + BATCH);
  let answers;
  try {
    ({ answers } = await evaluate(asState(batch), asQuestions(batch), endpoint));
  } catch (err) {
    log(`batch at ${offset} failed: ${err.message}`);
    failed += batch.length;
    continue;
  }

  batch.forEach((entry, index) => {
    const answer = answers?.[`q${index}`];
    if (typeof answer?.noul !== 'number') return;
    verdicts[entry.id] = { noul: answer.noul, judgedAt: today(), model: endpoint.model };
    judged++;
  });

  writeJson('data/triage.json', verdicts);
  log(`  ${Math.min(offset + BATCH, queue.length)}/${queue.length} judged`);
}

const values = Object.values(verdicts).map((v) => v.noul);
log(
  `judged ${judged} this run (${failed} failed). Totals: ${values.filter((v) => v >= 0.75).length} clear, ` +
    `${values.filter((v) => v <= 0.45).length} rejected, ${values.filter((v) => v > 0.45 && v < 0.75).length} borderline.`,
);
log('next: node tools/triage-merge.js && node tools/rescore.js && node tools/render.js');
