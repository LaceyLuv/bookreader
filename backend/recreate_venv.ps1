param(
    [string]$PythonExe = "py",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = Join-Path $ScriptDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\\python.exe"
$ReqFile = Join-Path $ScriptDir "requirements.txt"

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

if (-not (Test-Path $ReqFile)) {
    throw "requirements.txt not found: $ReqFile"
}

if ($Force -and (Test-Path $VenvDir)) {
    Remove-Item -Recurse -Force $VenvDir
}

if (-not (Test-Path $VenvDir)) {
    if ($PythonExe -eq "py") {
        Invoke-Checked -Command "py" -Arguments @("-3", "-m", "venv", $VenvDir)
    }
    else {
        Invoke-Checked -Command $PythonExe -Arguments @("-m", "venv", $VenvDir)
    }
}

if (-not (Test-Path $VenvPython)) {
    throw "venv python not found: $VenvPython"
}

Invoke-Checked -Command $VenvPython -Arguments @("-m", "pip", "install", "--upgrade", "pip")
Invoke-Checked -Command $VenvPython -Arguments @("-m", "pip", "install", "-r", $ReqFile, "pyinstaller")

Write-Host "[venv] ready: $VenvDir"
