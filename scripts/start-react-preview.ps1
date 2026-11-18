param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$previewRoot = Split-Path -Parent $PSScriptRoot
$previewUrl = 'http://127.0.0.1:4312'
$previewData = Join-Path $previewRoot '.qa\react-preview'
$previewBuild = Join-Path $previewRoot 'dist\web'
function Test-Preview {
    try {
        $info = Invoke-RestMethod -Uri "$previewUrl/api/info" -TimeoutSec 1
        $page = Invoke-WebRequest -Uri $previewUrl -UseBasicParsing -TimeoutSec 1
        return ($info.demo -eq $true -and $page.Headers['X-TimeTeknika-UI'] -eq 'react')
    } catch { return $false }
}
if (-not (Test-Preview)) {
    if (-not (Test-Path -LiteralPath (Join-Path $previewBuild 'index.html'))) {
        throw 'Construire l''interface avec pnpm build avant de lancer cet apercu.'
    }
    $runtimeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $runtimeCandidates = @(
        $(if ($runtimeCommand) { $runtimeCommand.Source }),
        "$env:ProgramFiles\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )
    if (Get-Command Get-AppxPackage -ErrorAction SilentlyContinue) {
        $runtimeCandidates += @(Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' |
            ForEach-Object { Join-Path $_.InstallLocation 'dependencies\node\bin\node.exe' })
    }
    $runtime = $null
    foreach ($candidate in ($runtimeCandidates | Where-Object { $_ } | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $version = & $candidate --version 2>$null
            if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) {
                $runtime = $candidate
                break
            }
        }
    }
    if (-not $runtime) { throw 'Node.js 24 ou plus recent est requis.' }
    New-Item -ItemType Directory -Path $previewData -Force | Out-Null
    $env:HOST = '127.0.0.1'
    $env:PORT = '4312'
    $env:DATA_DIR = $previewData
    $env:DEMO_MODE = '1'
    $env:DEMO_DATABASE_URL = ''
    $env:FRONTEND_DIR = $previewBuild
    $env:APP_URL = $previewUrl
    $env:COOKIE_SECURE = '0'
    $entry = Join-Path $previewRoot 'server\index.mjs'
    $process = Start-Process -FilePath $runtime -ArgumentList @('"' + $entry + '"', '--demo') -WorkingDirectory $previewRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $previewData 'server.log') -RedirectStandardError (Join-Path $previewData 'server-error.log')
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if (Test-Preview) { $ready = $true; break }
        if ($process.HasExited) { throw "Le serveur n'a pas demarre. Consulter $previewData\server-error.log" }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw "L'apercu ne repond pas. Consulter $previewData\server-error.log" }
}
Write-Output "Apercu React : $previewUrl"
Write-Output 'Donnees fictives separees. Aucun push ni deploiement.'
if (-not $NoBrowser) { Start-Process $previewUrl }
