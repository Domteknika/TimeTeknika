param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$appUrl = 'http://127.0.0.1:4310'
$mutex = New-Object System.Threading.Mutex($false, 'Local\TimeTeknika-4310-Launcher')
$hasLock = $false

function Test-TimeTeknika {
    try {
        $health = Invoke-RestMethod -Uri "$appUrl/health" -TimeoutSec 1
        $info = Invoke-RestMethod -Uri "$appUrl/api/info" -TimeoutSec 1
        return ($health.status -eq 'ok' -and $info.demo -eq $true -and $null -ne $info.demoUsers)
    } catch {
        return $false
    }
}

function Find-NodeRuntime {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    $candidates = @(
        $(if ($command) { $command.Source }),
        "$env:ProgramFiles\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
        "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
    )
    foreach ($candidate in ($candidates | Where-Object { $_ } | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        $version = & $candidate --version 2>$null
        if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) {
            return $candidate
        }
    }
    throw 'Node.js 24 ou plus recent est introuvable. Installer Node.js, puis relancer ce fichier.'
}

try {
    try { $hasLock = $mutex.WaitOne(30000) }
    catch [System.Threading.AbandonedMutexException] { $hasLock = $true }
    if (-not $hasLock) { throw 'Un lancement est deja en cours. Reessayer dans quelques secondes.' }

    if (-not (Test-TimeTeknika)) {
        $runtime = Find-NodeRuntime
        foreach ($dependency in @('pdfkit', 'exceljs')) {
            if (-not (Test-Path -LiteralPath (Join-Path $appRoot "node_modules\$dependency\package.json"))) {
                throw 'Dependances manquantes. Suivre la rubrique Installation du README avant de relancer.'
            }
        }
        $logDir = Join-Path $appRoot 'data\logs'
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $outputLog = Join-Path $logDir "serveur-$stamp.log"
        $errorLog = Join-Path $logDir "serveur-$stamp-erreurs.log"

        # Always reopen the existing local prototype, regardless of shell variables.
        $settings = @{
            HOST = '127.0.0.1'; PORT = '4310'; DEMO_MODE = '1'
            APP_URL = $appUrl; DATA_DIR = (Join-Path $appRoot 'data'); COOKIE_SECURE = '0'; PUBLIC_ORIGIN = $appUrl
        }
        $previous = @{}
        try {
            foreach ($name in $settings.Keys) {
                $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
                [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process')
            }
            $server = Start-Process -FilePath $runtime -ArgumentList @(('"' + (Join-Path $appRoot 'server\index.mjs') + '"'), '--demo') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog -PassThru
        } finally {
            foreach ($name in $previous.Keys) {
                [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
            }
        }

        $ready = $false
        $deadline = (Get-Date).AddSeconds(20)
        do {
            if ($server.HasExited) { break }
            $ready = Test-TimeTeknika
            if (-not $ready) { Start-Sleep -Milliseconds 300 }
        } while (-not $ready -and (Get-Date) -lt $deadline)

        if (-not $ready) {
            throw "Le serveur n'a pas pu demarrer (le port 4310 est peut-etre occupe). Journal : $errorLog"
        }
        Write-Host 'TimeTeknika est demarre en arriere-plan.'
    } else {
        Write-Host 'TimeTeknika est deja en cours.'
    }

    Write-Host "Adresse : $appUrl"
    if (-not $NoBrowser) {
        try { Start-Process $appUrl }
        catch { Write-Host "Ouvrir cette adresse dans votre navigateur : $appUrl" }
    }
} catch {
    Write-Host "Impossible de lancer TimeTeknika : $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($hasLock) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
