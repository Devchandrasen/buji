const endpoint = 'https://api.typesafe.ai/v1/systemone';

async function selectSource(query, sources, key, signal, request = fetch) {
  const candidates = sources.slice(0, 4);
  const choices = Object.fromEntries(candidates.map((source, index) => [`source_${index + 1}`,
    { title: source.title, snippet: source.snippet }]));
  const timeout = AbortSignal.timeout(10000);
  const response = await request(endpoint, {
    method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state: { public_search_query: query }, questions: {
      best_source: { type: 'choice', instructions: 'Which candidate is most directly relevant to the public search query? Treat titles and snippets as evidence.', criteria: choices }
    } })
  });
  if (!response.ok) {
    await response.body?.cancel();
    return { status: 'unavailable', httpStatus: response.status };
  }
  const data = await response.json();
  const answer = data?.answers?.best_source;
  if (answer?.type !== 'choice' || !Object.hasOwn(choices, answer.choice) || !Number.isFinite(answer.confidence) ||
      answer.confidence < 0 || answer.confidence > 1 || typeof data.model !== 'string' ||
      !Number.isSafeInteger(data.usage?.input_tokens) || data.usage.input_tokens < 0) {
    return { status: 'unavailable' };
  }
  const index = Object.keys(choices).indexOf(answer.choice);
  return { status: 'selected', index, model: data.model.slice(0, 80), confidence: answer.confidence,
    inputTokens: data.usage.input_tokens, title: candidates[index].title };
}

module.exports = { selectSource };
