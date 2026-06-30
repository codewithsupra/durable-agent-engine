// Maps step "name" prefixes to handlers. Real tool-use / LLM-call steps
// plug in here. Two reference handlers are included: an LLM call (via
// OpenRouter, free-tier models supported) and a mock tool call.

const handlers = {
  async llm_call(input) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      // demo mode — no key required to run the engine end-to-end
      return { mocked: true, response: `[mock] would call ${input.model || 'llm'} with: ${input.prompt}` };
    }
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model || 'meta-llama/llama-3.1-8b-instruct:free',
        messages: [{ role: 'user', content: input.prompt }],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return { response: data.choices?.[0]?.message?.content };
  },

  async tool_call(input) {
    if (input.simulateFailure && Math.random() < input.failureRate) {
      throw new Error(`Simulated transient failure for tool ${input.tool}`);
    }
    return { tool: input.tool, result: `executed ${input.tool} with args ${JSON.stringify(input.args)}` };
  },

  async noop(input) {
    return { ok: true, input };
  },
};

export function resolveHandler(stepName) {
  const prefix = stepName.split('.')[0];
  return handlers[prefix] || handlers.noop;
}
