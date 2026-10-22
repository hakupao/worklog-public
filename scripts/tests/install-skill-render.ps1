<#
  scripts/install-skill.ps1 でスキルを使い捨てのリポジトリのコピーへ書き出します。bin\wl.exe が無ければ拒否されること、
  あれば scripts/tests/expected/SKILL.go.windows.md と一致することを確かめます。一時リポジトリのパスは @ROOT@ に置換してから比べます。
  Mac は install-skill-render.sh。

  使い方 (PowerShell):
    ./scripts/tests/install-skill-render.ps1
#>

$ErrorActionPreference = "Stop"

$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$Expected = Join-Path $RepoRoot "scripts\tests\expected"
$Work = Join-Path ([IO.Path]::GetTempPath()) ("wl-render-" + [Guid]::NewGuid().ToString("N"))
$Fake = Join-Path $Work "repo"
New-Item -ItemType Directory -Force -Path (Join-Path $Fake "scripts"), (Join-Path $Fake "skills\wl") | Out-Null
Copy-Item (Join-Path $RepoRoot "scripts\install-skill.ps1") (Join-Path $Fake "scripts")
Copy-Item (Join-Path $RepoRoot "skills\wl\SKILL.template.md") (Join-Path $Fake "skills\wl")
$FakePosix = [IO.Path]::GetFullPath($Fake) -replace "\\", "/"

$Fail = $false
$SavedConfig = $env:CLAUDE_CONFIG_DIR
try {
    # bin\wl.exe が無いときは throw し、SKILL.md を書かない。
    $env:CLAUDE_CONFIG_DIR = Join-Path $Work "config-none"
    $Refused = $false
    try { & (Join-Path $Fake "scripts\install-skill.ps1") } catch { $Refused = $_.Exception.Message.Contains("update-wl.ps1") }
    if ($Refused -and -not (Test-Path -LiteralPath (Join-Path $env:CLAUDE_CONFIG_DIR "skills\wl\SKILL.md"))) {
        Write-Host "PASS no bin\wl.exe: refused"
    } else {
        Write-Host "FAIL no bin\wl.exe: want a throw naming update-wl.ps1 and no SKILL.md"
        $Fail = $true
    }

    New-Item -ItemType Directory -Force -Path (Join-Path $Fake "bin") | Out-Null
    Set-Content -LiteralPath (Join-Path $Fake "bin\wl.exe") -Value ""
    foreach ($Kind in @("go")) {
        $env:CLAUDE_CONFIG_DIR = Join-Path $Work "config-$Kind"
        & (Join-Path $Fake "scripts\install-skill.ps1")
        $Got = [IO.File]::ReadAllText((Join-Path $env:CLAUDE_CONFIG_DIR "skills\wl\SKILL.md"), [Text.Encoding]::UTF8)
        $Got = $Got.Replace($FakePosix, "@ROOT@")
        $Want = [IO.File]::ReadAllText((Join-Path $Expected "SKILL.$Kind.windows.md"), [Text.Encoding]::UTF8)
        # git の autocrlf で期待ファイルが CRLF になっていても比較できるように揃える。
        $Want = $Want.Replace("`r`n", "`n")
        if ($Got -ceq $Want) {
            Write-Host "PASS $Kind"
        } else {
            Write-Host "FAIL $Kind"
            $GotLines = $Got -split "`n"
            $WantLines = $Want -split "`n"
            for ($i = 0; $i -lt [Math]::Max($GotLines.Count, $WantLines.Count); $i++) {
                if ($GotLines[$i] -cne $WantLines[$i]) {
                    Write-Host ("  line {0}:`n    want: {1}`n    got:  {2}" -f ($i + 1), $WantLines[$i], $GotLines[$i])
                    break
                }
            }
            $Fail = $true
        }
    }
} finally {
    $env:CLAUDE_CONFIG_DIR = $SavedConfig
    Remove-Item -Recurse -Force -LiteralPath $Work
}
if ($Fail) { exit 1 }
