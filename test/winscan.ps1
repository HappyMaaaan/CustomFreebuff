Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinScan {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$fg = [WinScan]::GetForegroundWindow()
$list = New-Object System.Collections.ArrayList
$cb = [WinScan+EnumWindowsProc]{
  param($hWnd, $lParam)
  $pidOut = 0
  [WinScan]::GetWindowThreadProcessId($hWnd, [ref]$pidOut) | Out-Null
  $len = [WinScan]::GetWindowTextLength($hWnd)
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [WinScan]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
  $r = New-Object WinScan+RECT
  [WinScan]::GetWindowRect($hWnd, [ref]$r) | Out-Null
  $list.Add([pscustomobject]@{
    z = $list.Count
    hwnd = ('0x{0:X}' -f $hWnd.ToInt64())
    pid = $pidOut
    title = $sb.ToString()
    visible = [WinScan]::IsWindowVisible($hWnd)
    minimized = [WinScan]::IsIconic($hWnd)
    rect = "$($r.Left),$($r.Top) $($r.Right),$($r.Bottom)"
    fg = ($hWnd -eq $fg)
  }) | Out-Null
  return $true
}
[WinScan]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null

$list | Where-Object { $_.visible -or $_.pid -in @(1676,19296,19284,14288) } |
  Select-Object -First 25 |
  Format-Table z, pid, fg, minimized, title, rect -AutoSize | Out-String -Width 200
