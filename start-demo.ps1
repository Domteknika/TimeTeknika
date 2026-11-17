$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtime = Get-Command node -ErrorAction SilentlyContinue
if (-not $runtime) { throw 'Node.js 24 ou plus récent est requis.' }
& $runtime.Source server/index.mjs --demo
