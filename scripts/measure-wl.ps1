<#
  1 つのコマンドを N 回 (既定 5 回) 実行し、壁時計時間とピーク ワーキング セットを表にします
  (Windows PowerShell 5.1。Task 14 C2、Mac 側の基準は evidence/checkpoints/step_00_baseline.md)。

  使い方:
    powershell -ExecutionPolicy Bypass -File scripts\measure-wl.ps1 -Exe bin\wl.exe -ArgLine ls

  -ArgLine は 1 つの文字列のまま子のコマンドラインになります (空白を含むパスは中で "..." で囲む)。

  各回は 2 回実行します。1 回目はポーリングなし (WaitForExit だけ) で、その時間を Wall_s として報告します
  (ポーリングの CPU 負荷が遅いマシンで壁時計時間を膨らませないように)。2 回目はメモリ用です。
  メモリはプロセス ツリー全体で見ます: 子を起動するコマンド (ランチャーや wl harvest が呼ぶ claude) では
  親だけでは小さすぎる。開始直後と -PollMs (既定 20) ごとに子孫を探し (Toolhelp スナップショット)、
  各プロセスの PeakWorkingSet64 (OS が持つ最大値) を読みます。
    Wall_s        ポーリングなしの回の壁時計時間 (報告する値)
    PolledWall_s  メモリ用の回の壁時計時間 (参考)
    PeakWS_MiB    ツリー内で最大のプロセスのピーク (Mac の /usr/bin/time -l の max RSS に相当)
    TreeSumWS_MiB 各プロセスのピークの合計 (同時に載っていた量の上限)
    Names         ツリーに入ったプロセス名 (重複なし)。CreateNoWindow の子は非表示コンソールを持つので、
                  その conhost も子孫として数えられる (Go の wl.exe は Procs 2 = wl + conhost)
  終了直前の -PollMs 未満の増加は取りこぼし得ます。出力の中身は表示しません (行数と終了コードだけ)。
  子の終了コードが 1 回でも 0 以外なら、このスクリプトも終了コード 1 で終わります。
  子には PYTHONIOENCODING=utf-8 を渡します (Python がパイプへ CJK を書くときに cp932 で落ちないように)。
#>
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string]$ArgLine = "",
    [int]$Runs = 5,
    [int]$PollMs = 20,
    [string]$Label = ""
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace WlMeasure {
    public static class Toolhelp {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct PROCESSENTRY32W {
            public uint dwSize; public uint cntUsage; public uint th32ProcessID; public IntPtr th32DefaultHeapID;
            public uint th32ModuleID; public uint cntThreads; public uint th32ParentProcessID; public int pcPriClassBase;
            public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
        }
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32W entry);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32W entry);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr handle);

        // pid -> parent pid for every process in the system.
        public static Dictionary<int, int> ParentMap() {
            var map = new Dictionary<int, int>();
            IntPtr snap = CreateToolhelp32Snapshot(2 /* TH32CS_SNAPPROCESS */, 0);
            if (snap == new IntPtr(-1)) return map;
            try {
                var e = new PROCESSENTRY32W();
                e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32W));
                if (Process32FirstW(snap, ref e)) {
                    do { map[(int)e.th32ProcessID] = (int)e.th32ParentProcessID; } while (Process32NextW(snap, ref e));
                }
            } finally { CloseHandle(snap); }
            return map;
        }
    }
}
"@

if (Test-Path -LiteralPath $Exe -PathType Leaf) {
    $ExePath = (Resolve-Path -LiteralPath $Exe).Path
} else {
    $ExePath = (Get-Command $Exe).Source
}
if (-not $Label) { $Label = "$Exe $ArgLine" }

