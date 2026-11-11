/** Session usage and user-defined Studio budgets, never provider credit balances. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.AiAgentUsage = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const validCount = value => Number.isSafeInteger(value) && value >= 0;
  function summarize(agent) {
    const usage = agent.usage || {};
    const measured = validCount(usage.inputTokens) && validCount(usage.outputTokens);
    // Cached input is already part of inputTokens: never count it twice.
    const totalTokens = measured ? usage.inputTokens + usage.outputTokens : null;
    const complete = measured && usage.unreportedRequests === 0;
    const limit = validCount(agent.limits?.tokens) ? agent.limits.tokens : null;
    const status = agent.authMethod === 'chatgpt_oauth' ? 'unsupported' :
      limit === null ? 'not_set' : !complete ? 'unreported' : 'known';
    const remainingTokens = status === 'known' ? Math.max(0, limit - totalTokens) : null;
    return { totalTokens, complete, limit, remainingTokens, status,
      fractionUsed: status === 'known' ? limit === 0 ? 1 : Math.min(1, totalTokens / limit) : null,
      exhausted: remainingTokens === 0,
      low: status === 'known' && limit > 0 && remainingTokens <= limit * 0.1 };
  }
  return { summarize };
});
