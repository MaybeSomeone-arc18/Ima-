import { generationModels, withKeyRotation } from '../quota.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';
const MAX_GROQ_CONTEXT_CHARS = 10500; // a bounded input leaves headroom in the 8K tokens/min free tier

export function providerOrder() {
  return (process.env.CHAT_PROVIDER || 'groq,gemini')
    .split(',').map((value) => value.trim().toLowerCase())
    .filter((value) => value === 'groq' || value === 'gemini');
}

async function groqText(messages, json) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is missing.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const request = async (jsonMode) => fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: messages.map(({ role, content }) => ({ role, content: String(content).slice(0, MAX_GROQ_CONTEXT_CHARS) })),
        max_completion_tokens: json ? 900 : 1100,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
      }),
      signal: controller.signal
    });
    let response = await request(json);
    // JSON Object Mode can itself return 400 on an otherwise valid prompt.
    // A plain-text retry retains the explicit JSON instructions in messages.
    if (json && response.status === 400) response = await request(false);
    if (!response.ok) {
      // Do not log upstream response bodies: they may echo private prompts.
      throw Object.assign(new Error(`Groq returned HTTP ${response.status}`), { status: response.status });
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text || !text.trim()) throw new Error('Groq returned an empty answer.');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

// Keep the original Gemini request shape in each caller. A missing or failing
// Groq key always falls through to the existing Gemini key and model rotation.
export async function generateText({ messages, geminiCall, json = false }) {
  let lastError;
  for (const provider of providerOrder()) {
    try {
      if (provider === 'groq') return await groqText(messages, json);
      const result = await withKeyRotation(geminiCall, { models: generationModels() });
      if (!result.text?.trim()) throw new Error('Gemini returned an empty answer.');
      return result.text;
    } catch (error) {
      lastError = error;
      console.warn(`${provider} generation unavailable: ${error.message}`);
    }
  }
  throw lastError || new Error('No chat provider configured.');
}
