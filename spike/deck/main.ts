import { formatReport, runDiagnostics, type DiagnosticsReport } from './diagnostics'

/**
 * Entry for the shell spike. Runs the suite, shows it on screen, and — when a
 * shell exposes a way to — writes it somewhere a terminal can read, so the whole
 * thing can be driven over SSH on a Deck with no one looking at the screen.
 */

declare global {
  interface Window {
    /** Tauri injects this; used to report back to the Rust side and exit. */
    __TAURI_INTERNALS__?: { invoke(command: string, payload: unknown): Promise<unknown> }
    /** Electron preload injects this. */
    __SPIKE_REPORT__?: (report: DiagnosticsReport) => void
    /** Read by a headless driver via CDP or the page itself. */
    __SPIKE_RESULT__?: DiagnosticsReport
  }
}

function detectShell(): string {
  if (window.__TAURI_INTERNALS__) return 'tauri (webkitgtk)'
  if (navigator.userAgent.includes('Electron')) return 'electron (chromium)'
  return 'browser'
}

async function main(): Promise<void> {
  const stage = document.getElementById('stage')!
  const out = document.getElementById('out')!
  const shell = detectShell()

  // Give the gamepad a moment: it only appears after the first input event on
  // some platforms, so the panel says so rather than silently reporting none.
  out.textContent = `shell ${shell}\npress any controller button, then wait 10s…`
  await new Promise((resolve) => setTimeout(resolve, 2500))

  const report = await runDiagnostics(stage, shell)
  out.textContent = formatReport(report)
  out.parentElement!.querySelector('pre')!.className = report.verdict

  window.__SPIKE_RESULT__ = report
  console.log('SPIKE_RESULT_JSON', JSON.stringify(report))

  window.__SPIKE_REPORT__?.(report)
  await window.__TAURI_INTERNALS__?.invoke('report', { report }).catch(() => undefined)
}

void main()
