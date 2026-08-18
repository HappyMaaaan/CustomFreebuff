/**
 * lib/win.mjs — Windows-only OS window helpers, used right after launching
 * Freebuff to check that the window is REALLY on the user's screen:
 *   - scanOsWindows(): top-level windows in Z-order, with virtual-desktop id,
 *     visibility and rect (this is what "visible to Chromium" cannot tell),
 *   - forceWindowVisible(hwnd): restore + foreground the window,
 *   - captureDesktopPng(path): screenshot of the primary screen.
 *
 * All PowerShell invocations use -EncodedCommand (base64 UTF-16LE), which
 * avoids every quoting/escaping problem.
 */

import { execFile } from 'node:child_process'

const isWin = process.platform === 'win32'

function runPs(script) {
  return new Promise((resolve) => {
    if (!isWin) return resolve({ err: new Error('not windows'), stdout: '' })
    const b64 = Buffer.from(script, 'utf16le').toString('base64')
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
      { timeout: 25000, windowsHide: true },
      (err, stdout) => resolve({ err, stdout }),
    )
  })
}

const SCAN_PS = String.raw`
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FbWinScan {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc c, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder t, int m);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindowDesktopId(IntPtr h, out IntPtr d);
  public struct RECT { public int L, T, Rt, B; }
}
"@
$fg = [FbWinScan]::GetForegroundWindow()
$fgDesk = [IntPtr]::Zero
[FbWinScan]::GetWindowDesktopId($fg, [ref]$fgDesk) | Out-Null
$rows = New-Object System.Collections.ArrayList
$cb = [FbWinScan+EnumProc]{
  param($h, $l)
  $p = 0
  [FbWinScan]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
  $n = [FbWinScan]::GetWindowTextLength($h)
  $sb = New-Object System.Text.StringBuilder ($n + 1)
  [FbWinScan]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
  $r = New-Object FbWinScan+RECT
  [FbWinScan]::GetWindowRect($h, [ref]$r) | Out-Null
  $d = [IntPtr]::Zero
  [FbWinScan]::GetWindowDesktopId($h, [ref]$d) | Out-Null
  $null = $rows.Add([pscustomobject]@{
    z = $rows.Count
    hwnd = $h.ToInt64()
    pid = $p
    title = $sb.ToString()
    vis = [FbWinScan]::IsWindowVisible($h)
    min = [FbWinScan]::IsIconic($h)
    rect = "$($r.L),$($r.T) $($r.Rt),$($r.B)"
    desk = $d.ToInt64()
    fg = ($h -eq $fg)
  })
  return $true
}
[FbWinScan]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
[pscustomobject]@{ fgDesk = $fgDesk.ToInt64(); windows = $rows } | ConvertTo-Json -Compress -Depth 4
`

/** Scans top-level OS windows (across virtual desktops) in Z-order.
 *  Returns { fgDesk, windows: [...] } or null when unavailable. */
export async function scanOsWindows() {
  const { err, stdout } = await runPs(SCAN_PS)
  if (err || !stdout) return null
  try {
    const parsed = JSON.parse(stdout)
    if (!Array.isArray(parsed.windows)) return null
    return parsed
  } catch {
    return null
  }
}

const FORCE_VISIBLE_PS = String.raw`
param([Int64]$hwnd)
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);' -Name U -Namespace W -PassThru | Out-Null
$ok1 = [W.U]::ShowWindow([IntPtr]$hwnd, 9)
$ok2 = [W.U]::SetForegroundWindow([IntPtr]$hwnd)
Write-Output "restore=$ok1 fg=$ok2"
`

/** Restores (un-minimizes) and foregrounds the window with the given handle.
 *  Returns the { restore, fg } booleans, or null on failure. */
export async function forceWindowVisible(hwnd) {
  const body = FORCE_VISIBLE_PS.replace('param([Int64]$hwnd)\n', '')
  const { err, stdout } = await runPs(`$hwnd = [Int64]${Number(hwnd)}\n${body}`)
  if (err) return null
  const m = String(stdout).match(/restore=(True|False) fg=(True|False)/)
  return m ? { restore: m[1] === 'True', fg: m[2] === 'True' } : null
}

const CAPTURE_PS = String.raw`
param([string]$path)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "saved"
`

/** Captures the primary screen to a PNG file. Returns true on success. */
export async function captureDesktopPng(pngPath) {
  const { err, stdout } = await runPs(`param([string]$path)\n${CAPTURE_PS}`)
  return !err && String(stdout).includes('saved')
}
