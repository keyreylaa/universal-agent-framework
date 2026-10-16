# Remove exactly what scripts/install.ps1 created (Windows PowerShell).
#
#   .\scripts\uninstall.ps1 [-Scope project|user] [-Purge] [-Yes]
#
# Files modified by hand after installation are preserved and reported, never deleted.

[CmdletBinding()]
param(
  [string]$CwdPath = '',
  [ValidateSet('project', 'user')][string]$Scope = 'project',
  [switch]$Purge,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$FrameworkRoot = Split-Path -Parent $PSScriptRoot
$Cli = Join-Path $FrameworkRoot 'core/cli.mjs'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error 'uninstall.ps1: Node.js is required but was not found on PATH.'
  exit 2
}

Write-Host "This removes framework-owned skills, commands, hooks, the vendored runtime, and the"
Write-Host "managed context block for scope '$Scope'. Hand-modified files are kept."
Write-Host 'Project index and memory under .uaf/ are kept unless -Purge is given.'
Write-Host ''

if (-not $Yes) {
  $reply = Read-Host 'Continue? [y/N]'
  if ($reply -notmatch '^(y|yes)$') {
    Write-Host 'aborted; nothing was changed.'
    exit 0
  }
}

$cliArgs = @('uninstall', '--scope', $Scope)
if ($CwdPath) { $cliArgs += @('--cwd', $CwdPath) }
if ($Purge) { $cliArgs += '--purge' }

& node $Cli $cliArgs
exit $LASTEXITCODE
