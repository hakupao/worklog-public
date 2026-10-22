<#
  毎時 0 分に `wl harvest` を静かに実行する Windows タスクスケジューラのタスクを登録します。

  使い方 (PowerShell):
    ./scripts/schtasks-harvest.ps1

  ウィンドウは出ません: 実行は conhost.exe --headless 経由で、出力は
  %USERPROFILE%\.worklog\harvest.log に追記されます（Mac の /tmp/worklog-harvest.log に相当）。
  実行するのはリポジトリの bin\wl.exe (Go 版) です。無ければ登録せずに失敗します
  (先に scripts\update-wl.ps1 で置く)。リポジトリを移動したら再実行してください。
  タスクを削除する場合:
    Unregister-ScheduledTask -TaskName "WorklogHarvest" -Confirm:$false
    Remove-Item "$env:USERPROFILE\.worklog\harvest-task.cmd"
#>

$ErrorActionPreference = "Stop"

$WorklogRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WlExe = Join-Path $WorklogRoot "bin\wl.exe"
if (-not (Test-Path -LiteralPath $WlExe -PathType Leaf)) {
    throw "bin\wl.exe not found: $WlExe; install it first: scripts\update-wl.ps1 -Tag <wl-vX.Y.Z> -Dest bin"
}
$WlCommand = "`"$WlExe`" harvest"
$WorklogHome = Join-Path $env:USERPROFILE ".worklog"
$LogPath = Join-Path $WorklogHome "harvest.log"
$CmdPath = Join-Path $WorklogHome "harvest-task.cmd"
New-Item -ItemType Directory -Force -Path $WorklogHome | Out-Null

# 実際のコマンドはこの .cmd に書く。タスクには「conhost --headless <cmd のパス>」という引用符の
# 入れ子のない 1 トークンだけを渡すので、ユーザー名やリポジトリのパスに空白があっても壊れない。
# `exit /b %ERRORLEVEL%` で wl の終了コードをそのまま返す。
# cmd.exe はバッチファイルをシステムの ANSI コードページで読む。Encoding.Default は Windows PowerShell 5.1
# (Win11 の既定) では ANSI だが pwsh 7 では UTF-8 なので、パスに日本語が入る場合は 5.1 で実行すること。
$Lines = @(
    "@echo off",
    "cd /d `"$WorklogRoot`"",
    "$WlCommand >> `"$LogPath`" 2>&1",
    "exit /b %ERRORLEVEL%"
)
[System.IO.File]::WriteAllLines($CmdPath, $Lines, [System.Text.Encoding]::Default)

# wl を直接 Execute にするとタスク実行のたびにコンソールウィンドウが前面に出る。
# conhost --headless はウィンドウを作らずに子プロセスを走らせる。ただし子の終了コードは
# LastTaskResult に伝わらない (常に 0。2026-09-30 に Win11 で確認: `conhost --headless cmd /c exit 7`
# も 0)。失敗の有無は harvest.log の末尾で見る (win11-onboarding.md の C3b)。
$Action = New-ScheduledTaskAction -Execute "conhost.exe" `
    -Argument "--headless `"$CmdPath`"" `
    -WorkingDirectory $WorklogRoot

# 毎時 0 分。RepetitionDuration を省くと無期限に繰り返す。開始時刻が過去なので、登録直後に
# 1 回すぐ実行されることがある (StartWhenAvailable)。間隔を変えたいときはここを書き換えて再実行する。
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
    -RepetitionInterval (New-TimeSpan -Hours 1)

# StartWhenAvailable: スリープ等で時刻を逃した場合、復帰後すぐに実行する。
# ExecutionTimeLimit: 要約 (claude -p) が固まっても次の回を塞がない。
# バッテリー駆動でも実行する (既定では AC 電源のときしか動かない)。
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 50) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName "WorklogHarvest" `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "wl harvest (worklog) を毎時 0 分に静かに実行" `
    -Force | Out-Null

Write-Host "Registered scheduled task 'WorklogHarvest' (hourly, headless) using bin\wl.exe at: $WlExe"
Write-Host "Launcher: $CmdPath"
Write-Host "Output goes to: $LogPath"
