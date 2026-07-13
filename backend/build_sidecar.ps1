param(
    [string]$PythonExe = "",
    [string]$MetricsPath = "",
    [string]$CertificateThumbprint = $env:BOOKREADER_WINDOWS_CERTIFICATE_THUMBPRINT,
    [string]$TimestampUrl = $env:BOOKREADER_WINDOWS_TIMESTAMP_URL,
    [string]$SignToolPath = $env:TAURI_WINDOWS_SIGNTOOL_PATH
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$BinariesDir = Join-Path $RootDir "frontend\\src-tauri\\binaries"
$SpecFile = Join-Path $ScriptDir "bookreader-backend.spec"
$WorkDir = Join-Path $ScriptDir "build-sidecar"
$DistDir = Join-Path $ScriptDir "dist-sidecar"
$VenvPython = Join-Path $ScriptDir ".venv\\Scripts\\python.exe"
$buildStartedAt = Get-Date

# Windows packaging note:
# This PowerShell script currently builds the PyInstaller .exe expected by Tauri
# externalBin on Windows. macOS/Linux need a separate PyInstaller build path that
# copies bookreader-backend-$targetTriple without the .exe suffix.
$IsWindowsHost = ($PSVersionTable.PSEdition -eq "Desktop") -or ($PSVersionTable.ContainsKey("Platform") -and $PSVersionTable.Platform -eq "Win32NT") -or ($null -ne (Get-Variable -Name IsWindows -ErrorAction SilentlyContinue) -and $IsWindows)
if (-not $IsWindowsHost) {
    throw "build_sidecar.ps1 currently supports Windows PyInstaller/Tauri externalBin packaging only."
}

function Resolve-SignToolPath {
    param([string]$ConfiguredPath)
    if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) {
        if (-not (Test-Path -LiteralPath $ConfiguredPath -PathType Leaf)) {
            throw "Configured signtool does not exist: $ConfiguredPath"
        }
        return (Resolve-Path -LiteralPath $ConfiguredPath).Path
    }

    $command = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
    if ($null -ne $command) { return $command.Source }

    $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    if (Test-Path -LiteralPath $kitsRoot) {
        $candidate = Get-ChildItem -LiteralPath $kitsRoot -Recurse -Filter "signtool.exe" -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($null -ne $candidate) { return $candidate.FullName }
    }
    throw "signtool.exe was not found. Install a Windows SDK or set TAURI_WINDOWS_SIGNTOOL_PATH."
}

$signingRequested = -not [string]::IsNullOrWhiteSpace($CertificateThumbprint) -or -not [string]::IsNullOrWhiteSpace($TimestampUrl)
$normalizedThumbprint = (([string]$CertificateThumbprint) -replace '\s', '').ToUpperInvariant()
$resolvedSignTool = $null
$signatureStatus = "NotRequested"
if ($signingRequested) {
    if ($normalizedThumbprint -notmatch '^[0-9A-F]{40,64}$') {
        throw "BOOKREADER_WINDOWS_CERTIFICATE_THUMBPRINT must be a 40-64 digit hexadecimal thumbprint."
    }
    try { $timestampUri = [Uri]$TimestampUrl } catch { throw "BOOKREADER_WINDOWS_TIMESTAMP_URL is invalid." }
    if ($timestampUri.Scheme -ne "https") {
        throw "BOOKREADER_WINDOWS_TIMESTAMP_URL must use HTTPS."
    }
    $certificate = Get-ChildItem -Path ("Cert:\CurrentUser\My\" + $normalizedThumbprint) -ErrorAction SilentlyContinue
    if ($null -eq $certificate -or -not $certificate.HasPrivateKey -or $certificate.NotAfter -le (Get-Date)) {
        throw "The configured current-user code-signing certificate is missing, expired, or has no private key."
    }
    $codeSigningEku = $certificate.EnhancedKeyUsageList | Where-Object { $_.ObjectId.Value -eq "1.3.6.1.5.5.7.3.3" }
    if ($null -eq $codeSigningEku) {
        throw "The configured certificate is not valid for code signing."
    }
    $resolvedSignTool = Resolve-SignToolPath $SignToolPath
}

function Get-RustTargetTriple {
    $targetTriple = (& rustc --print host-tuple 2>$null)
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($targetTriple)) {
        return $targetTriple.Trim()
    }

    $rustcVerbose = (& rustc -Vv 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($rustcVerbose)) {
        throw "Failed to detect Rust target triple from 'rustc --print host-tuple' or 'rustc -Vv'."
    }

    $hostLine = $rustcVerbose | Where-Object { $_ -match '^host:\s*(.+)$' } | Select-Object -First 1
    if ($hostLine -match '^host:\s*(.+)$') {
        return $Matches[1].Trim()
    }

    throw "Failed to detect Rust target triple from 'rustc --print host-tuple' or 'rustc -Vv' host: output."
}

