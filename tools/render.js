// Turns data/registry.json into the list in README.md. The generated block sits
// between markers so the hand-written parts of the README are never touched.
import { readFileSync, writeFileSync } from 'node:fs';
import { readJson, starDelta } from './lib/store.js';
import { daysSince, today } from './lib/util.js';

const TOPIC = process.env.TOPIC || 'example';
const CONFIG_PATH = `topics/${TOPIC}.json`;
const BEGIN = '<!-- AUTO:BEGIN -->';
const END = '<!-- AUTO:END -->';
const TRENDING_MIN_ENTRIES = 6;

// awesome-lint requires a plain "- [Name](link) - Description." line, with the
// description capitalised and full-stopped. The richer default format carries
// stars, licence and freshness, which is more useful to a reader but fails lint.
const LINT_SAFE = process.argv.includes('--lint-safe');

function sentence(text) {
  const trimmed = (text || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'No description provided.';
  const capitalised = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

function formatDate(iso) {
  return iso ? iso.slice(0, 10) : 'unknown';
}

function line(entry) {
  if (LINT_SAFE) return `- [${entry.name}](${entry.url}) - ${sentence(entry.description)}`;

  const description = entry.description?.trim() || 'No description provided.';
  // Hand-pinned entries are articles and docs pages; star counts and push dates
  // are meaningless for them.
  if (entry.pinned) return `- **[${entry.name}](${entry.url})** - ${description}`;

  const facts = [`${entry.stars} stars`];
  if (entry.language) facts.push(entry.language);
  if (entry.license && entry.license !== 'NOASSERTION') facts.push(entry.license);
  facts.push(`updated ${formatDate(entry.pushedAt)}`);
  return `- **[${entry.name}](${entry.url})** - ${description}  \n  <sub>${facts.join(' · ')}</sub>`;
}

function selectEntries(registry, manual, config) {
  const overrides = manual.overrides ?? {};
  const approvedManually = new Set(manual.approve ?? []);

  const entries = registry.entries
    .filter((entry) => entry.status === 'approved')
    .filter((entry) => !entry.isArchived || approvedManually.has(entry.id))
    .filter((entry) => daysSince(entry.pushedAt) <= config.thresholds.maxStaleDays)
    .map((entry) => ({ ...entry, ...(overrides[entry.id] ?? {}) }));

  for (const pin of manual.pinned ?? []) {
    if (entries.some((e) => e.url === pin.url)) continue;
    entries.push({ stars: 0, topics: [], ...pin, pinned: true });
  }

  return entries;
}

function renderCategories(entries, config) {
  const out = [];
  const byCategory = new Map();
  for (const entry of entries) {
    const key = entry.category ?? config.defaultCategory;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(entry);
  }

  // Category order in the config is match priority. Printing order is separate:
  // the directories-of-directories section should not open the list.
  const ordered = [...config.categories, { id: config.defaultCategory, title: 'Everything else', renderOrder: 90 }]
    .map((category, index) => ({ ...category, renderOrder: category.renderOrder ?? index + 1 }))
    .sort((a, b) => a.renderOrder - b.renderOrder);
  for (const category of ordered) {
    const group = byCategory.get(category.id);
    if (!group?.length) continue;
    group.sort((a, b) => Number(b.pinned ?? 0) - Number(a.pinned ?? 0) || b.stars - a.stars || a.name.localeCompare(b.name));
    const cap = category.maxEntries ?? config.render?.maxPerCategory ?? Infinity;
    const shown = group.slice(0, cap);
    out.push(`### ${category.title}`, '');
    out.push(...shown.map(line));
    if (group.length > shown.length) {
      out.push(
        '',
        `<sub>${group.length - shown.length} more in this category are tracked in [\`data/registry.json\`](data/registry.json).</sub>`,
      );
    }
    out.push('');
  }
  return out;
}

function renderTrending(entries) {
  if (entries.length < TRENDING_MIN_ENTRIES) return [];
  const moving = entries
    .map((entry) => ({ entry, delta: starDelta(entry, 7) }))
    .filter(({ delta }) => delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);
  if (!moving.length) return [];

  return [
    '### Moving fastest this week',
    '',
    ...moving.map(({ entry, delta }) => `- **[${entry.name}](${entry.url})** - +${delta} stars in 7 days`),
    '',
  ];
}

function main() {
  const config = readJson(CONFIG_PATH);
  const registry = readJson('data/registry.json', { entries: [] });
const coverageLog = readJson('data/coverage.json', { runs: [] });
const lastCoverage = coverageLog.runs?.at(-1) ?? null;
  const manual = readJson('data/manual.json', { approve: [], reject: [], pinned: [], overrides: {} });
  const stats = readJson('data/stats.json', {});

  const entries = selectEntries(registry, manual, config);
  const exclusive = entries.filter(
    (e) => e.source === 'github' && e.coverageComplete && !(e.foundIn ?? []).length,
  ).length;
  const body = [
    ...renderTrending(entries),
    ...renderCategories(entries, config),
    '---',
    '',
    `<sub>${entries.length} entries · ${exclusive} of them in none of the ${lastCoverage?.sourcesChecked ?? 0} other directories checked on ${lastCoverage?.on ?? 'never'} · last updated ${today()} · ${stats.review ?? 0} candidates in the [review queue](data/review-queue.md) · generated by [\`tools/fetch.js\`](tools/fetch.js)</sub>`,
  ].join('\n');

  const readme = readFileSync('README.md', 'utf8');
  const start = readme.indexOf(BEGIN);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1) throw new Error(`README.md is missing the ${BEGIN} / ${END} markers`);

  const next = `${readme.slice(0, start + BEGIN.length)}\n\n${body}\n\n${readme.slice(end)}`;
  writeFileSync('README.md', next);
  console.log(`rendered ${entries.length} entries into README.md`);
}

main();
