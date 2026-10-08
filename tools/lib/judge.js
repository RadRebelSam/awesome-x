// The judge: a decision model that answers typed questions about a candidate
// and returns a probability for every allowed option.
//
// Three providers are supported. Two vendors ship this kind of model with the
// same request vocabulary - a `state` plus a map of `questions`, each `noul`
// (probability a condition holds), `choice` (one option from a map) or `score`
// (a position on ordered levels). The third speaks a different dialect that this
// file translates both ways:
//
//   Cloudflare Workers AI   @cf/cloudflare/clef, @cf/cloudflare/clef-flash
//   TypeSafe System One     jev-latest, direct or through Vercel's AI Gateway
//   OpenAI Decisions        gpt-6-luna (questions array: predicate/choice/score)
//
// Every provider ends up returning `answers[id].noul` as a number, so everything
// above this file is provider-agnostic. Pick one with JUDGE_PROVIDER, or let the
// keys decide (auto order: cloudflare, openai, typesafe).
import { readFileSync, existsSync } from 'node:fs';
import { sleep, log } from './util.js';

// Keys are never committed and never printed. They are read from the
// environment, or from .env.local, which .gitignore covers.
function loadEnvFile(path = '.env.local') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

// Each builder takes an explicit model id, or undefined for its own default.
function cloudflare(m) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const key = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_AUTH_TOKEN;
  if (!account || !key) return null;
  // clef-flash is 9B and about a third of the price; clef is 27B. Either is
  // cheap enough that the crawl's GitHub calls dominate a run.
  const id = m || '@cf/cloudflare/clef';
  return {
    via: 'cloudflare-workers-ai',
    url: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${id}`,
    key,
    model: id.split('/').pop(),
  };
}

function openai(m) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  // The explicit URL, on purpose: OPENAI_BASE_URL often points at a proxy that
  // does not serve /v1/decisions.
  return {
    via: 'openai-decisions',
    format: 'decisions',
    url: 'https://api.openai.com/v1/decisions',
    key,
    model: m || 'gpt-6-luna',
  };
}

function typesafeGateway(m) {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) return null;
  // The gateway's TypeSafe-compatible API takes TypeSafe's own request and
  // response shapes, so only the base URL and the model id differ from a
  // direct call.
  return {
    via: 'vercel-ai-gateway',
    url: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone',
    key,
    model: m || 'typesafe-ai/jev',
  };
}

function typesafeDirect(m) {
  const key = process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY;
  if (!key) return null;
  return {
    via: 'typesafe-direct',
    url: 'https://api.typesafe.ai/v1/systemone',
    key,
    model: m || 'jev-latest',
  };
}

// `provider` comes from the topic config; the environment can override it, and
// "auto" takes whichever provider has credentials: Clef first (cheapest, and the
// reference dialect), then OpenAI Decisions ($0.10 per 1M input tokens), then
// TypeSafe. Each later provider with credentials is chained as the fallback of
// the one before it, so an outage costs a retry rather than the day's run. A
// forced provider has no fallback.
export function resolveEndpoint({ provider, model } = {}) {
  loadEnvFile();

  const choice = process.env.JUDGE_PROVIDER || provider || 'auto';
  const explicit = process.env.JUDGE_MODEL || model || undefined;

  if (process.env.JUDGE_URL) {
    return {
      via: 'custom',
      url: process.env.JUDGE_URL,
      key: process.env.JUDGE_API_KEY || '',
      model: explicit || 'jev-latest',
    };
  }

  if (choice === 'cloudflare') return cloudflare(explicit);
  if (choice === 'openai') return openai(explicit);
  if (choice === 'typesafe') return typesafeDirect(explicit) || typesafeGateway(explicit);

  // The explicit model belongs to the primary only; a fallback uses its own default.
  const live = [];
  for (const make of [cloudflare, openai, typesafeGateway, typesafeDirect]) {
    const endpoint = make(live.length === 0 ? explicit : undefined);
    if (endpoint) live.push(endpoint);
  }
  if (!live.length) return null;
  live.forEach((endpoint, i) => (endpoint.fallback = live[i + 1] ?? null));
  return live[0];
}

export function describeMissingKeys() {
  return (
    'No judge credentials found. Set one of these, in the environment or in .env.local:\n' +
    '  CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN   Cloudflare Workers AI (clef)\n' +
    '  OPENAI_API_KEY                                 OpenAI Decisions (gpt-6-luna)\n' +
    '  AI_GATEWAY_API_KEY                             Vercel AI Gateway (typesafe-ai/jev)\n' +
    '  TYPESAFE_API_KEY                               TypeSafe System One (jev) directly'
  );
}

export async function evaluate(state, questions, endpoint) {
  try {
    return await request(state, questions, endpoint);
  } catch (err) {
    if (!endpoint.fallback) throw err;
    log(`falling back to ${endpoint.fallback.via}: ${err.message.slice(0, 120)}`);
    return evaluate(state, questions, endpoint.fallback);
  }
}

// Jev-shaped questions -> an OpenAI Decisions body. Ids become question names. A
// noul is a predicate; its optional criteria text is folded into the instructions.
export function toDecisions(state, questions, model) {
  const list = Object.entries(questions).map(([name, q]) => {
    const instructions = String(q.instructions ?? '');
    if (q.type === 'choice') {
      return {
        type: 'choice',
        name,
        instructions,
        choices: Object.entries(q.criteria ?? {}).map(([value, description]) => ({ value, description })),
      };
    }
    if (q.type === 'score') {
      return {
        type: 'score',
        name,
        instructions,
        levels: (q.criteria ?? []).map((c, i) =>
          typeof c === 'string'
            ? { label: String(i), description: c }
            : { label: c.label ?? String(i), description: c.description ?? '' },
        ),
      };
    }
    const c = q.criteria;
    const extra =
      c && typeof c === 'object'
        ? [c.true && `True when: ${c.true}`, c.false && `False when: ${c.false}`].filter(Boolean).join(' ')
        : c
          ? String(c)
          : '';
    return { type: 'predicate', name, instructions: [instructions, extra].filter(Boolean).join(' ') };
  });
  return { model, input: JSON.stringify(state), questions: list };
}

// An OpenAI Decisions reply -> the answers map every caller reads.
export function fromDecisions(reply) {
  const answers = {};
  for (const a of reply?.answers ?? []) {
    if (a.type === 'choice') {
      answers[a.name] = {
        type: 'choice',
        choice: a.choice,
        probabilities: Object.fromEntries((a.probabilities ?? []).map((p) => [p.value, p.probability])),
        confidence: a.confidence,
      };
    } else if (a.type === 'score') {
      answers[a.name] = {
        type: 'score',
        score: a.score,
        probabilities: (a.probabilities ?? []).map((p) => p.probability),
        confidence: a.confidence,
      };
    } else {
      answers[a.name] = { type: 'noul', noul: a.probability };
    }
  }
  return { model: reply?.model, answers, usage: reply?.usage };
}

async function request(state, questions, endpoint, attempt = 1) {
  const decisions = endpoint.format === 'decisions';
  const body = JSON.stringify(
    decisions ? toDecisions(state, questions, endpoint.model) : { model: endpoint.model, state, questions },
  );

  let res;
  try {
    res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${endpoint.key}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    // A dropped socket is not an answer. Retry it like a 500.
    if (attempt > 3) throw err;
    await sleep(2000 * attempt);
    return request(state, questions, endpoint, attempt + 1);
  }

  if (res.status === 429 || res.status >= 500) {
    if (attempt > 4) throw new Error(`${res.status} from the judge after ${attempt} attempts`);
    const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * attempt;
    log(`  ${res.status}, retrying in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return request(state, questions, endpoint, attempt + 1);
  }

  if (!res.ok) {
    // Error bodies can echo request content; keep the excerpt short, and never
    // log the header that carries the key.
    throw new Error(`${res.status} from the judge: ${(await res.text()).slice(0, 200)}`);
  }

  // Workers AI wraps every response in { result, success, errors }; TypeSafe
  // returns the answers at the top level; Decisions returns an answers array.
  // Unwrap all three to one shape.
  const payload = await res.json();
  if (decisions) return fromDecisions(payload);
  return payload?.result ?? payload;
}
