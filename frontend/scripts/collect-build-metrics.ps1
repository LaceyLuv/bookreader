param(
    [switch]$SkipWebBuild,
    [switch]$SkipDesktopSidecar,
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Split-Path -Parent $ScriptDir
$RootDir = Split-Path -Parent $FrontendDir
$ReportsDir = Join-Path $RootDir "reports\\performance"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $ReportsDir ("build-metrics-" + $timestamp + ".json")
}

function Invoke-MetricCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory
    )

    $startedAt = Get-Date
    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments | Out-Host
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    $finishedAt = Get-Date
    if ($exitCode -ne 0) {
        throw "'$Name' failed with exit code $exitCode."
    }

    return [ordered]@{
        name = $Name
        command = (($Command, $Arguments) -join " ")
        cwd = $WorkingDirectory
        exitCode = $exitCode
        durationSeconds = [Math]::Round(($finishedAt - $startedAt).TotalSeconds, 3)
    }
}

function Get-DirectoryBytes {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return 0
    }

    $total = Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum
    if ($null -eq $total.Sum) {
        return 0
    }
    return [int64]$total.Sum
}

New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force | Out-Null

$commands = @()

if (-not $SkipDesktopSidecar) {
    $sidecarMetricsPath = Join-Path $ReportsDir ("sidecar-build-" + $timestamp + ".json")
    $commands += Invoke-MetricCommand `
        -Name "desktop:sidecar" `
        -Command "powershell" `
        -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "..\\backend\\build_sidecar.ps1", "-MetricsPath", $sidecarMetricsPath) `
        -WorkingDirectory $FrontendDir
}

if (-not $SkipWebBuild) {
    $commands += Invoke-MetricCommand `
        -Name "build:desktop" `
        -Command "cmd" `
        -Arguments @("/c", "npm", "run", "build:desktop") `
        -WorkingDirectory $FrontendDir
}

$metrics = [ordered]@{
    collectedAt = (Get-Date).ToString("o")
    rootDir = $RootDir
    frontendDir = $FrontendDir
    skipWebBuild = [bool]$SkipWebBuild
    skipDesktopSidecar = [bool]$SkipDesktopSidecar
    commands = $commands
    outputs = [ordered]@{
        frontendDistBytes = Get-DirectoryBytes (Join-Path $FrontendDir "dist")
        tauriBinariesBytes = Get-DirectoryBytes (Join-Path $FrontendDir "src-tauri\\binaries")
        backendSidecarDistBytes = Get-DirectoryBytes (Join-Path $RootDir "backend\\dist-sidecar")
    }
}

$metricsJson = $metrics | ConvertTo-Json -Depth 6
Set-Content -Path $OutputPath -Value $metricsJson
Write-Host "[perf] metrics written to $OutputPath"
