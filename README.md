# awesome-x

Build an awesome list that maintains itself, and let a decision model decide what
belongs in it.

Point it at a topic. It crawls GitHub and npm for candidates, puts each one to a
decision model with a single typed question - *does this meet the criterion?* -
and keeps the entries the model is confident about. The uncertain band goes to a
file you review by hand. It then refreshes stars, checks which entries the rival
directories already list, writes the list into this README and rebuilds a
searchable site. A GitHub Action runs the whole thing on a schedule and commits
the result, so the list stays current without you touching it.

The point is not automation for its own sake. A keyword crawler produces a list
full of projects that merely mention the topic. A model that answers one typed
question about each candidate produces a list of projects that actually qualify,
with the probability printed next to every entry so the reader can check your
work.

## The judge

Three providers ship a decision model that takes typed questions and returns a
probability for every option. Cloudflare and TypeSafe share one request shape (a
`state` plus a map of `questions`); OpenAI Decisions uses a questions array, which
`tools/lib/judge.js` translates both ways. Every caller sees the same
`answers[id].noul` number, whichever one answers:

| Provider | Model | Environment |
| --- | --- | --- |
| Cloudflare Workers AI | `@cf/cloudflare/clef`, `@cf/cloudflare/clef-flash` | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` |
| OpenAI Decisions | `gpt-6-luna` | `OPENAI_API_KEY` |
| TypeSafe System One | `jev-latest` | `TYPESAFE_API_KEY` |
| TypeSafe via Vercel AI Gateway | `typesafe-ai/jev` | `AI_GATEWAY_API_KEY` |

Set the credentials for one of them and the judge resolves itself. With several
sets present, the order is Cloudflare, then OpenAI, then TypeSafe (gateway, then
direct): the first is used and each later one is chained as its fallback if a call
fails. Force a choice with `judge.provider` (`cloudflare`, `openai`, `typesafe`)
in the topic config, or `JUDGE_PROVIDER` in the environment; a forced provider has
no fallback. OpenAI is always called at `https://api.openai.com/v1/decisions`,
`OPENAI_BASE_URL` is ignored. `JUDGE_MODEL` picks the model - `@cf/cloudflare/clef-flash` is the
9B model and roughly a third of the price of the 27B `clef`.

Environment variables at a glance:

- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` - both needed for Cloudflare.
- `OPENAI_API_KEY` - OpenAI Decisions.
- `TYPESAFE_API_KEY` (direct) or `AI_GATEWAY_API_KEY` (via Vercel AI Gateway) - TypeSafe.
- `JUDGE_PROVIDER` - force `cloudflare`, `openai` or `typesafe`.
- `JUDGE_MODEL` - override the provider's default model.

What has been proven: on 2026-10-07 Clef (Cloudflare) and OpenAI Decisions were
each checked with one live round-trip, on two hand-written candidates only. The
TypeSafe paths are the original ones from the Jev crawler. For Decisions, the
choice and score mapping is untested end to end (only the yes/no path was
exercised live), so treat a first real run as the test.

Any endpoint that speaks the same request shape works too: set `JUDGE_URL` and
`JUDGE_API_KEY`.

Judging is the cheap part. A few thousand candidates cost cents; the GitHub API
calls are what actually takes the time.

## Quickstart

1. Use this repository as a template, or clone it.
2. Copy `topics/example.json` to `topics/<your-topic>.json` and edit it. The
   three fields that matter most:
   - `judge.criterion` - the one sentence that defines your list. This is the
     editorial decision; everything else here is plumbing.
   - `search.repositoryQueries` - how candidates are found.
   - `signals` / `exclude` - cheap regex scoring that decides what is worth
     spending a judgement on.
3. Set `TOPIC=<your-topic>` in `.github/workflows/update.yml`.
4. Add your provider's credentials as repository secrets.
5. Run it: `TOPIC=<your-topic> npm run update`.
6. When a manual run looks right, uncomment the `schedule:` block in the
   workflow.

Locally, put the keys in `.env.local` next to this file. It is gitignored.

```bash
npm run fetch      # discover and score candidates
npm run judge      # put the review queue to the model, fold in the verdicts
npm run refresh    # update stars and push dates for tracked entries
npm run coverage   # check which entries rival directories already list
npm run render     # write the list into README.md and rebuild site/
npm run update     # all of the above, in order
```

No dependencies. Node 20 or newer, nothing to install.

## How an entry gets in

```
GitHub + npm search
      |
      v
  regex signals        cheap, so it runs on everything
      |
      v
  review queue         anything plausible enough to be worth judging
      |
      v
  the judge            one typed question per candidate
      |
      +--  >= judge.listAt    -> listed
      +--  <= judge.rejectAt  -> rejected
      +--  in between         -> data/review-queue.md, for you
```

`data/manual.json` always wins. Anything you approve, reject or pin by hand
survives every later run, so a bad call by the model is one line to fix
permanently.

## What is in here

| Path | What it does |
| --- | --- |
| `topics/*.json` | Everything specific to your list. Usually the only file you edit. |
| `tools/fetch.js` | Discovery and regex scoring. |
| `tools/triage.js` | Puts the queue to the judge. |
| `tools/triage-merge.js` | Folds verdicts into `data/manual.json`. |
| `tools/refresh.js` | Re-reads stars and push dates for tracked entries. |
| `tools/check-coverage.js` | Asks which entries the rival directories already list. |
| `tools/render.js` | Writes the list into this README, between the markers. |
| `tools/build-site.js` | Writes `site/data.json` and renders `site/index.html`. |
| `tools/lib/judge.js` | The provider adapter. The only file that knows about Clef, Decisions or Jev. Tests: `node --test tools/lib/judge.test.js`. |
| `data/*.json` | Crawler state. Committed, so every change is a reviewable diff. |

The site is static: `site/index.html` is generated from
`site/index.template.html` plus your config, and everything it displays comes
from `site/data.json`. GitHub Pages serves the `site/` directory as-is.

## The coverage check

`check-coverage.js` fetches the READMEs of the largest rival lists on your topic
and records, per entry and with a date, which of them already list it. That is
what lets the site say an entry appears in none of the N directories checked,
as a claim someone can verify rather than an absence you inferred.

It is also the only honest way to answer "why use this list instead of that
one", which is the question every awesome list has to survive.

## Licence

MIT. The list you build with it is yours.

<!-- AUTO:BEGIN -->

---

<sub>0 entries · 0 of them in none of the 0 other directories checked on never · last updated 2026-10-07 · 0 candidates in the [review queue](data/review-queue.md) · generated by [`tools/fetch.js`](tools/fetch.js)</sub>

<!-- AUTO:END -->
