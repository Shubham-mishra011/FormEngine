import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { api, exportUrls, type About, type BackupInfo, type ImportSummary } from '../api'
import { ConfirmDialog } from '../components/Modal'
import { readFileText } from '../files'
import { formatSize as fmtSize } from '../format'

const MAX_FILE_BYTES = 20_000_000

interface Pending {
  source: string
  text: string
  summary: ImportSummary
}

function Row({ label, t }: { label: string; t: { add: number; skip: number } }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className={t.add > 0 ? 'num add' : 'num'}>{t.add}</td>
      <td className="num">{t.skip}</td>
    </tr>
  )
}

/** What an import would do, shown before anything is written. */
function PreviewPanel({
  pending,
  busy,
  onConfirm,
  onCancel,
}: {
  pending: Pending
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { summary } = pending
  const nothingNew = summary.valid && summary.tasks.add === 0 && summary.categories.add === 0
  return (
    <div className="card preview" aria-live="polite">
      <h3>Import preview — {pending.source}</h3>
      {!summary.valid ? (
        <div role="alert" className="form-error">
          <p>
            <strong>This file can’t be imported. Nothing was changed.</strong>
          </p>
          <ul>
            {summary.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Records</th>
                <th scope="col">Will be added</th>
                <th scope="col">Skipped (already here)</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Categories" t={summary.categories} />
              <Row label="Tasks" t={summary.tasks} />
              <Row label="Subtasks" t={summary.subtasks} />
              {summary.tags && <Row label="Tags" t={summary.tags} />}
              {summary.focusSessions && <Row label="Focus sessions" t={summary.focusSessions} />}
            </tbody>
          </table>
          {summary.warnings.length > 0 && (
            <details>
              <summary>{summary.warnings.length} note(s)</summary>
              <ul>
                {summary.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="hint">
            Existing tasks are never changed or removed. A safety backup of your current data is made automatically before
            anything is added.
          </p>
        </>
      )}
      <div className="form-actions">
        {summary.valid && (
          <button className="primary" onClick={onConfirm} disabled={busy || nothingNew}>
            {nothingNew ? 'Nothing new to import' : `Import ${summary.tasks.add} task${summary.tasks.add === 1 ? '' : 's'}`}
          </button>
        )}
        <button onClick={onCancel} disabled={busy}>
          {summary.valid ? 'Cancel' : 'Close'}
        </button>
      </div>
    </div>
  )
}

export function DataPage({ onDataChanged }: { onDataChanged: () => void }) {
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [folder, setFolder] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [about, setAbout] = useState<About | null>(null)
  const [restoring, setRestoring] = useState<BackupInfo | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadBackups = useCallback(async () => {
    try {
      const r = await api.listBackups()
      setBackups(r.backups)
      setFolder(r.folder)
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Could not list backups.' })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .listBackups()
      .then((r) => {
        if (cancelled) return
        setBackups(r.backups)
        setFolder(r.folder)
      })
      .catch((e: unknown) => {
        if (!cancelled) setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Could not list backups.' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.about().then((a) => !cancelled && setAbout(a), () => undefined) // purely informational
    return () => {
      cancelled = true
    }
  }, [])

  async function confirmRestore() {
    if (!restoring) return
    const target = restoring
    setRestoring(null)
    setBusy(true)
    setMessage(null)
    try {
      const r = await api.restoreBackup(target.name)
      setMessage({
        kind: 'ok',
        text: `Restored ${target.name}: ${r.tasksBefore} task(s) before → ${r.tasksAfter} now. Safety backup of the previous data: ${r.safetyBackup}.`,
      })
      setPending(null)
      onDataChanged()
      await loadBackups()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Restore failed. Nothing was changed.' })
    } finally {
      setBusy(false)
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow choosing the same file again
    if (!file) return
    setMessage(null)
    if (file.size > MAX_FILE_BYTES) {
      setMessage({ kind: 'error', text: 'That file is larger than 20 MB, which is more than a TaskFlow export can be.' })
      return
    }
    try {
      const text = await readFileText(file)
      setPending({ source: file.name, text, summary: await api.previewImport(text) })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not read that file.' })
    }
  }

  async function previewBackup(name: string) {
    setMessage(null)
    try {
      const text = await api.readBackup(name)
      setPending({ source: `backup ${name}`, text, summary: await api.previewImport(text) })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not read that backup.' })
    }
  }

  async function confirmImport() {
    if (!pending) return
    setBusy(true)
    try {
      const result = await api.applyImport(pending.text)
      const s = result.summary
      setMessage({
        kind: 'ok',
        text:
          `Imported ${s.tasks.add} task(s), ${s.subtasks.add} subtask(s) and ${s.categories.add} categor${s.categories.add === 1 ? 'y' : 'ies'}; ` +
          `${s.tasks.skip} duplicate task(s) skipped.` +
          (result.safetyBackup ? ` Safety backup: ${result.safetyBackup}.` : ''),
      })
      setPending(null)
      onDataChanged()
      await loadBackups()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Import failed.' })
    } finally {
      setBusy(false)
    }
  }

  async function makeBackup() {
    setBusy(true)
    setMessage(null)
    try {
      const info = await api.createBackup()
      setMessage({ kind: 'ok', text: `Backup saved as ${info.name} (${fmtSize(info.sizeBytes)}).` })
      await loadBackups()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Backup failed.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="data-page" aria-labelledby="data-h">
      <h2 id="data-h">Backup &amp; data</h2>

      {message && (
        <p className={message.kind === 'ok' ? 'notice' : 'banner'} role={message.kind === 'ok' ? 'status' : 'alert'}>
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)}>Dismiss</button>
        </p>
      )}

      <div className="card">
        <h3>Export</h3>
        <p className="hint">Download a copy of your data. Nothing is removed from TaskFlow.</p>
        <div className="form-actions">
          <a className="button" href={exportUrls.json} download>
            Download everything (JSON)
          </a>
          <a className="button" href={exportUrls.csv} download>
            Download tasks (CSV)
          </a>
        </div>
        <p className="hint">
          JSON contains tasks, subtasks, categories, tags, recurrence, reminders and focus sessions and can be imported again. CSV is
          for spreadsheets only. Attached files are not part of an export.
        </p>
      </div>

      <div className="card">
        <h3>Import</h3>
        <p className="hint">Choose a TaskFlow JSON export. You will see what would be added or skipped before anything changes.</p>
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} aria-label="Choose a TaskFlow JSON file to import" />
      </div>

      {pending && (
        <PreviewPanel pending={pending} busy={busy} onConfirm={() => void confirmImport()} onCancel={() => setPending(null)} />
      )}

      <div className="card">
        <h3>Backups</h3>
        <p className="hint">
          A backup is a full snapshot of the database, saved on this computer
          {folder ?? about?.backupDirectory ? (
            <>
              {' '}
              in <code>{folder ?? about?.backupDirectory}</code>
            </>
          ) : null}
          . Backups are never overwritten or deleted by TaskFlow.
        </p>
        {about && (
          <p className="hint">
            Attached files live in <code>{about.attachmentsDirectory}</code>. They are not inside backups or exports, so copy that
            folder too if you move to another computer.
          </p>
        )}
        <div className="form-actions">
          <button className="primary" onClick={() => void makeBackup()} disabled={busy}>
            Create backup now
          </button>
        </div>
        {backups.length === 0 ? (
          <p className="empty" role="status">
            No backups yet.
          </p>
        ) : (
          <ul className="backup-list">
            {backups.map((b) => (
              <li key={b.name}>
                <div>
                  <span className="backup-name">{b.name}</span>
                  <span className="hint">
                    {' '}
                    · {new Date(b.createdAt).toLocaleString()} · {fmtSize(b.sizeBytes)}
                  </span>
                </div>
                <span className="form-actions">
                  <button onClick={() => void previewBackup(b.name)} aria-label={`Preview restoring ${b.name}`}>
                    Preview restore
                  </button>
                  <button className="danger" onClick={() => setRestoring(b)} disabled={busy} aria-label={`Restore ${b.name}`}>
                    Restore…
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <details className="how">
          <summary>How restoring works</summary>
          <p>
            <strong>Preview restore</strong> is gentle: it only <em>adds</em> what is missing. <strong>Restore…</strong> is a
            full rollback: it <em>replaces</em> everything with the contents of that backup.
          </p>
          <ol>
            <li>
              Press <strong>Preview restore</strong> next to a backup (or choose an exported JSON file above).
            </li>
            <li>Check the counts. Records that already exist are skipped, so restoring never creates duplicates.</li>
            <li>
              Press <strong>Import</strong>. A fresh safety backup is made first, and the import is all-or-nothing.
            </li>
          </ol>
          <p className="hint">
            Previewing and importing adds back anything that is missing. To go back to an exact earlier state use{' '}
            <strong>Restore…</strong>; a safety backup of the current data is taken first, so a restore can itself be undone by
            restoring that safety backup.
          </p>
        </details>
      </div>
      {restoring && (
        <ConfirmDialog
          title="Replace all data with this backup?"
          message={
            <>
              Everything currently in TaskFlow (tasks, categories, tags, focus history…) will be <strong>replaced</strong> by the
              contents of <strong>{restoring.name}</strong>. A safety backup of your current data is taken first, and the swap is
              all-or-nothing.
            </>
          }
          confirmLabel="Replace all data"
          danger
          onCancel={() => setRestoring(null)}
          onConfirm={() => void confirmRestore()}
        />
      )}
    </section>
  )
}
