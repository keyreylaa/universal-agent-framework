# Bootstrap installer for Windows PowerShell. One command, no clone required.
#
#   irm https://raw.githubusercontent.com/keyreylaa/universal-agent-framework/main/scripts/get.ps1 | iex
#
# It fetches the framework into a cache directory, then hands over to the real
# installer in scripts/install.sh behaviour (via the Node CLI). Nothing is written
# to the target project until the installer prints its plan and you approve it.
#
# Environment:
#   UAF_REF      git ref to fetch            (default: main; pin a tag for reproducibility)
#   UAF_SOURCE   repository URL or local dir (default: the GitHub repository)
#   UAF_HOME     install cache               (default: $env:LOCALAPPDATA\uaf)
#   UAF_TARGET   directory to configure      (default: the current directory)
#
# Trust: this script downloads and executes code. By default it follows a moving
# ref. Set UAF_REF to a tag you have inspected to pin a version.

param(
  [string]$CwdPath = '',
  [string]$Agents = '',
  [ValidateSet('project', 'user')][string]$Scope = 'project',
  [switch]$DryRun,
  [switch]$Yes,
  [switch]$Link,
  [switch]$NoHooks,
  [switch]$NoCommands,
  [switch]$NoContext
)

$ErrorActionPreference = 'Stop'

function Die([string]$Message, [int]$Code = 2) {
  Write-Error "get.ps1: $Message"
  exit $Code
}

$Source = if ($env:UAF_SOURCE) { $env:UAF_SOURCE } else { 'https://github.com/keyreylaa/universal-agent-framework.git' }
$Ref = if ($env:UAF_REF) { $env:UAF_REF } else { 'main' }
$HomeDir = if ($env:UAF_HOME) { $env:UAF_HOME } else { Join-Path $env:LOCALAPPDATA 'uaf' }
$WorkDir = Join-Path $HomeDir 'src'

New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null

$git = Get-Command git -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $Source '.') -PathType Container) {
  Write-Host "using local source $Source"
  if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }
  New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
  Copy-Item -Path (Join-Path $Source '*') -Destination $WorkDir -Recurse -Force
  Remove-Item -Recurse -Force (Join-Path $WorkDir '.git') -ErrorAction SilentlyContinue
} elseif ($git) {
  Write-Host "fetching $Source @ $Ref"
  if (Test-Path (Join-Path $WorkDir '.git')) {
    & git -C $WorkDir fetch --quiet --depth 1 origin $Ref
    & git -C $WorkDir checkout --quiet --detach FETCH_HEAD
  } else {
    if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }
    & git clone --quiet --depth 1 --branch $Ref $Source $WorkDir
  }
  if ($LASTEXITCODE -ne 0) { Die "git clone/fetch failed for $Source @ $Ref" }
} else {
  # Zip archive fallback when git is unavailable.
  $ownerRepo = $Source -replace '^.*://github\.com/', '' -replace '\.git$', '' -replace '/$', ''
  if ($ownerRepo -eq $Source) { Die "git is not installed and $Source is not a GitHub URL" }
  $zipUrl = "https://codeload.github.com/$ownerRepo/zip/$Ref"
  $zipPath = Join-Path $HomeDir 'uaf.zip'
  Write-Host "git unavailable; fetching $zipUrl"
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
  if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }
  Expand-Archive -Path $zipPath -DestinationPath $HomeDir -Force
  $inner = Get-ChildItem -Path $HomeDir -Directory | Where-Object { $_.Name -like 'universal-agent-framework-*' } | Select-Object -First 1
  if (-not $inner) { Die 'downloaded archive did not contain the expected directory' }
  Move-Item -Path $inner.FullName -Destination $WorkDir
  Remove-Item -Force $zipPath
}

$cli = Join-Path $WorkDir 'core/cli.mjs'
if (-not (Test-Path $cli -PathType Leaf)) { Die "fetched tree does not look like this framework (no core/cli.mjs): $WorkDir" }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Die 'Node.js >= 20 is required but was not found on PATH.' }
$major = [int](& node -p 'process.versions.node.split(".")[0]')
if ($major -lt 20) { Die "Node.js >= 20 is required; found $(& node --version)." }

Write-Host "framework at $WorkDir"

# Target: an explicit -CwdPath wins, then UAF_TARGET, then the current directory.
$target = if ($CwdPath) { $CwdPath } elseif ($env:UAF_TARGET) { $env:UAF_TARGET } else { (Get-Location).Path }
if ($target -like "$WorkDir*") { Die 'run this from the project you want to configure, or pass -CwdPath <dir>' }

Write-Host "target project: $target"
Write-Host ''

$cliArgs = @('install', '--cwd', $target, '--scope', $Scope)
if ($Agents) { $cliArgs += @('--agents', $Agents) }
if ($Link) { $cliArgs += '--link' }
if ($NoHooks) { $cliArgs += '--no-hooks' }
if ($NoCommands) { $cliArgs += '--no-commands' }
if ($NoContext) { $cliArgs += '--no-context' }
if ($Yes) { $cliArgs += '--yes' }

if (-not $DryRun) {
  & node $cli @($cliArgs + '--dry-run')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  if (-not $Yes) {
    $reply = Read-Host 'Apply this plan? [y/N]'
    if ($reply -notmatch '^(y|yes)$') {
      Write-Host 'nothing was changed.'
      exit 0
    }
  }
  & node $cli @($cliArgs + '--yes')
} else {
  & node $cli @($cliArgs + '--dry-run')
}

exit $LASTEXITCODE
