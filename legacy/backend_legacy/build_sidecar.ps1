param(
    [string]$PythonExe = "python"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$FrontendDir = Join-Path $RootDir "frontend"
$SrcTauriDir = Join-Path $FrontendDir "src-tauri"
$BinariesDir = Join-Path $SrcTauriDir "binaries"
$PyInstallerSpecFile = Join-Path $ScriptDir "bookreader-backend.spec"

Write-Host "[sidecar] backend dir: $ScriptDir"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $Command @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "'$Command $($Arguments -join ' ')' failed with exit code $LASTEXITCODE."
    }
}

function Resolve-PythonTool {
    $candidates = @()

    if ($PythonExe) {
        $candidates += @{ Cmd = $PythonExe; Prefix = @(); Label = $PythonExe }
    }

    $candidates += @(
        @{ Cmd = (Join-Path $RootDir ".venv\\Scripts\\python.exe"); Prefix = @(); Label = "root .venv" },
        @{ Cmd = (Join-Path $ScriptDir ".venv\\Scripts\\python.exe"); Prefix = @(); Label = "backend .venv" },
        @{ Cmd = "py"; Prefix = @("-3"); Label = "py -3" },
        @{ Cmd = "python"; Prefix = @(); Label = "python" }
    )

    foreach ($candidate in $candidates) {
        try {
            & $candidate.Cmd @($candidate.Prefix) -V | Out-Null
            Write-Host "[sidecar] python: $($candidate.Label)"
            return $candidate
        }
        catch {
            continue
        }
    }

    throw "No usable Python interpreter found."
}

Push-Location $ScriptDir
try {
    $tempRoot = [System.IO.Path]::GetTempPath()
    $env:TEMP = $tempRoot
    $env:TMP = $tempRoot
    $env:TMPDIR = $tempRoot

    $python = Resolve-PythonTool

    & $python.Cmd @($python.Prefix) -m PyInstaller --version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Invoke-Checked -Command $python.Cmd -Arguments (@($python.Prefix) + @("-m", "pip", "install", "--upgrade", "pip", "pyinstaller"))
    }

    $pyInstallerTempRoot = Join-Path $tempRoot ("bookreader-sidecar-" + [Guid]::NewGuid().ToString("N"))
    $pyInstallerWorkDir = Join-Path $pyInstallerTempRoot "work"
    $pyInstallerDistDir = Join-Path $pyInstallerTempRoot "dist"

    New-Item -ItemType Directory -Path $pyInstallerWorkDir -Force | Out-Null
    New-Item -ItemType Directory -Path $pyInstallerDistDir -Force | Out-Null

    if (-not (Test-Path $PyInstallerSpecFile)) {
        throw "PyInstaller spec file not found: $PyInstallerSpecFile"
    }
    Invoke-Checked -Command $python.Cmd -Arguments (
        @($python.Prefix) + @(
            "-m", "PyInstaller",
            "--clean",
            "--noconfirm",
            "--workpath", $pyInstallerWorkDir,
            "--distpath", $pyInstallerDistDir,
            $PyInstallerSpecFile
        )
    )

    $hostLine = (& rustc -Vv | Select-String "^host:").ToString()
    if (-not $hostLine) {
        throw "Failed to detect Rust target triple from 'rustc -Vv'."
    }
    $targetTriple = ($hostLine -replace "^host:\s*", "").Trim()

    $builtExe = Join-Path $pyInstallerDistDir "bookreader-backend.exe"
    if (-not (Test-Path $builtExe)) {
        throw "PyInstaller output not found: $builtExe"
    }

    New-Item -ItemType Directory -Path $BinariesDir -Force | Out-Null
    $targetExe = Join-Path $BinariesDir ("bookreader-backend-" + $targetTriple + ".exe")

    $copied = $false
    for ($i = 0; $i -lt 6; $i++) {
        try {
            Copy-Item $builtExe $targetExe -Force
            $copied = $true
            break
        }
        catch {
            Start-Sleep -Milliseconds 400
        }
    }

    if (-not $copied) {
        if (Test-Path $targetExe) {
            Write-Warning "[sidecar] target is locked; keeping existing sidecar: $targetExe"
        }
        else {
            throw "Failed to copy sidecar to $targetExe"
        }
    }
    else {
        Write-Host "[sidecar] copied to $targetExe"
    }

    try {
        Remove-Item -Recurse -Force $pyInstallerTempRoot -ErrorAction Stop
    }
    catch {
        Write-Warning "[sidecar] temp cleanup skipped: $pyInstallerTempRoot"
    }
}
finally {
    Pop-Location
}
