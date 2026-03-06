param(
    [string]$PythonExe = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$BinariesDir = Join-Path $RootDir "frontend\\src-tauri\\binaries"
$SpecFile = Join-Path $ScriptDir "bookreader-backend.spec"
$WorkDir = Join-Path $ScriptDir "build-sidecar"
$DistDir = Join-Path $ScriptDir "dist-sidecar"
$VenvPython = Join-Path $ScriptDir ".venv\\Scripts\\python.exe"

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

& $PythonExe -m PyInstaller --clean --noconfirm --workpath $WorkDir --distpath $DistDir $SpecFile | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE."
}

$targetTriple = (& rustc --print host-tuple).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($targetTriple)) {
    throw "Failed to detect Rust target triple from 'rustc --print host-tuple'."
}

$builtExe = Join-Path $DistDir "bookreader-backend.exe"
if (-not (Test-Path $builtExe)) {
    throw "PyInstaller output not found: $builtExe"
}

New-Item -ItemType Directory -Path $BinariesDir -Force | Out-Null
$targetExe = Join-Path $BinariesDir ("bookreader-backend-" + $targetTriple + ".exe")
Copy-Item $builtExe $targetExe -Force
if (-not (Test-Path $targetExe)) {
    throw "sidecar output not found after copy: $targetExe"
}

Write-Host "[sidecar] copied to $targetExe"
