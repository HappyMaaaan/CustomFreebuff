/**
 * lib/win.mjs — Windows-only OS window helpers, used right after launching
 * Freebuff to check that the window is REALLY on the user's screen:
 *   - scanOsWindows(): top-level windows in Z-order, with owning process
 *     name, virtual-desktop id, visibility and rect. The process name is
 *     what lets us tell the real Freebuff window apart from other windows
 *     whose TITLE merely contains "freebuff" (Chrome, Discord, Explorer…),
 *   - forceWindowVisible(hwnd): restore + bring to top + foreground the
 *     window. SetWindowPos(HWND_TOPMOST) is a z-order operation, so it works
 *     from a background process — unlike SetForegroundWindow alone, which
 *     Windows' foreground lock can silently refuse,
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
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint a, bool b, int p);
  [DllImport("kernel32.dll")] public static extern bool QueryFullProcessImageName(IntPtr h, uint f, StringBuilder n, ref uint s);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
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
  # Owning process image name (e.g. "Freebuff.exe"), via the window's PID.
  $exe = ''
  if ($p -gt 0) {
    $ph = [FbWinScan]::OpenProcess(0x1000, $false, $p)
    if ($ph -ne [IntPtr]::Zero) {
      $sb2 = New-Object System.Text.StringBuilder 4096
      $len = [uint32]$sb2.Capacity
      if ([FbWinScan]::QueryFullProcessImageName($ph, 0, $sb2, [ref]$len)) { $exe = $sb2.ToString() }
      [FbWinScan]::CloseHandle($ph) | Out-Null
    }
  }
  $proc = ''
  if ($exe) { $proc = [System.IO.Path]::GetFileName($exe) }
  $null = $rows.Add([pscustomobject]@{
    z = $rows.Count
    hwnd = $h.ToInt64()
    pid = $p
    proc = $proc
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
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FbWinFg {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
$h = [IntPtr]$hwnd
$SWP_NOMOVE = 0x0002
$SWP_NOSIZE = 0x0001
$SWP_SHOWWINDOW = 0x0040
$TOPMOST = [IntPtr](-1)
$NOTOPMOST = [IntPtr](-2)
# 1. Restore (un-minimize) and make sure the window is shown.
$restore = [FbWinFg]::ShowWindow($h, 9)
# 2. Jump to the top of the z-order — a z-order operation is NOT blocked by
#    Windows' foreground lock, so it works from a background process.
$top = [FbWinFg]::SetWindowPos($h, $TOPMOST, 0, 0, 0, 0, ($SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_SHOWWINDOW))
$unTop = [FbWinFg]::SetWindowPos($h, $NOTOPMOST, 0, 0, 0, 0, ($SWP_NOMOVE -bor $SWP_NOSIZE))
# 3. Foreground it. A synthetic ALT press releases Windows' foreground lock
#    so SetForegroundWindow is allowed from a non-foreground process.
[FbWinFg]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
$fg = [FbWinFg]::SetForegroundWindow($h)
[FbWinFg]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
$btt = [FbWinFg]::BringWindowToTop($h)
Write-Output "restore=$restore top=$top unTop=$unTop fg=$fg btt=$btt"
`

/** Restores, brings to the top of the z-order and foregrounds the window with
 *  the given handle. Returns { restore, top, unTop, fg, btt } or null. */
export async function forceWindowVisible(hwnd) {
  const body = FORCE_VISIBLE_PS.replace('param([Int64]$hwnd)\n', '')
  const { err, stdout } = await runPs(`$hwnd = [Int64]${Number(hwnd)}\n${body}`)
  if (err) return null
  const m = String(stdout).match(/restore=(True|False) top=(True|False) unTop=(True|False) fg=(True|False) btt=(True|False)/)
  return m
    ? {
        restore: m[1] === 'True',
        top: m[2] === 'True',
        unTop: m[3] === 'True',
        fg: m[4] === 'True',
        btt: m[5] === 'True',
      }
    : null
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
