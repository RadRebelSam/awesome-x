// node --test tools/lib/judge.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { toDecisions, fromDecisions, evaluate, resolveEndpoint } from './judge.js';

const state = { criterion: 'c', repos: [{ ref: 0, name: 'a/b' }] };
const questions = {
  q0: { type: 'noul', instructions: 'Apply `criterion`.', criteria: { true: 'calls the API', false: 'only mentions it' } },
  q1: { type: 'choice', instructions: 'Which?', criteria: { a: 'first', b: 'second' } },
  q2: { type: 'score', instructions: 'How much?', criteria: ['none', { label: 'lots', description: 'plenty' }] },
};

test('toDecisions maps noul, choice and score', () => {
  const body = toDecisions(state, questions, 'gpt-6-luna');
  assert.equal(body.model, 'gpt-6-luna');
  assert.equal(body.input, JSON.stringify(state));
  const [p, c, s] = body.questions;
  assert.deepEqual([p.type, p.name], ['predicate', 'q0']);
  assert.match(p.instructions, /Apply `criterion`\. True when: calls the API False when: only mentions it/);
  assert.deepEqual(c.choices, [{ value: 'a', description: 'first' }, { value: 'b', description: 'second' }]);
  assert.deepEqual(s.levels, [{ label: '0', description: 'none' }, { label: 'lots', description: 'plenty' }]);
});

test('fromDecisions returns noul as a number and keeps choice and score', () => {
  const out = fromDecisions({
    model: 'gpt-6-luna',
    answers: [
      { type: 'predicate', name: 'q0', probability: 0.93 },
      { type: 'choice', name: 'q1', choice: 'a', probabilities: [{ value: 'a', probability: 0.8 }], confidence: 0.7 },
      { type: 'score', name: 'q2', score: 1.4, probabilities: [{ value: 0, label: 'none', probability: 0.6 }], confidence: 0.5 },
    ],
    usage: { input_tokens: 10, output_tokens: 0 },
  });
  assert.equal(typeof out.answers.q0.noul, 'number');
  assert.equal(out.answers.q0.noul, 0.93);
  assert.deepEqual(out.answers.q1.probabilities, { a: 0.8 });
  assert.equal(out.answers.q2.score, 1.4);
});

test('evaluate speaks Decisions over fetch and falls back down the chain', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url.includes('cloudflare')) return new Response('nope', { status: 400 });
    return Response.json({ model: 'gpt-6-luna', answers: [{ type: 'predicate', name: 'q0', probability: 0.5 }] });
  };
  try {
    const openai = { via: 'openai-decisions', format: 'decisions', url: 'https://api.openai.com/v1/decisions', key: 'k', model: 'gpt-6-luna' };
    const cf = { via: 'cloudflare-workers-ai', url: 'https://api.cloudflare.com/x', key: 'k', model: 'clef', fallback: openai };
    const { answers } = await evaluate(state, { q0: questions.q0 }, cf);
    assert.equal(answers.q0.noul, 0.5);
    assert.deepEqual(calls.map((c) => c.url.includes('openai')), [false, true]);
    assert.ok(Array.isArray(calls[1].body.questions));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('auto order is cloudflare, openai, typesafe; OPENAI_BASE_URL is ignored', () => {
  const saved = { ...process.env };
  const cwd = process.cwd();
  process.chdir(tmpdir()); // keep the repo's .env.local out of the test
  for (const k of ['JUDGE_PROVIDER', 'JUDGE_URL', 'JUDGE_MODEL', 'AI_GATEWAY_API_KEY', 'JEV_API_KEY']) delete process.env[k];
  Object.assign(process.env, {
    CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't', OPENAI_API_KEY: 'o', TYPESAFE_API_KEY: 'k',
    OPENAI_BASE_URL: 'https://proxy.invalid',
  });
  try {
    const e = resolveEndpoint({});
    assert.deepEqual([e.via, e.fallback.via, e.fallback.fallback.via], ['cloudflare-workers-ai', 'openai-decisions', 'typesafe-direct']);
    assert.equal(e.fallback.url, 'https://api.openai.com/v1/decisions');
    assert.equal(resolveEndpoint({ provider: 'openai' }).fallback, undefined);
  } finally {
    process.chdir(cwd);
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