function Measure-Once([bool]$Poll) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ExePath
    $psi.Arguments = $ArgLine
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8"

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $root = [System.Diagnostics.Process]::Start($psi)
    $outTask = $root.StandardOutput.ReadToEndAsync()
    $errTask = $root.StandardError.ReadToEndAsync()
    $tree = @{ $root.Id = $root }   # pid -> Process
    $peak = @{}                     # pid -> bytes
    $names = @{}                    # pid -> process name
    if ($Poll) {
        # Sample before the first exit test, so a process that exits at once still gets a reading.
        do {
            foreach ($procId in @($tree.Keys)) {
                try {
                    $tree[$procId].Refresh()
                    $v = $tree[$procId].PeakWorkingSet64
                    if (-not $names.ContainsKey($procId)) { $names[$procId] = $tree[$procId].ProcessName }
                    if (-not $peak.ContainsKey($procId) -or $v -gt $peak[$procId]) { $peak[$procId] = $v }
                } catch { }
            }
            $map = [WlMeasure.Toolhelp]::ParentMap()
            foreach ($kv in $map.GetEnumerator()) {
                if ($tree.ContainsKey($kv.Value) -and -not $tree.ContainsKey($kv.Key) -and $kv.Key -ne $kv.Value) {
                    try { $tree[$kv.Key] = [System.Diagnostics.Process]::GetProcessById($kv.Key) } catch { }
                }
            }
            if ($root.HasExited) { break }
            Start-Sleep -Milliseconds $PollMs
        } while ($true)
    }
    $root.WaitForExit()
    $sw.Stop()
    $out = $outTask.Result
    [void]$errTask.Result
    $max = 0; $sum = 0
    foreach ($v in @($peak.Values)) { $sum += $v; if ($v -gt $max) { $max = $v } }
    [pscustomobject]@{
        Wall   = [math]::Round($sw.Elapsed.TotalSeconds, 2)
        Peak   = [math]::Round($max / 1MB, 1)
        Sum    = [math]::Round($sum / 1MB, 1)
        Procs  = $tree.Count
        Exit   = $root.ExitCode
        Lines  = @($out -split "`r?`n" | Where-Object { $_ -ne "" }).Count
        Names  = (@($names.Values | Sort-Object -Unique) -join ",")
    }
}

$rows = @()
for ($i = 1; $i -le $Runs; $i++) {
    $plain = Measure-Once $false
    $polled = Measure-Once $true
    $rows += [pscustomobject]@{
        Run           = $i
        Wall_s        = $plain.Wall
        PolledWall_s  = $polled.Wall
        PeakWS_MiB    = $polled.Peak
        TreeSumWS_MiB = $polled.Sum
        Procs         = $polled.Procs
        Exit          = "$($plain.Exit)/$($polled.Exit)"
        Lines         = "$($plain.Lines)/$($polled.Lines)"
        Names         = $polled.Names
        Failed        = ($plain.Exit -ne 0 -or $polled.Exit -ne 0)
    }
}

Write-Host "Command: $Label"
Write-Host "Exe: $ExePath"
$rows | Select-Object Run, Wall_s, PolledWall_s, PeakWS_MiB, TreeSumWS_MiB, Procs, Exit, Lines, Names |
    Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$walls = @($rows | ForEach-Object { $_.Wall_s } | Sort-Object)
$median = $walls[[int][math]::Floor(($walls.Count - 1) / 2)]
if ($walls.Count % 2 -eq 0) { $median = ($walls[$walls.Count / 2 - 1] + $walls[$walls.Count / 2]) / 2 }
$summary = [pscustomobject]@{
    Command        = $Label
    Runs           = $Runs
    MeanWall_s     = [math]::Round(($rows | Measure-Object Wall_s -Average).Average, 2)
    MedianWall_s   = [math]::Round($median, 2)
    MeanPeakWS_MiB = [math]::Round(($rows | Measure-Object PeakWS_MiB -Average).Average, 1)
    MaxTreeSum_MiB = ($rows | Measure-Object TreeSumWS_MiB -Maximum).Maximum
    ExitCodes      = (@($rows | ForEach-Object { $_.Exit } | Sort-Object -Unique) -join ",")
    Lines          = (@($rows | ForEach-Object { $_.Lines } | Sort-Object -Unique) -join ",")
}
$summary | Format-List | Out-String | Write-Host
if (@($rows | Where-Object { $_.Failed }).Count -gt 0) {
    Write-Host "a child exited non-zero"
    exit 1
}
