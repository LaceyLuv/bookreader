param(
    [string]$DesktopPath = "",
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Split-Path -Parent $ScriptDir
$RootDir = Split-Path -Parent $FrontendDir
$TauriDir = Join-Path $FrontendDir "src-tauri"
$config = Get-Content -LiteralPath (Join-Path $TauriDir "tauri.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$mainBinaryName = [string]$config.mainBinaryName
if ([string]::IsNullOrWhiteSpace($mainBinaryName)) {
    throw "tauri.conf.json mainBinaryName must identify the packaged desktop executable."
}
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
if ([string]::IsNullOrWhiteSpace($DesktopPath)) {
    $DesktopPath = Join-Path $TauriDir ("target\release\" + $mainBinaryName + ".exe")
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $RootDir ("reports\release\migration-fixtures-" + $timestamp + ".json")
}

$requiredCases = @(
    "legacy_data_migration_is_allowlisted_verified_and_non_destructive",
    "legacy_data_migration_replaces_only_pristine_destination_scaffold",
    "legacy_data_migration_does_not_partially_clear_non_pristine_scaffold",
    "legacy_data_migration_rejects_conflicting_destination_data",
    "legacy_data_migration_rejects_same_size_staged_tampering",
    "legacy_data_migration_rejects_invalid_completed_marker"
)
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    $lines = & cargo test --manifest-path (Join-Path $TauriDir "Cargo.toml") --locked --lib legacy_data_migration -- --test-threads=1 2>&1
    $cargoExit = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
$textLines = @($lines | ForEach-Object { $_.ToString() })
$output = $textLines -join [Environment]::NewLine
$textLines | ForEach-Object { Write-Host $_ }
$cases = @($requiredCases | ForEach-Object {
    $pattern = "test tests::" + [regex]::Escape($_) + "\s+\.\.\.\s+ok"
    [ordered]@{ name = $_; passed = $cargoExit -eq 0 -and $output -match $pattern }
})
$desktopExists = Test-Path -LiteralPath $DesktopPath -PathType Leaf
$passed = $cargoExit -eq 0 -and $desktopExists -and @($cases | Where-Object { -not $_.passed }).Count -eq 0
$result = [ordered]@{
    schema_version = 1
    kind = "bookreader-windows-migration-fixtures"
    application_version = [string]$config.version
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    passed = $passed
    migration_source_sha256 = (Get-FileHash -LiteralPath (Join-Path $TauriDir "src\lib.rs") -Algorithm SHA256).Hash.ToLowerInvariant()
    desktop_sha256 = $(if ($desktopExists) { (Get-FileHash -LiteralPath $DesktopPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null })
    cases = $cases
    failure = $(if ($cargoExit -ne 0) { "cargo test exited $cargoExit" } elseif (-not $desktopExists) { "desktop artifact is missing" } elseif (-not $passed) { "one or more required migration fixtures were not observed" } else { $null })
}
$parent = Split-Path -Parent $OutputPath
if (-not [string]::IsNullOrWhiteSpace($parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
Set-Content -LiteralPath $OutputPath -Value ($result | ConvertTo-Json -Depth 8) -Encoding UTF8
Write-Host "[migration-qa] report written to $OutputPath"

if (-not $passed) { exit 1 }
