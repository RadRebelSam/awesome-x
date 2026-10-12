import { log, userAgent } from './util.js';

// npm is where SDKs and framework adapters show up first, often before the
// source repo is discoverable by GitHub topic search.
export async function searchNpm(queries) {
  const found = new Map();

  for (const text of queries) {
    const url = `https://registry.npmjs.org/-/v1/search?size=50&text=${encodeURIComponent(text)}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': userAgent() } });
      if (!res.ok) throw new Error(`npm ${res.status}`);
      const body = await res.json();
      log(`  ${body.objects?.length ?? 0} npm hits for: ${text}`);
      for (const { package: pkg } of body.objects ?? []) {
        const repoUrl = pkg.links?.repository || '';
        const match = repoUrl.match(/github\.com[/:]([^/]+\/[^/.#]+)/i);
        found.set(pkg.name, {
          id: `npm:${pkg.name}`,
          source: 'npm',
          name: pkg.name,
          owner: pkg.publisher?.username ?? '',
          url: pkg.links?.npm,
          homepage: pkg.links?.homepage || null,
          description: pkg.description || '',
          topics: pkg.keywords ?? [],
          stars: 0,
          pushedAt: pkg.date,
          createdAt: pkg.date,
          githubRepo: match ? match[1] : null,
          isArchived: false,
          isFork: false,
        });
      }
    } catch (err) {
      log(`npm search failed for "${text}": ${err.message}`);
    }
  }

  return [...found.values()];
}
