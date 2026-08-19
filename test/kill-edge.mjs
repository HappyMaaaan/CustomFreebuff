/**
 * test/kill-edge.mjs — Reliably terminates the headless Edge used by the
 * e2e tests on Windows.
 *
 * On Windows, the spawned Edge process exits immediately (code 0): Edge
 * relaunches itself through its compatibility layer, so `child.kill()` can
 * never reach the REAL browser. The real browser then keeps its debug port
 * and all CDP sockets alive — which makes test processes hang (open handles)
 * and pollutes the ports for the next runs.
 *
 * The fix: kill every msedge.exe whose command line references the test
 * profile directory. Only the test's own processes match; the user's real
 * Edge browser is never touched.
 */

import { execFile } from 'node:child_process'
import path from 'node:path'

export function killEdgeByProfile(profile) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve()
    const fragment = path.basename(profile)
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*${fragment}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ],
      { windowsHide: true },
      () => resolve(),
    )
  })
}
