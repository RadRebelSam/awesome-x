// Builds the data file the directory site reads. The page itself is static;
// everything it shows comes from here, so a crawl refreshes the site for free.
import { readFileSync, writeFileSync } from 'node:fs';
import { readJson, writeJson, starDelta } from './lib/store.js';
import { daysSince, log } from './lib/util.js';

const TOPIC = process.env.TOPIC || 'example';
const config = readJson(`topics/${TOPIC}.json`);
const registry = readJson('data/registry.json', { entries: [] });
const manual = readJson('data/manual.json', { pinned: [], overrides: {} });
const triage = readJson('data/triage.json', {});
const coverageLog = readJson('data/coverage.json', { sources: {}, runs: [] });
const lastRun = coverageLog.runs?.at(-1) ?? null;
const maxAgeDays = config.site?.coverage?.maxAgeDays ?? 7;

const titles = Object.fromEntries(config.categories.map((c) => [c.id, c.title]));
titles[config.defaultCategory] = 'Everything else';

const overrides = manual.overrides ?? {};

const entries = registry.entries
  .filter((e) => e.status === 'approved')
  .filter((e) => !e.isArchived)
  .filter((e) => daysSince(e.pushedAt) <= config.thresholds.maxStaleDays)
  .map((entry) => {
    const merged = { ...entry, ...(overrides[entry.id] ?? {}) };
    return {
      name: merged.name,
      url: merged.url,
      description: merged.description || '',
      category: merged.category ?? config.defaultCategory,
      categoryTitle: titles[merged.category] ?? 'Everything else',
      stars: merged.stars ?? 0,
      starsWeek: starDelta(merged, 7),
      language: merged.language ?? null,
      license: merged.license && merged.license !== 'NOASSERTION' ? merged.license : null,
      pushedAt: merged.pushedAt ?? null,
      daysSincePush: daysSince(merged.pushedAt),
      firstSeen: merged.firstSeen ?? null,
      // The two things a hand-maintained list cannot show. Exclusivity is only
      // asserted when a recent, complete check actually looked for it: absence
      // of a mark is not evidence of absence from the other directories.
      rating: triage[merged.id]?.noul ?? null,
      exclusive:
        Boolean(merged.coverageComplete) &&
        daysSince(merged.coverageCheckedAt) <= maxAgeDays &&
        !(merged.foundIn ?? []).length,
    };
  })
  .sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));

const categories = [...config.categories, { id: config.defaultCategory, title: titles[config.defaultCategory] }]
  .map((c) => ({ id: c.id, title: c.title, count: entries.filter((e) => e.category === c.id).length }))
  .filter((c) => c.count > 0);

writeJson('site/data.json', {
  generatedAt: new Date().toISOString(),
  // Copied through from the topic config so the page has one source of truth and
  // the settings survive every rebuild.
  site: config.site ?? {},
  topic: config.title,
  tagline: config.tagline,
  // The page prints the question that was actually asked, so a reader can see
  // what the number on each card does and does not claim.
  judge: {
    label: config.judge?.label ?? 'match',
    name: config.judge?.name ?? 'the decision model',
    criterion: config.judge?.criterion ?? '',
    listAt: config.judge?.listAt ?? 0.75,
    rejectAt: config.judge?.rejectAt ?? 0.45,
  },
  coverage: {
    checkedOn: lastRun?.on ?? null,
    sourcesChecked: lastRun?.sourcesChecked ?? 0,
    sourcesHealthy: lastRun?.sourcesHealthy ?? 0,
    complete: Boolean(lastRun?.complete),
    sources: Object.keys(coverageLog.sources ?? {}),
  },
  counts: {
    total: entries.length,
    exclusive: entries.filter((e) => e.exclusive).length,
    judged: entries.filter((e) => e.rating !== null).length,
    reviewQueue: registry.entries.filter((e) => e.status === 'review').length,
  },
  categories,
  entries,
});

log(`site data: ${entries.length} entries, ${categories.length} categories`);

// The page is static, so the few strings a crawler cannot fill at runtime - the
// title, the social card, the canonical URL - are substituted here instead of
// being hand-edited in two places.
const site = config.site ?? {};
const tokens = {
  TITLE: config.title ?? 'Directory',
  DESCRIPTION: config.tagline ?? '',
  URL: site.url ?? '',
  IMAGE: site.image ?? (site.url ? `${site.url.replace(/\/$/, '')}/og.png` : ''),
  ANALYTICS: site.analyticsScript ?? '',
};
const template = readFileSync('site/index.template.html', 'utf8');
writeFileSync(
  'site/index.html',
  template.replace(/\{\{(\w+)\}\}/g, (match, key) => tokens[key] ?? ''),
);
log('site/index.html rendered from the template');
