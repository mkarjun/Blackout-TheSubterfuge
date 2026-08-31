import React, { useEffect, useMemo, useState } from 'react';
import {
  llmClient, PROVIDER_PRESETS, applyPreset, DEFAULT_LLM_CONFIG,
} from '../services/llmClient.js';
import { saveLlmConfig } from '../services/memoryStore.js';

/**
 * ApiConfigModal - the universal provider panel.
 *
 * Everything is runtime configuration held in IndexedDB, never in the bundle: the
 * same build works against a hosted API or a laptop running Ollama, and a shared
 * build ships no keys. "Test" fires one real round trip so a bad base URL or a model
 * name typo fails here rather than silently degrading every NPC to the fallback.
 */

const PROVIDER_ORDER = ['ollama', 'lmstudio', 'openai', 'anthropic', 'gemini', 'openrouter', 'custom'];

/**
 * Providers that retire a model usually name its replacement in the 404 body. Pull it
 * out so the fix is one click instead of a documentation hunt.
 */
function suggestedModel(error) {
  if (!error) return null;
  const m = String(error).match(/use\s+models\/([\w.:-]+)/i)
    || String(error).match(/use\s+`?([a-z0-9][\w.:-]*(?:flash|pro|mini|turbo)[\w.:-]*)`?/i);
  return m ? m[1] : null;
}

