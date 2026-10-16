# Install the universal agent framework into a project or a user home (Windows PowerShell).
#
#   .\scripts\install.ps1 [-Scope project|user] [-Agents claude,codex,opencode,omp] [-DryRun] [-Yes] [-Link]
#
# The only prerequisite is Node.js >= 20, which every supported agent already ships with.

[CmdletBinding()]
param(
  [string]$CwdPath = '',
  [ValidateSet('project', 'user')][string]$Scope = 'project',
  [string]$Agents = '',
  [switch]$DryRun,
  [switch]$Yes,
  [switch]$Link,
  [switch]$NoHooks,
  [switch]$NoCommands,
  [switch]$NoContext
)

# The CLI refuses to install into its own checkout; installing into another project
# from here is the normal case, so a target directory is a first-class argument.

$ErrorActionPreference = 'Stop'

$FrameworkRoot = Split-Path -Parent $PSScriptRoot
$Cli = Join-Path $FrameworkRoot 'core/cli.mjs'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error 'install.ps1: Node.js is required (>= 20) but was not found on PATH.'
  exit 2
}
$major = [int](& node -p 'process.versions.node.split(".")[0]')
if ($major -lt 20) {
  Write-Error "install.ps1: Node.js >= 20 is required; found $(& node --version)."
  exit 2
}

$cliArgs = @('install', '--scope', $Scope)
if ($CwdPath) { $cliArgs += @('--cwd', $CwdPath) }
if ($Agents) { $cliArgs += @('--agents', $Agents) }
if ($Link) { $cliArgs += '--link' }
if ($NoHooks) { $cliArgs += '--no-hooks' }
if ($NoCommands) { $cliArgs += '--no-commands' }
if ($NoContext) { $cliArgs += '--no-context' }

Write-Host 'Planned changes:'
& node $Cli @($cliArgs + '--dry-run')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($DryRun) { exit 0 }

if (-not $Yes) {
  $reply = Read-Host 'Apply this plan? [y/N]'
  if ($reply -notmatch '^(y|yes)$') {
    Write-Host 'aborted; nothing was changed.'
    exit 0
  }
}

& node $Cli @($cliArgs + '--yes')
exit $LASTEXITCODE
