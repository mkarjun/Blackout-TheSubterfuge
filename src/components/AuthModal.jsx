import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './ApiConfigModal.jsx';
import {
  isCloudConfigured, signInWithGoogle, signOutUser, onAuthChanged,
  backupToCloud, restoreFromCloud, getCloudMeta,
  downloadSnapshotFile, importSnapshotFile,
} from '../services/authService.js';
import { getDbStats, clearAll } from '../services/memoryStore.js';

/**
 * AuthModal - saves, backups and the optional cloud bridge.
 *
 * Local IndexedDB is the source of truth. Google sign-in exists purely to move a
 * snapshot off this machine, and the panel says so plainly - if Firebase is not
 * configured the local half still works, which is the common case.
 */

export default function AuthModal({ onClose }) {
  const cloudReady = isCloudConfigured();
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(null);
  const [status, setStatus] = useState(null);
  const [meta, setMeta] = useState(null);
  const [stats, setStats] = useState(null);
  const [importMode, setImportMode] = useState('merge');
  const fileRef = useRef(null);

  const refreshStats = useCallback(async () => {
    setStats(await getDbStats());
  }, []);

  useEffect(() => { refreshStats(); }, [refreshStats]);

  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;
    onAuthChanged((u) => {
      if (cancelled) return;
      setUser(u);
      if (u) getCloudMeta().then((m) => setMeta(m.ok ? m : null));
    }).then((fn) => { unsub = fn; });
    return () => { cancelled = true; unsub(); };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (key, fn, successMessage) => {
    setBusy(key);
    setStatus(null);
    const result = await fn();
    setBusy(null);
    if (result?.ok) {
      setStatus({ ok: true, text: successMessage(result) });
      refreshStats();
      if (key === 'backup') getCloudMeta().then((m) => setMeta(m.ok ? m : null));
    } else {
      setStatus({ ok: false, text: result?.error || result?.reason || 'Failed' });
    }
  };

  return (
    <Modal title="Saves &amp; sync" subtitle="IndexedDB is the source of truth" onClose={onClose}>
      {/* -------------------------------------------------------- local */}
      <section>
        <div className="panel-title mb-2">This device</div>
        <div className="mb-3 grid grid-cols-4 gap-2 rounded border border-edge bg-ink/60 p-2.5 text-center">
          <Counter label="sessions" value={stats?.sessions} />
          <Counter label="npc memories" value={stats?.memories} />
          <Counter label="events" value={stats?.events} />
          <Counter label="settings" value={stats?.settings} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn"
            disabled={busy === 'download'}
            onClick={() => run('download', () => downloadSnapshotFile(), (r) =>
              `Downloaded ${r.counts.sessions} session(s).`)}
          >
            Download save file
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) {
                run('import', () => importSnapshotFile(file, importMode), (r) =>
                  `Imported ${r.counts.sessions} session(s), ${r.counts.memories} memories.`);
              }
            }}
          />
          <button className="btn" disabled={busy === 'import'} onClick={() => fileRef.current?.click()}>
            Import save file
          </button>

          <select
            className="field w-auto"
            value={importMode}
            onChange={(e) => setImportMode(e.target.value)}
          >
            <option value="merge">merge</option>
            <option value="replace">replace</option>
          </select>
        </div>
      </section>

      <div className="my-4 h-px bg-edge" />

      {/* -------------------------------------------------------- cloud */}
      <section>
        <div className="panel-title mb-2">Cloud backup (optional)</div>

        {!cloudReady && (
          <p className="text-[11px] leading-relaxed text-dim">
            Firebase is not configured for this build. Copy <code className="text-slate-400">.env.example</code>
            {' '}to <code className="text-slate-400">.env</code>, fill in the <code className="text-slate-400">VITE_FIREBASE_*</code>
            {' '}values and restart the dev server to enable Google sign-in and snapshot backup.
            Everything else keeps working without it.
          </p>
        )}

        {cloudReady && !user && (
          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              disabled={busy === 'signin'}
              onClick={() => run('signin', signInWithGoogle, (r) => `Signed in as ${r.user.email}.`)}
            >
              Sign in with Google
            </button>
            <span className="text-[10px] text-dim">Only your save snapshot is uploaded. Never your API key.</span>
          </div>
        )}

        {cloudReady && user && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[11px] text-slate-300">
                {user.displayName || user.email}
                {meta?.updatedAt && (
                  <div className="text-[10px] text-dim">
                    Last backup {new Date(meta.updatedAt).toLocaleString()} - {Math.round((meta.bytes || 0) / 1024)}KB
                  </div>
                )}
                {!meta && <div className="text-[10px] text-dim">No cloud backup yet.</div>}
              </div>
              <button className="btn" onClick={() => run('signout', signOutUser, () => 'Signed out.')}>
                Sign out
              </button>
            </div>
            <div className="flex gap-2">
              <button
                className="btn"
                disabled={busy === 'backup'}
                onClick={() => run('backup', backupToCloud, (r) => `Backed up ${Math.round(r.bytes / 1024)}KB.`)}
              >
                {busy === 'backup' ? 'Uploading...' : 'Back up now'}
              </button>
              <button
                className="btn"
                disabled={busy === 'restore'}
                onClick={() => run('restore', () => restoreFromCloud(importMode === 'merge' ? 'merge' : 'replace'),
                  (r) => `Restored ${r.counts.sessions} session(s).`)}
              >
                {busy === 'restore' ? 'Restoring...' : `Restore (${importMode})`}
              </button>
            </div>
          </div>
        )}
      </section>

      {status && (
        <div className={`mt-4 rounded border p-2 text-[11px] ${
          status.ok ? 'border-neon/40 bg-neon/5 text-neon' : 'border-alarm/40 bg-alarm/5 text-alarm'
        }`}
        >
          {status.text}
        </div>
      )}

      <div className="my-4 h-px bg-edge" />

      <section className="flex items-center justify-between gap-3">
        <div>
          <div className="panel-title">Danger zone</div>
          <p className="text-[10px] text-dim">Wipes every session, memory and setting on this device.</p>
        </div>
        <button
          className="btn-danger"
          onClick={async () => {
            // eslint-disable-next-line no-alert
            if (!window.confirm('Erase all local Blackout data? This cannot be undone.')) return;
            await clearAll();
            setStatus({ ok: true, text: 'Local database cleared.' });
            refreshStats();
          }}
        >
          Erase local data
        </button>
      </section>
    </Modal>
  );
}

function Counter({ label, value }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-dim">{label}</div>
      <div className="text-[14px] tabular-nums text-slate-200">{value ?? '-'}</div>
    </div>
  );
}
