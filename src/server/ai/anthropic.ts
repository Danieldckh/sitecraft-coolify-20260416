import Anthropic from '@anthropic-ai/sdk';

/**
 * Anthropic SDK singleton + model registry.
 *
 * Models are sourced from env vars so ops can swap without a rebuild.
 * Defaults match the current product spec.
 *
 * The client itself is lazily constructed on first property access so that
 * importing this module in build/test contexts (where ANTHROPIC_API_KEY may
 * be absent) does not throw. The first real API call will surface a clear
 * error if the key is missing.
 */

const DEFAULT_MODELS = {
  primary: 'claude-sonnet-4-6',
  creative: 'claude-opus-4-7',
  fast: 'claude-haiku-4-5-20251001',
} as const;

export const MODELS: { primary: string; creative: string; fast: string } = {
  primary: process.env.ANTHROPIC_MODEL_PRIMARY || DEFAULT_MODELS.primary,
  creative: process.env.ANTHROPIC_MODEL_CREATIVE || DEFAULT_MODELS.creative,
  fast: process.env.ANTHROPIC_MODEL_FAST || DEFAULT_MODELS.fast,
};

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Configure it in the server environment before calling the AI layer.',
    );
  }
  _client = new Anthropic({
    apiKey,
    // Keep retries conservative — orchestrator surfaces errors to SSE quickly.
    maxRetries: 1,
    timeout: 120_000,
  });
  return _client;
}

/**
 * Lazy Anthropic singleton. Behaves as a normal Anthropic instance — any
 * property access (e.g. `anthropic.messages.create(...)`) constructs the
 * real client on first use.
 */
export const anthropic: Anthropic = new Proxy({} as Anthropic, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client as unknown as object, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
}) as Anthropic;
