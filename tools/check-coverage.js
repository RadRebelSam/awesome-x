// Decides, per entry, whether any other public directory on this topic lists it.
//
// The previous version inferred this from absence: an entry was "only here"
// because nothing had ever marked it otherwise. That fails toward the
// flattering answer - a directory that changes its HTML, rate-limits us, or
// goes down silently promotes every entry to exclusive, and nothing complains.
//
// This version checks explicitly, records what it checked and when, and refuses
// to answer at all when the evidence is bad.
import { extractRepos, fetchText } from './lib/web.js';
import { readJson, writeJson, loadRegistry, saveRegistry } from './lib/store.js';
import { log, today } from './lib/util.js';

const TOPIC = process.env.TOPIC || 'example';
const config = readJson(`topics/${TOPIC}.json`);
const coverage = config.site?.coverage ?? {};
const MIN_LIST_STARS = coverage.minListStars ?? 20;
const MAX_LIST_SOURCES = coverage.maxListSources ?? 12;
// A source that returns far less than it usually does is broken, not emptier.
const COLLAPSE_RATIO = coverage.collapseRatio ?? 0.5;

const { byId } = loadRegistry('data/registry.json');
const entries = [...byId.values()];
const history = readJson('data/coverage.json', { runs: [], sources: {} });

// Sources are the two directory sites, plus the largest list repositories the
// crawler already tracks. Those are the lists a reader would actually compare
// against, and their readmes are free to fetch.
const webSources = (config.search?.webSources ?? []).map((s) => ({
  name: s.name,
  url: s.url,
  kind: 'site',
}));

// Status is deliberately ignored here. A rival list is rejected as an *entry* -
// it does not meet the criterion - but it is what this check compares against.
const listSources = entries
  .filter((e) => e.category === 'lists' && e.source === 'github')
  .filter((e) => e.name !== config.site?.repository)
  .filter((e) => (e.stars ?? 0) >= MIN_LIST_STARS)
  .sort((a, b) => b.stars - a.stars)
  .slice(0, MAX_LIST_SOURCES)
  .map((e) => ({
    name: e.name,
    url: `https://raw.githubusercontent.com/${e.name}/HEAD/README.md`,
    kind: 'list',
  }));

const sources = [...webSources, ...listSources];
log(`checking ${sources.length} sources: ${sources.map((s) => s.name).join(', ')}`);

const results = [];
for (const source of sources) {
  try {
    const text = await fetchText(source.url, source.name);
    const names = extractRepos(text);
    const previous = history.sources[source.name]?.counts ?? [];
    const median = previous.length
      ? [...previous].sort((a, b) => a - b)[Math.floor(previous.length / 2)]
      : null;
    const collapsed = median !== null && names.length < median * COLLAPSE_RATIO;
    const healthy = names.length > 0 && !collapsed;

    results.push({ source, names: new Set(names.map((n) => n.toLowerCase())), healthy, count: names.length });
    log(`  ${source.name}: ${names.length} links${healthy ? '' : collapsed ? '  COLLAPSED vs median ' + median : '  EMPTY'}`);
  } catch (err) {
    results.push({ source, names: new Set(), healthy: false, count: 0, error: err.message });
    log(`  ${source.name}: failed - ${err.message.slice(0, 80)}`);
  }
}

const healthy = results.filter((r) => r.healthy);
const allHealthy = healthy.length === results.length;

if (!healthy.length) {
  log('every source failed; leaving the previous verdicts untouched');
  process.exit(0);
}

let flipped = 0;
for (const entry of entries) {
  if (entry.source !== 'github') continue;
  const key = entry.name.toLowerCase();
  const foundIn = healthy.filter((r) => r.names.has(key)).map((r) => r.source.name);

  const wasExclusive = !(entry.foundIn ?? entry.discoveredVia ?? []).length;
  const isExclusive = foundIn.length === 0;
  if (wasExclusive !== isExclusive) flipped++;

  // Union with anything a previous healthy run found: a directory dropping an
  // entry is not evidence it was never there, and this only ever costs us the
  // exclusivity claim, which is the safe direction to be wrong in.
  entry.foundIn = [...new Set([...(entry.foundIn ?? []), ...(entry.discoveredVia ?? []), ...foundIn])];
  entry.coverageCheckedAt = today();
  // Only a run where every source answered can support the stronger claim.
  entry.coverageComplete = allHealthy;
}

history.sources = history.sources ?? {};
for (const r of results) {
  const prev = history.sources[r.source.name]?.counts ?? [];
  history.sources[r.source.name] = {
    kind: r.source.kind,
    lastCount: r.count,
    lastHealthy: r.healthy,
    lastError: r.error ?? null,
    counts: [...prev, r.count].slice(-30),
  };
}
history.runs = [...(history.runs ?? []), {
  on: today(),
  sourcesChecked: results.length,
  sourcesHealthy: healthy.length,
  complete: allHealthy,
}].slice(-60);

writeJson('data/coverage.json', history);
saveRegistry('data/registry.json', byId);

const listed = entries.filter((e) => e.status === 'approved');
const exclusive = listed.filter((e) => !(e.foundIn ?? []).length).length;
log(
  `${healthy.length}/${results.length} sources healthy, ${flipped} entries changed verdict, ` +
    `${exclusive} of ${listed.length} listed entries appear in none of them`,
);
if (!allHealthy) log('run incomplete: the site will describe coverage as partial until every source answers');
