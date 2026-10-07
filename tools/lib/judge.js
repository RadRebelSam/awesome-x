// The judge: a decision model that answers typed questions about a candidate
// and returns a probability for every allowed option.
//
// Two providers are supported because two vendors ship this kind of model with
// the same request vocabulary - a `state` plus a map of `questions`, each
// `noul` (probability a condition holds), `choice` (one option from a map) or
// `score` (a position on ordered levels):
//
//   Cloudflare Workers AI   @cf/cloudflare/clef, @cf/cloudflare/clef-flash
//   TypeSafe System One     jev-latest, direct or through Vercel's AI Gateway
//
// Both return `answers[id].noul` as a number, so everything above this file is
// provider-agnostic. Pick one with JUDGE_PROVIDER, or let the keys decide.
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

function cloudflare(model) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const key = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_AUTH_TOKEN;
  if (!account || !key) return null;
  // clef-flash is 9B and about a third of the price; clef is 27B. Either is
  // cheap enough that the crawl's GitHub calls dominate a run.
  const id = model || process.env.JUDGE_MODEL || '@cf/cloudflare/clef';
  return {
    via: 'cloudflare-workers-ai',
    url: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${id}`,
    key,
    model: id.split('/').pop(),
  };
}

function typesafeGateway(model) {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) return null;
  // The gateway's TypeSafe-compatible API takes TypeSafe's own request and
  // response shapes, so only the base URL and the model id differ from a
  // direct call.
  return {
    via: 'vercel-ai-gateway',
    url: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone',
    key,
    model: model || process.env.JUDGE_MODEL || 'typesafe-ai/jev',
  };
}

function typesafeDirect(model) {
  const key = process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY;
  if (!key) return null;
  return {
    via: 'typesafe-direct',
    url: 'https://api.typesafe.ai/v1/systemone',
    key,
    model: model || process.env.JUDGE_MODEL || 'jev-latest',
  };
}

// `provider` comes from the topic config; the environment can override it, and
// "auto" takes whichever provider has credentials, cheapest first.
export function resolveEndpoint({ provider, model } = {}) {
  loadEnvFile();

  const choice = process.env.JUDGE_PROVIDER || provider || 'auto';

  if (process.env.JUDGE_URL) {
    return {
      via: 'custom',
      url: process.env.JUDGE_URL,
      key: process.env.JUDGE_API_KEY || '',
      model: process.env.JUDGE_MODEL || model || 'jev-latest',
    };
  }

  if (choice === 'cloudflare') return cloudflare(model);
  if (choice === 'typesafe') return typesafeDirect(model) || typesafeGateway(model);

  const endpoint = cloudflare(model) || typesafeGateway(model) || typesafeDirect(model);
  if (!endpoint) return null;

  // Whichever provider is second gets used when the first one errors, so a
  // provider outage costs a retry rather than the day's run.
  endpoint.fallback =
    endpoint.via === 'cloudflare-workers-ai' ? typesafeGateway(model) || typesafeDirect(model) : null;
  return endpoint;
}

export function describeMissingKeys() {
  return (
    'No judge credentials found. Set one of these, in the environment or in .env.local:\n' +
    '  CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN   Cloudflare Workers AI (clef)\n' +
    '  AI_GATEWAY_API_KEY                             Vercel AI Gateway (typesafe-ai/jev)\n' +
    '  TYPESAFE_API_KEY                               TypeSafe System One (jev) directly'
  );
}

export async function evaluate(state, questions, endpoint, attempt = 1) {
  try {
    return await request(state, questions, endpoint, attempt);
  } catch (err) {
    if (!endpoint.fallback || attempt > 1) throw err;
    log(`falling back to ${endpoint.fallback.via}: ${err.message.slice(0, 120)}`);
    return request(state, questions, endpoint.fallback, 1);
  }
}

async function request(state, questions, endpoint, attempt = 1) {
  const body = JSON.stringify({ model: endpoint.model, state, questions });

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
  // returns the answers at the top level. Unwrap to one shape.
  const payload = await res.json();
  return payload?.result ?? payload;
}