if (-not (Test-Path $SpecFile)) {
    throw "spec file not found: $SpecFile"
}

if ([string]::IsNullOrWhiteSpace($PythonExe)) {
    if (Test-Path $VenvPython) {
        $PythonExe = $VenvPython
    } else {
        $PythonExe = "python"
    }
}

Write-Host "[sidecar] using python: $PythonExe"

$pinnedPyInstallerLine = Get-Content -LiteralPath (Join-Path $ScriptDir "requirements-build.txt") |
    Where-Object { $_ -match '^pyinstaller==(.+)$' } |
    Select-Object -First 1
if ($pinnedPyInstallerLine -notmatch '^pyinstaller==(.+)$') {
    throw "requirements-build.txt must pin pyinstaller with ==."
}
$pinnedPyInstaller = $Matches[1].Trim()
$pyInstallerVersionOutput = & $PythonExe -m PyInstaller --version 2>$null
$pyInstallerVersionExitCode = $LASTEXITCODE
$installedPyInstaller = (([string]($pyInstallerVersionOutput | Select-Object -First 1))).Trim()
if ($pyInstallerVersionExitCode -ne 0 -or $installedPyInstaller -ne $pinnedPyInstaller) {
    throw "PyInstaller version mismatch. Required $pinnedPyInstaller, found $installedPyInstaller."
}
Write-Host "[sidecar] PyInstaller: $installedPyInstaller (pinned)"

& $PythonExe -m PyInstaller --clean --noconfirm --workpath $WorkDir --distpath $DistDir $SpecFile | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE."
}

$targetTriple = Get-RustTargetTriple

$builtExe = Join-Path $DistDir "bookreader-backend.exe"
if (-not (Test-Path $builtExe)) {
    throw "PyInstaller output not found: $builtExe"
}

if ($signingRequested) {
    & $resolvedSignTool sign /sha1 $normalizedThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $builtExe | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "signtool failed to sign the sidecar (exit $LASTEXITCODE)."
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $builtExe
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or $null -eq $signature.TimeStamperCertificate) {
        throw "The sidecar signature is not valid and timestamped: $($signature.Status)"
    }
    if ($signature.SignerCertificate.Thumbprint.ToUpperInvariant() -ne $normalizedThumbprint) {
        throw "The sidecar signer does not match the configured certificate."
    }
    $signatureStatus = "ValidTimestamped"
}

New-Item -ItemType Directory -Path $BinariesDir -Force | Out-Null
$targetExe = Join-Path $BinariesDir ("bookreader-backend-" + $targetTriple + ".exe")
Copy-Item $builtExe $targetExe -Force
if (-not (Test-Path $targetExe)) {
    throw "sidecar output not found after copy: $targetExe"
}

Write-Host "[sidecar] copied to $targetExe"

$metrics = [ordered]@{
    builtAt = (Get-Date).ToString("o")
    durationSeconds = [Math]::Round(((Get-Date) - $buildStartedAt).TotalSeconds, 3)
    pythonExe = $PythonExe
    targetTriple = $targetTriple
    sourceExe = $builtExe
    sourceExeBytes = (Get-Item $builtExe).Length
    copiedExe = $targetExe
    copiedExeBytes = (Get-Item $targetExe).Length
    signatureStatus = $signatureStatus
}

$metricsJson = $metrics | ConvertTo-Json -Depth 4
Write-Host "[sidecar] metrics: $metricsJson"

if (-not [string]::IsNullOrWhiteSpace($MetricsPath)) {
    $metricsDir = Split-Path -Parent $MetricsPath
    if (-not [string]::IsNullOrWhiteSpace($metricsDir)) {
        New-Item -ItemType Directory -Path $metricsDir -Force | Out-Null
    }
    Set-Content -Path $MetricsPath -Value $metricsJson
    Write-Host "[sidecar] metrics written to $MetricsPath"
}
