/**
 * llmClient.js - Universal OpenAI-compatible LLM client.
 *
 * One abstraction over four transports:
 *   - OpenAI            (dialect: openai)
 *   - Anthropic         (dialect: anthropic - /v1/messages, x-api-key)
 *   - OpenRouter        (dialect: openai)
 *   - Any local server  (dialect: openai - Ollama :11434, LM Studio :1234, vLLM, llama.cpp)
 *
 * Hard guarantees relied on by the Cognitive Layer:
 *   1. Every request carries a WALL-CLOCK DEADLINE (default 4000ms) that spans *all*
 *      retry attempts. Past the deadline the request is aborted and { ok:false } is
 *      returned so the caller can drop to its rule-based fallback.
 *   2. This module never throws for network/parse problems. It returns result objects.
 *   3. Nothing here touches the Phaser game loop. Callers treat it as fire-and-forget.
 */

/* ------------------------------------------------------------------ presets */

export const PROVIDER_PRESETS = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    dialect: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    keyRequired: true,
    supportsJsonMode: true,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    dialect: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    // Sonnet 5 is the default because the cognitive layer runs on a 4s deadline;
    // Opus 5 is selectable for higher-fidelity social reasoning at more latency.
    defaultModel: 'claude-sonnet-5',
    models: ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5-20251001'],
    keyRequired: true,
    supportsJsonMode: false,
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    // Google exposes an OpenAI-compatible surface at /v1beta/openai, so Gemini needs
    // no bespoke dialect: same /chat/completions, same bearer token, same /models.
    dialect: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    // The 2.5 line is closed to new projects; the API's own 404 points here. Model
    // names move faster than any hardcoded list, so use Fetch for the live set.
    defaultModel: 'gemini-3.5-flash-lite',
    models: ['gemini-3.5-flash-lite'],
    keyRequired: true,
    supportsJsonMode: true,
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    dialect: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-5',
    models: [
      'anthropic/claude-sonnet-5',
      'openai/gpt-4o-mini',
      'meta-llama/llama-3.3-70b-instruct',
      'mistralai/mistral-small',
    ],
    keyRequired: true,
    supportsJsonMode: true,
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    dialect: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    devProxy: '/ollama/v1',
    defaultModel: 'llama3.2',
    models: ['llama3.2', 'qwen2.5:7b', 'mistral', 'phi4'],
    keyRequired: false,
    supportsJsonMode: true,
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    dialect: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    devProxy: '/lmstudio/v1',
    defaultModel: 'local-model',
    models: ['local-model'],
    keyRequired: false,
    supportsJsonMode: true,
  },
  custom: {
    id: 'custom',
    label: 'Custom endpoint',
    dialect: 'openai',
    baseUrl: 'http://localhost:8000/v1',
    defaultModel: 'local-model',
    models: [],
    keyRequired: false,
    supportsJsonMode: false,
  },
};

export const DEFAULT_LLM_CONFIG = {
  provider: 'ollama',
  dialect: 'openai',
  baseUrl: PROVIDER_PRESETS.ollama.baseUrl,
  apiKey: '',
  model: PROVIDER_PRESETS.ollama.defaultModel,
  customHeaders: {},        // { 'X-My-Header': 'value' }
  temperature: 0.8,
  maxTokens: 220,           // ~150 tokens of JSON payload + slack
  timeoutMs: 4000,          // spec: fall back to rules after 4s
  maxAttempts: 2,           // structural retry with a repair instruction
  useDevProxy: true,        // route localhost through the Vite proxy in dev
  jsonMode: true,           // ask for response_format json_object where supported
  persistApiKey: true,
  enabled: true,            // master switch; off => pure rule-based NPCs
};

/** Swap in a provider preset, keeping user-owned fields (key, temps, budgets). */
export function applyPreset(config, providerId) {
  const preset = PROVIDER_PRESETS[providerId] || PROVIDER_PRESETS.custom;
  return {
    ...config,
    provider: preset.id,
    dialect: preset.dialect,
    baseUrl: preset.baseUrl,
    model: preset.defaultModel,
    jsonMode: preset.supportsJsonMode,
  };
}

/* ------------------------------------------------------------------- utils */

const isDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * Localhost endpoints are re-pointed at the Vite dev proxy so the browser never has
 * to negotiate CORS with Ollama/LM Studio. Production builds use the raw URL.
 */
export function resolveBaseUrl(config) {
  const raw = trimSlash(config.baseUrl);
  if (!config.useDevProxy || !isDev) return raw;
  if (/^https?:\/\/(localhost|127\.0\.0\.1):11434/.test(raw)) return '/ollama/v1';
  if (/^https?:\/\/(localhost|127\.0\.0\.1):1234/.test(raw)) return '/lmstudio/v1';
  return raw;
}

/**
 * Pull the first balanced JSON object out of a model reply. Handles fenced blocks,
 * leading prose and trailing commentary - all of which small local models emit
 * constantly even under an explicit JSON instruction.
 */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  const direct = tryParse(s);
  if (direct) return direct;

  // Scan for the first balanced { ... }, ignoring braces inside strings.
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return tryParse(s.slice(start, i + 1));
    }
  }
  return null;
}

function tryParse(s) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : null;
  } catch {
    // Second chance: repair the two things small models get wrong most often -
    // trailing commas and single-quoted keys.
    try {
      const patched = s
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":');
      const v = JSON.parse(patched);
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;
    }
  }
}

/* ------------------------------------------------------------------ client */

export class LLMClient {
  constructor(config = {}) {
    this.config = { ...DEFAULT_LLM_CONFIG, ...config };
    this.stats = {
      calls: 0,
      ok: 0,
      failed: 0,
      timeouts: 0,
      parseFailures: 0,
      retries: 0,
      totalLatency: 0,
      lastError: null,
      lastLatency: 0,
    };
    this._listeners = new Set();
  }

  updateConfig(patch) {
    this.config = { ...this.config, ...patch };
    this._emit();
    return this.config;
  }

  getConfig() {
    return { ...this.config };
  }

