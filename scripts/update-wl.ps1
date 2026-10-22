<#
  GitHub リリースから Go 版 wl.exe を取得し、SHA-256 を検証してから置き換えます (Windows PowerShell 5.1)。

  使い方:
    powershell -ExecutionPolicy Bypass -File scripts\update-wl.ps1 -Tag wl-v0.1.0 -Dest bin

  -Tag      必須。scripts/release-wl.sh が作ったリリースのタグ。
  -Dest     必須。置き場所 (相対パスは <repo> 基準)。通常は bin (スキルとタスクスケジューラが bin\wl.exe を使う)。

  手順: gh release download で一時フォルダーへ → SHA256SUMS と照合 → <Dest>\wl.exe.new →
  実行中でも名前は変えられるので既存の wl.exe を wl.exe.old に → wl.exe.new を wl.exe に → Unblock-File →
  wl.exe.old は消せれば消す (実行中なら残る。次回消える)。
  ダウンロードと置き換えはそれぞれ 30 秒間隔で最大 10 回試します。ハッシュ不一致は再試行せず失敗します。
  gh が必要です (gh auth status が通ること)。
#>
param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string]$Dest,
    [string]$Repo = "hakupao/worklog"
)

$ErrorActionPreference = "Stop"

$WorklogRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
if (-not [System.IO.Path]::IsPathRooted($Dest)) { $Dest = Join-Path $WorklogRoot $Dest }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

# Asset names: the same strings as scripts/release-wl.sh. Key = asset, value = file name in $Dest.
$Assets = [ordered]@{ "wl-windows-amd64.exe" = "wl.exe" }

function Invoke-WithRetry([string]$What, [scriptblock]$Action) {
    for ($i = 1; $i -le 10; $i++) {
        try { & $Action; return }
        catch {
            if ($i -eq 10) { throw "$What failed after 10 attempts: $($_.Exception.Message)" }
            Write-Host "$What failed (attempt $i/10): $($_.Exception.Message); retrying in 30 s"
            Start-Sleep -Seconds 30
        }
    }
}

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("wl-update-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
try {
    Invoke-WithRetry "gh release download $Tag" {
        # Local to this block: gh's progress on stderr must not become a terminating error in 5.1.
        $ErrorActionPreference = "Continue"
        $patterns = @("SHA256SUMS") + @($Assets.Keys)
        $ghArgs = @("release", "download", $Tag, "--repo", $Repo, "--dir", $Tmp, "--clobber")
        foreach ($p in $patterns) { $ghArgs += @("--pattern", $p) }
        & gh @ghArgs
        if ($LASTEXITCODE -ne 0) { throw "gh exited $LASTEXITCODE" }
    }

    # SHA256SUMS lines: "<lower-case hex>  <name>" (shasum -a 256). Get-FileHash prints upper case.
    $Sums = @{}
    foreach ($line in Get-Content -LiteralPath (Join-Path $Tmp "SHA256SUMS")) {
        $parts = $line.Trim() -split '\s+'
        if ($parts.Count -eq 2) { $Sums[$parts[1].TrimStart('*')] = $parts[0].ToLowerInvariant() }
    }
    foreach ($asset in $Assets.Keys) {
        if (-not $Sums.ContainsKey($asset)) { throw "SHA256SUMS has no line for $asset" }
        $got = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Tmp $asset)).Hash.ToLowerInvariant()
        if ($got -ne $Sums[$asset]) { throw "SHA-256 mismatch for ${asset}: expected $($Sums[$asset]), got $got" }
        Write-Host "verified $asset sha256=$got"
    }

    foreach ($asset in $Assets.Keys) {
        $target = Join-Path $Dest $Assets[$asset]
        $new = "$target.new"
        $old = "$target.old"
        Copy-Item -LiteralPath (Join-Path $Tmp $asset) -Destination $new -Force
        Invoke-WithRetry "replace $target" {
            if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue }
            if (Test-Path -LiteralPath $target) {
                # A running exe can be renamed but not overwritten. If an earlier .old is still running
                # (so it could not be removed), this rename fails and the attempt is retried.
                Move-Item -LiteralPath $target -Destination $old -Force
            }
            Move-Item -LiteralPath $new -Destination $target
        }
        Unblock-File -LiteralPath $target
        if (Test-Path -LiteralPath $old) {
            try { Remove-Item -LiteralPath $old -Force } catch { Write-Host "left $old (still running); it goes next time" }
        }
        Write-Host "installed $target"
    }
} finally {
    Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
