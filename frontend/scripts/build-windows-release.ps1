param(
    [string]$FaultReportPath = "",
    [string]$MigrationReportPath = "",
    [string]$ReadinessReportPath = ""
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    throw "Signed Gyeol Reader releases must be built on Windows."
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Split-Path -Parent $ScriptDir
$RootDir = Split-Path -Parent $FrontendDir
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
if ([string]::IsNullOrWhiteSpace($FaultReportPath)) {
    $FaultReportPath = Join-Path $RootDir ("reports\release\windows-fault-" + $timestamp + ".json")
}
if ([string]::IsNullOrWhiteSpace($ReadinessReportPath)) {
    $ReadinessReportPath = Join-Path $RootDir ("reports\release\public-readiness-" + $timestamp + ".json")
}
if ([string]::IsNullOrWhiteSpace($MigrationReportPath)) {
    $MigrationReportPath = Join-Path $RootDir ("reports\release\migration-fixtures-" + $timestamp + ".json")
}

$thumbprint = (([string]$env:BOOKREADER_WINDOWS_CERTIFICATE_THUMBPRINT) -replace '\s', '').ToUpperInvariant()
$timestampUrl = [string]$env:BOOKREADER_WINDOWS_TIMESTAMP_URL

Push-Location $FrontendDir
try {
    & node (Join-Path $ScriptDir "release-policy.mjs") --profile public | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Public release policy failed. Configure a frozen identity and signing inputs before building."
    }

    $overlayPath = Join-Path ([System.IO.Path]::GetTempPath()) ("bookreader-release-overlay-" + [Guid]::NewGuid().ToString("N") + ".json")
    $overlay = [ordered]@{
        bundle = [ordered]@{
            windows = [ordered]@{
                certificateThumbprint = $thumbprint
                digestAlgorithm = "sha256"
                timestampUrl = $timestampUrl
                tsp = $true
                allowDowngrades = $false
                nsis = [ordered]@{ installMode = "currentUser" }
            }
        }
    }
    try {
        Set-Content -LiteralPath $overlayPath -Value ($overlay | ConvertTo-Json -Depth 8) -Encoding UTF8
        & node (Join-Path $ScriptDir "tauri-cli.cjs") build --ci --config $overlayPath -- --locked | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "Tauri release build failed with exit code $LASTEXITCODE." }
        & node (Join-Path $ScriptDir "package-shortcut-guide.mjs") | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "Shortcut guide packaging failed with exit code $LASTEXITCODE." }
    }
    finally {
        if (Test-Path -LiteralPath $overlayPath) { Remove-Item -LiteralPath $overlayPath -Force }
    }

    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "windows-migration-fixtures.ps1") -OutputPath $MigrationReportPath | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Windows migration fixtures failed." }

    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "windows-sidecar-fault-smoke.ps1") -OutputPath $FaultReportPath | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Windows sidecar fault smoke failed." }

    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "release-readiness.ps1") -Profile Public -FaultReportPath $FaultReportPath -MigrationReportPath $MigrationReportPath -OutputPath $ReadinessReportPath | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Signed release artifact verification failed." }

    Write-Host "[release] signed Windows release passed: $ReadinessReportPath"
}
finally {
    Pop-Location
}