export default function ApiConfigModal({ onClose }) {
  const [config, setConfig] = useState(() => llmClient.getConfig());
  const [headerRows, setHeaderRows] = useState(() =>
    Object.entries(llmClient.getConfig().customHeaders || {}).map(([k, v]) => ({ k, v })));
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saved, setSaved] = useState(false);

  const preset = PROVIDER_PRESETS[config.provider] || PROVIDER_PRESETS.custom;
  const needsKey = preset.keyRequired && !config.apiKey;

  const patch = (delta) => {
    setConfig((prev) => ({ ...prev, ...delta }));
    setSaved(false);
    setTestResult(null);
  };

  const selectProvider = (id) => {
    setConfig((prev) => applyPreset(prev, id));
    setModels([]);
    setTestResult(null);
    setSaved(false);
  };

  const headersObject = useMemo(
    () => Object.fromEntries(headerRows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v])),
    [headerRows],
  );

  /** Apply to the live client so a test uses exactly what is on screen. */
  const commit = () => {
    const next = { ...config, customHeaders: headersObject };
    llmClient.updateConfig(next);
    return next;
  };

  const handleTest = async () => {
    commit();
    setTesting(true);
    setTestResult(null);
    const result = await llmClient.testConnection();
    setTesting(false);
    setTestResult(result);
  };

  const handleFetchModels = async () => {
    commit();
    setLoadingModels(true);
    const result = await llmClient.listModels();
    setLoadingModels(false);
    setModels(result.models || []);
    if (!result.ok) setTestResult({ ok: false, error: result.error, code: 'MODELS' });
  };

  const handleSave = async () => {
    const next = commit();
    await saveLlmConfig(next);
    setSaved(true);
  };

  const handleReset = () => {
    setConfig({ ...DEFAULT_LLM_CONFIG });
    setHeaderRows([]);
    setTestResult(null);
    setSaved(false);
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Modal title="AI provider" subtitle="Universal OpenAI-compatible client" onClose={onClose}>
      {/* provider picker */}
      <div className="mb-4">
        <span className="field-label">Provider</span>
        <div className="flex flex-wrap gap-1.5">
          {PROVIDER_ORDER.map((id) => (
            <button
              key={id}
              className={`btn ${config.provider === id ? 'border-neon text-neon' : ''}`}
              onClick={() => selectProvider(id)}
            >
              {PROVIDER_PRESETS[id].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <span className="field-label">Base URL</span>
          <input
            className="field"
            value={config.baseUrl}
            spellCheck={false}
            onChange={(e) => patch({ baseUrl: e.target.value })}
            placeholder="http://localhost:11434/v1"
          />
          {config.useDevProxy && /localhost:(11434|1234)/.test(config.baseUrl) && (
            <p className="mt-1 text-[10px] text-dim">
              In dev this is routed through the Vite proxy, so Ollama/LM Studio need no CORS setup.
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <span className="field-label">
            API key {preset.keyRequired ? '(required)' : '(not needed for local servers)'}
          </span>
          <input
            className="field"
            type="password"
            value={config.apiKey}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => patch({ apiKey: e.target.value })}
            placeholder={preset.keyRequired ? 'sk-...' : 'leave blank'}
          />
          <label className="mt-1.5 flex items-center gap-2 text-[10px] text-dim">
            <input
              type="checkbox"
              checked={config.persistApiKey}
              onChange={(e) => patch({ persistApiKey: e.target.checked })}
            />
            Remember this key in local IndexedDB (uncheck on a shared machine)
          </label>
        </div>

        <div className="sm:col-span-2">
          <span className="field-label">Model</span>
          <div className="flex gap-2">
            <input
              className="field"
              value={config.model}
              spellCheck={false}
              list="model-options"
              onChange={(e) => patch({ model: e.target.value })}
            />
            <button className="btn whitespace-nowrap" onClick={handleFetchModels} disabled={loadingModels}>
              {loadingModels ? '...' : 'Fetch'}
            </button>
          </div>
          <datalist id="model-options">
            {[...new Set([...(preset.models || []), ...models])].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>

        <NumberField
          label="Timeout (ms)"
          hint="Past this, NPCs use local rules"
          value={config.timeoutMs}
          min={800}
          max={20000}
          step={200}
          onChange={(v) => patch({ timeoutMs: v })}
        />
        <NumberField
          label="Max response tokens"
          hint="Schema fits in ~150"
          value={config.maxTokens}
          min={64}
          max={1024}
          step={16}
          onChange={(v) => patch({ maxTokens: v })}
        />
        <NumberField
          label="Temperature"
          value={config.temperature}
          min={0}
          max={2}
          step={0.1}
          onChange={(v) => patch({ temperature: v })}
        />
        <NumberField
          label="Attempts"
          hint="Structural retries per request"
          value={config.maxAttempts}
          min={1}
          max={4}
          step={1}
          onChange={(v) => patch({ maxAttempts: v })}
        />
      </div>

      {/* custom headers */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="field-label mb-0">Custom headers</span>
          <button className="btn" onClick={() => setHeaderRows((r) => [...r, { k: '', v: '' }])}>
            Add
          </button>
        </div>
        {headerRows.length === 0 && (
          <p className="text-[10px] text-dim">
            For gateways that need extra headers (org ids, routing hints, auth proxies).
          </p>
        )}
        {headerRows.map((row, i) => (
          <div key={i} className="mb-1.5 flex gap-2">
            <input
              className="field"
              placeholder="Header"
              value={row.k}
              onChange={(e) => setHeaderRows((rows) => rows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
            />
            <input
              className="field"
              placeholder="Value"
              value={row.v}
              onChange={(e) => setHeaderRows((rows) => rows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
            />
            <button
              className="btn"
              onClick={() => setHeaderRows((rows) => rows.filter((_, j) => j !== i))}
            >
              x
            </button>
          </div>
        ))}
      </div>

      {/* toggles */}
      <div className="mt-4 flex flex-wrap gap-4">
        <Toggle
          label="Cognitive layer enabled"
          checked={config.enabled}
          onChange={(v) => patch({ enabled: v })}
        />
        <Toggle
          label="Request JSON mode"
          hint="Off for servers that reject response_format"
          checked={config.jsonMode}
          onChange={(v) => patch({ jsonMode: v })}
        />
        <Toggle
          label="Dev proxy for localhost"
          checked={config.useDevProxy}
          onChange={(v) => patch({ useDevProxy: v })}
        />
      </div>

      {/* status */}
      <div className="mt-4 rounded border border-edge bg-ink/60 p-2.5 text-[11px]">
        {testing && <span className="text-dim">Testing {config.model}...</span>}
        {!testing && testResult && (
          <div className={testResult.ok ? 'text-neon' : 'text-alarm'}>
            <span>
              {testResult.ok
                ? `Connected in ${testResult.latencyMs}ms - ${testResult.provider} / ${testResult.model}`
                : `Failed (${testResult.code}): ${testResult.error}`}
            </span>
            {!testResult.ok && suggestedModel(testResult.error) && (
              <button
                className="btn ml-2 border-neon/60 text-neon"
                onClick={() => patch({ model: suggestedModel(testResult.error) })}
              >
                Use {suggestedModel(testResult.error)}
              </button>
            )}
          </div>
        )}
        {!testing && !testResult && (
          <span className="text-dim">
            {needsKey
              ? 'This provider needs a key. Without one the game runs on local rules only.'
              : 'Not tested yet. The game plays fine either way - the model only adds improvised dialogue.'}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button className="btn" onClick={handleReset}>Reset</button>
        <div className="flex gap-2">
          <button className="btn" onClick={handleTest} disabled={testing}>Test</button>
          <button className="btn-primary" onClick={handleSave}>
            {saved ? 'Saved' : 'Save'}
          </button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ shared */

export function Modal({ title, subtitle, onClose, children }) {
  // The header button has always said "Esc"; until now nothing implemented it, so
  // the key fell through to the HUD's handler and paused the run *behind* the modal.
  // The listener is registered in the capture phase precisely so it beats that one,
  // and stops the event rather than letting both fire.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-ink/85 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="panel max-h-[92vh] w-[620px] max-w-full overflow-y-auto p-5">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-100">{title}</h2>
            {subtitle && <p className="text-[10px] text-dim">{subtitle}</p>}
          </div>
          <button className="btn" onClick={onClose}>Esc</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NumberField({ label, hint, value, onChange, ...rest }) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <input
        className="field"
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        {...rest}
      />
      {hint && <p className="mt-0.5 text-[10px] text-dim">{hint}</p>}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[11px] text-slate-300">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="block text-[10px] text-dim">{hint}</span>}
      </span>
    </label>
  );
}
