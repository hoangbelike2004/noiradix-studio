import assert from 'node:assert/strict';
import AiAgentUsage from '../js/ai-agent-usage.js';

const agent = { authMethod: 'api_key_memory', limits: { tokens: 1000 },
  usage: { inputTokens: 300, outputTokens: 200, cachedTokens: 120, unreportedRequests: 0 } };
const summary = AiAgentUsage.summarize(agent);
assert.equal(summary.totalTokens, 500, 'cached input is already included in input tokens');
assert.equal(summary.remainingTokens, 500);
assert.equal(summary.fractionUsed, 0.5);
assert.equal(AiAgentUsage.summarize({ ...agent, limits: {} }).remainingTokens, null, 'unset local cap is not an infinite provider balance');
assert.equal(AiAgentUsage.summarize({ ...agent, limits: {} }).status, 'not_set');
for (const limit of [0, 100, 500]) {
  const capped = AiAgentUsage.summarize({ ...agent, limits: { tokens: limit } });
  assert.equal(capped.remainingTokens, 0); assert.equal(capped.exhausted, true);
  assert.equal(capped.fractionUsed, 1);
}
assert.equal(AiAgentUsage.summarize({ ...agent, limits: { tokens: 550 } }).low, true);
const missing = AiAgentUsage.summarize({ ...agent, usage: { ...agent.usage, unreportedRequests: 1 } });
assert.equal(missing.remainingTokens, null, 'missing provider usage must not overstate remaining budget');
assert.equal(missing.fractionUsed, null); assert.equal(missing.status, 'unreported');
assert.equal(AiAgentUsage.summarize({ ...agent, usage: {} }).remainingTokens, null);
assert.equal(AiAgentUsage.summarize({ ...agent, authMethod: 'chatgpt_oauth' }).status, 'unsupported');
assert.equal(AiAgentUsage.summarize({ ...agent, authMethod: 'chatgpt_oauth' }).remainingTokens, null);
console.log('PASS agent usage: input/output accounting, cached input, unset/zero/exceeded budgets, low balance, missing usage and OAuth; no invented provider balance.');
