'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { resolveTier, rewriteModel } = require('../lib/rewrite');

test('resolves tiers from Anthropic model names', () => {
  assert.strictEqual(resolveTier('claude-opus-4-8'), 'opus');
  assert.strictEqual(resolveTier('claude-haiku-4-5-20251001'), 'haiku');
  assert.strictEqual(resolveTier('claude-sonnet-4-6'), 'sonnet');
  assert.strictEqual(resolveTier('claude-fable-5'), 'sonnet');
  assert.strictEqual(resolveTier(undefined), 'sonnet');
});

test('rewrites model per preset tier map', () => {
  const preset = { opus: 'big-model', sonnet: 'mid-model', haiku: 'small-model' };
  assert.strictEqual(rewriteModel({ model: 'claude-opus-4-8' }, preset).model, 'big-model');
  assert.strictEqual(rewriteModel({ model: 'claude-sonnet-4-6' }, preset).model, 'mid-model');
  assert.strictEqual(rewriteModel({ model: 'claude-haiku-4-5' }, preset).model, 'small-model');
});

test('falls back across tiers when preset is sparse', () => {
  assert.strictEqual(rewriteModel({ model: 'claude-opus-4-8' }, { sonnet: 'only' }).model, 'only');
  assert.strictEqual(rewriteModel({ model: 'claude-sonnet-4-6' }, { opus: 'o' }).model, 'o');
  assert.strictEqual(rewriteModel({ model: 'claude-x' }, {}).model, 'claude-x');
});

test('leaves non-model bodies untouched and does not mutate input', () => {
  const body = { model: 'claude-sonnet-4-6', max_tokens: 5 };
  const rewritten = rewriteModel(body, { sonnet: 'new' });
  assert.strictEqual(body.model, 'claude-sonnet-4-6');
  assert.strictEqual(rewritten.max_tokens, 5);
  assert.deepStrictEqual(rewriteModel({ foo: 1 }, { sonnet: 's' }), { foo: 1 });
});