  /** Subscribe to config/stat changes (used by the React HUD). */
  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) {
      try { fn(this.config, this.getStats()); } catch { /* a listener must not break the client */ }
    }
  }

  getStats() {
    const { calls, ok, totalLatency } = this.stats;
    return {
      ...this.stats,
      avgLatency: ok ? Math.round(totalLatency / ok) : 0,
      successRate: calls ? Math.round((ok / calls) * 100) : 0,
    };
  }

  isConfigured() {
    const preset = PROVIDER_PRESETS[this.config.provider];
    if (!this.config.enabled) return false;
    if (!this.config.baseUrl || !this.config.model) return false;
    if (preset && preset.keyRequired && !this.config.apiKey) return false;
    return true;
  }

  /* --------------------------------------------------------- transport */

  _headers() {
    const { dialect, apiKey, customHeaders, provider } = this.config;
    const h = { 'Content-Type': 'application/json', ...(customHeaders || {}) };

    if (dialect === 'anthropic') {
      if (apiKey) h['x-api-key'] = apiKey;
      h['anthropic-version'] = h['anthropic-version'] || '2023-06-01';
      // Required for browser-originated calls to the Anthropic API.
      h['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (apiKey) {
      h.Authorization = `Bearer ${apiKey}`;
    }

    if (provider === 'openrouter') {
      h['HTTP-Referer'] = h['HTTP-Referer'] || globalThis.location?.origin || 'http://localhost:5173';
      h['X-Title'] = h['X-Title'] || 'Blackout: The Subterfuge';
    }
    return h;
  }

  _buildBody({ system, messages, maxTokens, temperature, jsonMode }) {
    const { dialect, model } = this.config;

    if (dialect === 'anthropic') {
      return {
        model,
        system,
        messages: messages.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content),
        })),
        max_tokens: maxTokens,
        temperature,
      };
    }

    const body = {
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      max_tokens: maxTokens,
      temperature,
      stream: false,
    };
    if (jsonMode) body.response_format = { type: 'json_object' };
    return body;
  }

  _extractText(payload) {
    if (!payload) return '';
    // Anthropic
    if (Array.isArray(payload.content)) {
      return payload.content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('').trim();
    }
    // OpenAI-compatible
    const choice = payload.choices && payload.choices[0];
    if (choice) {
      if (choice.message) {
        const c = choice.message.content;
        if (typeof c === 'string') return c.trim();
        if (Array.isArray(c)) return c.map((p) => p.text || '').join('').trim();
      }
      if (typeof choice.text === 'string') return choice.text.trim();
    }
    // Ollama native shape, in case baseUrl points at /api instead of /v1.
    if (payload.message && typeof payload.message.content === 'string') {
      return payload.message.content.trim();
    }
    if (typeof payload.response === 'string') return payload.response.trim();
    return '';
  }

  _extractUsage(payload) {
    const u = (payload && payload.usage) || {};
    return {
      promptTokens: u.prompt_tokens ?? u.input_tokens ?? 0,
      completionTokens: u.completion_tokens ?? u.output_tokens ?? 0,
    };
  }

  /**
   * One raw round trip. Rejects on network error / abort / non-2xx.
   * @returns {Promise<{text:string, usage:object, payload:object}>}
   */
  async _request(body, signal) {
    const base = resolveBaseUrl(this.config);
    const path = this.config.dialect === 'anthropic' ? '/messages' : '/chat/completions';
    const res = await fetch(base + path, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch { /* body unreadable - the status line is enough */ }
      const err = new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` - ${detail}` : ''}`);
      err.code = res.status === 401 || res.status === 403 ? 'AUTH' : 'HTTP';
      err.status = res.status;
      throw err;
    }

    const payload = await res.json();
    return { text: this._extractText(payload), usage: this._extractUsage(payload), payload };
  }

  /* ------------------------------------------------------------ public */

  /**
   * Structured JSON completion with a wall-clock deadline spanning every attempt.
   *
   * @param {object}   opts
   * @param {string}   opts.system       System prompt (the schema contract lives here).
   * @param {Array}    opts.messages     [{role:'user'|'assistant', content:string}]
   * @param {Function} [opts.validate]   (obj) => {ok:boolean, value?:any, error?:string}
   * @param {number}   [opts.timeoutMs]
   * @param {number}   [opts.maxTokens]
   * @param {number}   [opts.temperature]
   * @param {AbortSignal} [opts.signal]  External cancellation (e.g. NPC despawned).
   * @returns {Promise<{ok:boolean, data?:any, raw?:string, error?:string, code?:string, meta:object}>}
   */
  async chatJSON(opts) {
    const {
      system,
      messages = [],
      validate = null,
      timeoutMs = this.config.timeoutMs,
      maxTokens = this.config.maxTokens,
      temperature = this.config.temperature,
      signal: externalSignal = null,
    } = opts;

    const started = performance.now();
    const deadline = started + timeoutMs;
    const meta = {
      provider: this.config.provider,
      model: this.config.model,
      attempts: 0,
      latencyMs: 0,
      usage: null,
    };

    if (!this.isConfigured()) {
      return { ok: false, error: 'LLM not configured', code: 'UNCONFIGURED', meta };
    }

    this.stats.calls++;
    let convo = [...messages];
    let lastErr = 'unknown';
    let lastCode = 'UNKNOWN';

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      const remaining = deadline - performance.now();
      if (remaining <= 60) {           // not enough budget left to be worth a round trip
        lastErr = 'deadline exceeded';
        lastCode = 'TIMEOUT';
        this.stats.timeouts++;
        break;
      }

      meta.attempts = attempt;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), remaining);
      const onExternalAbort = () => ctrl.abort();
      if (externalSignal) {
        if (externalSignal.aborted) ctrl.abort();
        else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }

      try {
        const body = this._buildBody({
          system,
          messages: convo,
          maxTokens,
          temperature,
          jsonMode: this.config.jsonMode && this.config.dialect !== 'anthropic',
        });
        const { text, usage } = await this._request(body, ctrl.signal);
        meta.usage = usage;

        const parsed = extractJson(text);
        if (!parsed) {
          this.stats.parseFailures++;
          if (attempt < this.config.maxAttempts) this.stats.retries++;
          lastErr = 'response was not valid JSON';
          lastCode = 'PARSE';
          convo = [
            ...messages,
            { role: 'assistant', content: (text || '').slice(0, 300) },
            {
              role: 'user',
              content: 'That was not valid JSON. Reply with ONLY the JSON object - no prose, no code fence.',
            },
          ];
          continue;
        }

        if (validate) {
          const v = validate(parsed);
          if (!v.ok) {
            this.stats.parseFailures++;
            if (attempt < this.config.maxAttempts) this.stats.retries++;
            lastErr = `schema violation: ${v.error}`;
            lastCode = 'SCHEMA';
            convo = [
              ...messages,
              { role: 'assistant', content: JSON.stringify(parsed).slice(0, 300) },
              { role: 'user', content: `Invalid: ${v.error}. Re-send ONLY the corrected JSON object.` },
            ];
            continue;
          }
          meta.latencyMs = Math.round(performance.now() - started);
          this._succeed(meta.latencyMs);
          return { ok: true, data: v.value, raw: text, meta };
        }

        meta.latencyMs = Math.round(performance.now() - started);
        this._succeed(meta.latencyMs);
        return { ok: true, data: parsed, raw: text, meta };
      } catch (err) {
        const aborted = err && err.name === 'AbortError';
        if (aborted && externalSignal && externalSignal.aborted) {
          lastErr = 'cancelled';
          lastCode = 'CANCELLED';
          break;
        }
        if (aborted) {
          lastErr = `timed out after ${timeoutMs}ms`;
          lastCode = 'TIMEOUT';
          this.stats.timeouts++;
          break;                      // the deadline is global - never retry past it
        }
        lastErr = (err && err.message) || String(err);
        lastCode = (err && err.code) || 'NETWORK';
        if (lastCode === 'AUTH') break;   // a bad key will not fix itself on retry
        if (attempt < this.config.maxAttempts) this.stats.retries++;
      } finally {
        clearTimeout(timer);
        if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }

    meta.latencyMs = Math.round(performance.now() - started);
    this.stats.failed++;
    this.stats.lastError = lastErr;
    this._emit();
    return { ok: false, error: lastErr, code: lastCode, meta };
  }

  _succeed(latency) {
    this.stats.ok++;
    this.stats.totalLatency += latency;
    this.stats.lastLatency = latency;
    this.stats.lastError = null;
    this._emit();
  }

  /** Plain-text completion. Same deadline semantics, no schema. */
  async chatText(opts) {
    const started = performance.now();
    const timeoutMs = opts.timeoutMs ?? this.config.timeoutMs;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const body = this._buildBody({
        system: opts.system || '',
        messages: opts.messages || [],
        maxTokens: opts.maxTokens ?? this.config.maxTokens,
        temperature: opts.temperature ?? this.config.temperature,
        jsonMode: false,
      });
      const { text } = await this._request(body, ctrl.signal);
      return { ok: true, data: text, meta: { latencyMs: Math.round(performance.now() - started) } };
    } catch (err) {
      const aborted = err && err.name === 'AbortError';
      return {
        ok: false,
        error: aborted ? `timed out after ${timeoutMs}ms` : (err && err.message) || String(err),
        code: aborted ? 'TIMEOUT' : (err && err.code) || 'NETWORK',
        meta: { latencyMs: Math.round(performance.now() - started) },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Tiny round trip proving endpoint + key + model all work. Used by the config modal. */
  async testConnection(timeoutMs = 8000) {
    const started = performance.now();
    const r = await this.chatJSON({
      system: 'Reply with exactly {"ok":true} and nothing else.',
      messages: [{ role: 'user', content: 'ping' }],
      timeoutMs,
      maxTokens: 32,
      temperature: 0,
    });
    return {
      ok: r.ok,
      latencyMs: Math.round(performance.now() - started),
      error: r.error || null,
      code: r.code || null,
      model: this.config.model,
      provider: this.config.provider,
    };
  }

  /** GET /models - populates the model dropdown, mainly for local servers. */
  async listModels(timeoutMs = 6000) {
    if (this.config.dialect === 'anthropic') {
      return { ok: true, models: PROVIDER_PRESETS.anthropic.models };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${resolveBaseUrl(this.config)}/models`, {
        headers: this._headers(),
        signal: ctrl.signal,
      });
      if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
      const json = await res.json();
      const models = (json.data || json.models || [])
        .map((m) => m.id || m.name)
        .filter(Boolean)
        .sort();
      return { ok: true, models };
    } catch (err) {
      return { ok: false, models: [], error: (err && err.message) || String(err) };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Process-wide singleton. Rehydrated from Dexie at boot by App.jsx. */
export const llmClient = new LLMClient();

export default llmClient;
