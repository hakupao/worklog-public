<#
  skills/wl/SKILL.template.md の __WORKLOG_ROOT__ をこのリポジトリの絶対パスに、__WL__ を
  bin\wl.exe の絶対パスに置換し、
  %USERPROFILE%\.claude\skills\wl\SKILL.md (CLAUDE_CONFIG_DIR があればそちら) として書き出します。
  bin\wl.exe が無ければ失敗します (先に scripts\update-wl.ps1 で置く)。
  テンプレートを編集したり、リポジトリを移動したら再実行してください。
  Mac は scripts/install-skill.sh。

  使い方 (PowerShell):
    ./scripts/install-skill.ps1
#>

$ErrorActionPreference = "Stop"

$WorklogRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
# Claude Code の Bash ツール (Git Bash) で実行されるコマンドに埋め込むので、区切りは / にする。
$WorklogRootPosix = $WorklogRoot -replace "\\", "/"

$Template = Join-Path $WorklogRoot "skills\wl\SKILL.template.md"
if (-not (Test-Path -LiteralPath $Template)) {
    throw "template not found: $Template"
}

$WlExe = Join-Path $WorklogRoot "bin\wl.exe"
if (-not (Test-Path -LiteralPath $WlExe -PathType Leaf)) {
    throw "bin\wl.exe not found: $WlExe; install it first: scripts\update-wl.ps1 -Tag <wl-vX.Y.Z> -Dest bin"
}
$Wl = "`"$WorklogRootPosix/bin/wl.exe`""

$ConfigDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".claude" }
$TargetDir = Join-Path $ConfigDir "skills\wl"
$Target = Join-Path $TargetDir "SKILL.md"

# 旧い手順でリポジトリへのリンク (junction / symlink) になっていた場合は、テンプレートを上書きしないよう先に外す。
# Test-Path はリンク先が消えていると $false を返すので、Get-Item -Force でリンク自体を見る。
foreach ($Path in @($TargetDir, $Target)) {
    $Item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if (-not $Item -and [IO.Directory]::Exists($Path)) {
        # Get-Item がリンク先の消えた junction を返せない場合の保険。
        $Item = New-Object IO.DirectoryInfo($Path)
    }
    if ($Item -and ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        if ($Item.PSIsContainer -or $Item -is [IO.DirectoryInfo]) {
            # rmdir はリンク自体だけを消す (リンク先には触らない)。ネイティブコマンドは
            # $ErrorActionPreference の対象外なので終了コードを自分で見る。
            cmd /c rmdir "$Path"
            if ($LASTEXITCODE -ne 0) { throw "could not remove link at $Path" }
        } else {
            $Item.Delete()
        }
    }
}
New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null

# 先頭の HTML コメント (<!-- template: ... -->) はテンプレート自身の説明なので、書き出す側からは外す。
$Lines = [IO.File]::ReadAllLines($Template, [Text.Encoding]::UTF8)
$Out = New-Object System.Collections.Generic.List[string]
$Skip = $false
$EatBlank = $false
foreach ($Line in $Lines) {
    if (-not $Skip -and $Line.StartsWith("<!-- template:")) { $Skip = $true }
    if ($Skip) {
        if ($Line.EndsWith("-->")) { $Skip = $false; $EatBlank = $true }
        continue
    }
    if ($EatBlank) {
        $EatBlank = $false
        if ($Line -eq "") { continue }
    }
    # String.Replace はリテラル置換 (正規表現ではない)。
    $Out.Add($Line.Replace("__WL__", $Wl).Replace("__WORKLOG_ROOT__", $WorklogRootPosix))
}
$Rendered = ($Out -join "`n") + "`n"
if ($Rendered.Contains("__WORKLOG_ROOT__") -or $Rendered.Contains("__WL__")) {
    throw "placeholder left unrendered"
}
# BOM なし UTF-8 で書く (Set-Content -Encoding UTF8 は Windows PowerShell 5 で BOM を付ける)。
[IO.File]::WriteAllText($Target, $Rendered, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Installed: $Target (worklog root: $WorklogRootPosix, wl: bin/wl.exe)"
