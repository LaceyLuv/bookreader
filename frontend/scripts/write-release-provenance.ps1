param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Candidate", "Public")]
    [string]$Profile,
    [Parameter(Mandatory = $true)]
    [string]$BuildId,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedGitCommit,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedGitBranch,
    [Parameter(Mandatory = $true)]
    [string]$BuildStartedAtUtc,
    [Parameter(Mandatory = $true)]
    [string]$ArtifactsCompletedAtUtc,
    [Parameter(Mandatory = $true)]
    [string]$BuildEnvironmentBase64,
    [Parameter(Mandatory = $true)]
    [string]$SidecarPath,
    [Parameter(Mandatory = $true)]
    [string]$DesktopPath,
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedSidecarSha256,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedDesktopSha256,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedInstallerSha256,
    [Parameter(Mandatory = $true)]
    [string]$FaultReportPath,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedFaultReportSha256,
    [Parameter(Mandatory = $true)]
    [string]$MigrationReportPath,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedMigrationReportSha256,
    [Parameter(Mandatory = $true)]
    [string]$ReadinessReportPath,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedReadinessReportSha256,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,
    [string]$RepositoryRoot = "",
    [string]$ApplicationVersion = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $FrontendDir = Split-Path -Parent $ScriptDir
    $RepositoryRoot = Split-Path -Parent $FrontendDir
}
$RootDir = (Resolve-Path -LiteralPath $RepositoryRoot).Path.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$RootPrefix = $RootDir + [IO.Path]::DirectorySeparatorChar

function Assert-NoReparsePoints {
    param([string]$FullPath, [string]$Label)
    $rootItem = Get-Item -LiteralPath $RootDir -Force
    if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Repository root cannot be a reparse point for release provenance."
    }
    $relativePath = $FullPath.Substring($RootPrefix.Length)
    $currentPath = $RootDir
    foreach ($segment in @($relativePath -split '[\\/]')) {
        if ([string]::IsNullOrWhiteSpace($segment)) { continue }
        $currentPath = Join-Path $currentPath $segment
        if (-not (Test-Path -LiteralPath $currentPath)) { break }
        $item = Get-Item -LiteralPath $currentPath -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "$Label cannot traverse a symlink, junction, or other reparse point: $currentPath"
        }
    }
}

function Read-GitValue {
    param([string[]]$Arguments)
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $lines = @(& git -C $RootDir @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousErrorActionPreference }
    if ($exitCode -ne 0) {
        throw "Git command failed: git $($Arguments -join ' ')"
    }
    return ($lines -join [Environment]::NewLine).Trim()
}

function Read-GitStatus {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $lines = @(& git -C $RootDir status --porcelain=v1 --untracked-files=all --ignore-submodules=none 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousErrorActionPreference }
    if ($exitCode -ne 0) {
        throw "Git status failed for $RootDir"
    }
    return @($lines | ForEach-Object { $_.ToString() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Assert-ExpectedSourceState {
    param([string]$Phase)
    $commit = Read-GitValue @("rev-parse", "HEAD")
    $branch = Read-GitValue @("rev-parse", "--abbrev-ref", "HEAD")
    if ($commit -ne $ExpectedGitCommit) {
        throw "Source commit changed during release build ($Phase): expected $ExpectedGitCommit, found $commit."
    }
    if ($branch -ne $ExpectedGitBranch) {
        throw "Source branch changed during release build ($Phase): expected $ExpectedGitBranch, found $branch."
    }
    $status = @(Read-GitStatus)
    if ($status.Count -ne 0) {
        throw "Release provenance requires a clean worktree at $Phase. Dirty entries: $($status -join '; ')"
    }
    return [ordered]@{ commit = $commit; branch = $branch }
}

function Resolve-RepositoryFile {
    param([string]$Path, [string]$Label)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "$Label path is required."
    }
    $item = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
    if ($null -eq $item -or $item.PSIsContainer) {
        throw "$Label file is missing: $Path"
    }
    $fullPath = [IO.Path]::GetFullPath($item.FullName)
    if (-not $fullPath.StartsWith($RootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must be inside the repository: $fullPath"
    }
    Assert-NoReparsePoints $fullPath $Label
    return $item
}

function Get-RepositoryRelativePath {
    param([string]$Path)
    $fullPath = [IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith($RootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path must be inside the repository: $fullPath"
    }
    return $fullPath.Substring($RootPrefix.Length).Replace([IO.Path]::DirectorySeparatorChar, '/')
}

function Get-Sha256 {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-PeCertificateTablePresent {
    param([string]$Path)
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 256 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) { return $false }
    $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
    if ($peOffset -lt 0 -or $peOffset + 160 -gt $bytes.Length) { return $false }
    if ($bytes[$peOffset] -ne 0x50 -or $bytes[$peOffset + 1] -ne 0x45 -or $bytes[$peOffset + 2] -ne 0 -or $bytes[$peOffset + 3] -ne 0) { return $false }
    $optionalHeader = $peOffset + 24
    $magic = [BitConverter]::ToUInt16($bytes, $optionalHeader)
    if ($magic -eq 0x10B) {
        $numberOfDirectoriesOffset = $optionalHeader + 92
        $dataDirectoriesOffset = $optionalHeader + 96
    }
    elseif ($magic -eq 0x20B) {
        $numberOfDirectoriesOffset = $optionalHeader + 108
        $dataDirectoriesOffset = $optionalHeader + 112
    }
    else { return $false }
    if ([BitConverter]::ToUInt32($bytes, $numberOfDirectoriesOffset) -lt 5) { return $false }
    $certificateEntry = $dataDirectoriesOffset + (8 * 4)
    $certificateOffset = [BitConverter]::ToUInt32($bytes, $certificateEntry)
    $certificateSize = [BitConverter]::ToUInt32($bytes, $certificateEntry + 4)
    return $certificateOffset -gt 0 -and $certificateSize -gt 0 -and ([uint64]$certificateOffset + [uint64]$certificateSize) -le [uint64]$bytes.Length
}

function Read-BoundReport {
    param(
        [string]$Path,
        [string]$Label,
        [string]$ExpectedKind,
        [string]$ExpectedSha256,
        [DateTimeOffset]$MinimumGeneratedAt
    )
    $item = Resolve-RepositoryFile $Path ($Label + " report")
    $actualSha256 = Get-Sha256 $item.FullName
    if ($actualSha256 -ne $ExpectedSha256.ToLowerInvariant()) {
        throw "$Label report changed after its producer completed."
    }
    try {
        $report = Get-Content -LiteralPath $item.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "Invalid $Label report JSON: $($_.Exception.Message)"
    }
    if ($report.schema_version -ne 1 -or $report.passed -ne $true) {
        throw "$Label report must be schema v1 with passed=true."
    }
    if ([string]$report.kind -ne $ExpectedKind) {
        throw "$Label report kind mismatch: expected $ExpectedKind, found $($report.kind)."
    }
    if ([string]$report.build_id -ne $BuildId) {
        throw "$Label report build_id does not match this build session."
    }
    if ([string]$report.source.commit -ne $ExpectedGitCommit -or [string]$report.source.branch -ne $ExpectedGitBranch) {
        throw "$Label report source does not match the expected Git state."
    }
    if (-not [string]::IsNullOrWhiteSpace($ApplicationVersion) -and [string]$report.application_version -ne $ApplicationVersion) {
        throw "$Label report application version mismatch."
    }
    try {
        $generatedAt = [DateTimeOffset]::Parse([string]$report.generated_at).ToUniversalTime()
    }
    catch {
        throw "$Label report has an invalid generated_at timestamp."
    }
    if ($generatedAt -lt $MinimumGeneratedAt -or $generatedAt -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) {
        throw "$Label report is outside this build session: $($generatedAt.ToString('o'))."
    }
    return [ordered]@{
        item = $item
        data = $report
        generated_at = $generatedAt.ToString("o")
        sha256 = $actualSha256
    }
}

function Assert-RequiredCaseMatrix {
    param($Report, [string]$Label, [string[]]$RequiredCases)
    $reportedCases = @($Report.cases)
    if ($reportedCases.Count -ne $RequiredCases.Count) {
        throw "$Label report must contain exactly $($RequiredCases.Count) required cases."
    }
    foreach ($requiredCase in $RequiredCases) {
        $matches = @($reportedCases | Where-Object { [string]$_.name -eq $requiredCase })
        if ($matches.Count -ne 1 -or $matches[0].passed -ne $true) {
            throw "$Label report is missing a unique passing case: $requiredCase"
        }
    }
}

function Assert-RequiredReadinessChecks {
    param($Report, [string[]]$RequiredChecks)
    $reportedChecks = @($Report.checks)
    if ($reportedChecks.Count -eq 0 -or @($reportedChecks | Where-Object { $_.passed -ne $true }).Count -ne 0) {
        throw "Readiness report must contain only passing checks."
    }
    $uniqueNames = @($reportedChecks | ForEach-Object { [string]$_.name } | Select-Object -Unique)
    if ($uniqueNames.Count -ne $reportedChecks.Count) {
        throw "Readiness report contains duplicate check names."
    }
    foreach ($requiredCheck in $RequiredChecks) {
        if (@($reportedChecks | Where-Object { [string]$_.name -eq $requiredCheck }).Count -ne 1) {
            throw "Readiness report is missing a required passing check: $requiredCheck"
        }
    }
}

if ($ExpectedGitCommit -notmatch '^[0-9a-fA-F]{40}$') {
    throw "ExpectedGitCommit must be a full 40-character Git SHA."
}
if ($BuildId -notmatch '^[0-9a-fA-F-]{32,36}$') {
    throw "BuildId must be a UUID-like identifier."
}
foreach ($expectedHash in @(
    $ExpectedSidecarSha256,
    $ExpectedDesktopSha256,
    $ExpectedInstallerSha256,
    $ExpectedFaultReportSha256,
    $ExpectedMigrationReportSha256,
    $ExpectedReadinessReportSha256
)) {
    if ($expectedHash -notmatch '^[0-9a-fA-F]{64}$') {
        throw "Every expected artifact and report hash must be a 64-character SHA-256 value."
    }
}
try {
    $buildStartedAt = [DateTimeOffset]::Parse($BuildStartedAtUtc).ToUniversalTime()
    $artifactsCompletedAt = [DateTimeOffset]::Parse($ArtifactsCompletedAtUtc).ToUniversalTime()
}
catch {
    throw "Build timestamps must be valid ISO-8601 values."
}
if ($artifactsCompletedAt -lt $buildStartedAt -or $artifactsCompletedAt -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) {
    throw "Artifact completion time is outside the build session."
}
try {
    $buildEnvironmentJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($BuildEnvironmentBase64))
    $buildEnvironment = $buildEnvironmentJson | ConvertFrom-Json
    $environmentCapturedAt = [DateTimeOffset]::Parse([string]$buildEnvironment.captured_at).ToUniversalTime()
}
catch {
    throw "BuildEnvironmentBase64 must contain valid UTF-8 JSON with a captured_at timestamp."
}
if ($environmentCapturedAt -lt $buildStartedAt -or $environmentCapturedAt -gt $artifactsCompletedAt) {
    throw "Build environment evidence was not captured during this build session."
}
if ($null -eq $buildEnvironment.host -or $null -eq $buildEnvironment.tools -or $null -eq $buildEnvironment.scripts) {
    throw "Build environment evidence must include host, tools, and script hashes."
}
foreach ($toolName in @("powershell", "git", "node", "npm", "python", "pyinstaller", "rustc", "cargo", "tauri")) {
    $tool = $buildEnvironment.tools.PSObject.Properties[$toolName].Value
    if ($null -eq $tool -or [string]::IsNullOrWhiteSpace([string]$tool.path) -or [string]::IsNullOrWhiteSpace([string]$tool.version)) {
        throw "Build environment evidence is missing required tool data: $toolName"
    }
}
foreach ($scriptHashName in @("orchestrator_sha256", "provenance_finalizer_sha256")) {
    $scriptHash = [string]$buildEnvironment.scripts.PSObject.Properties[$scriptHashName].Value
    if ($scriptHash -notmatch '^[0-9a-fA-F]{64}$') {
        throw "Build environment evidence is missing a valid script hash: $scriptHashName"
    }
}
$currentOrchestratorSha256 = Get-Sha256 (Join-Path $ScriptDir "build-windows-release.ps1")
$currentFinalizerSha256 = Get-Sha256 $MyInvocation.MyCommand.Path
if ([string]$buildEnvironment.scripts.orchestrator_sha256 -ne $currentOrchestratorSha256 -or [string]$buildEnvironment.scripts.provenance_finalizer_sha256 -ne $currentFinalizerSha256) {
    throw "Release scripts changed after build environment capture."
}

$null = Assert-ExpectedSourceState "provenance start"

$outputFullPath = [IO.Path]::GetFullPath($OutputPath)
if (-not $outputFullPath.StartsWith($RootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Provenance output must be inside the repository."
}
Assert-NoReparsePoints $outputFullPath "Provenance output"
if (Test-Path -LiteralPath $outputFullPath) {
    throw "Refusing to overwrite an existing provenance manifest: $outputFullPath"
}
$outputRelativePath = Get-RepositoryRelativePath $outputFullPath
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    & git -C $RootDir check-ignore -q -- $outputRelativePath
    $checkIgnoreExit = $LASTEXITCODE
}
finally { $ErrorActionPreference = $previousErrorActionPreference }
if ($checkIgnoreExit -ne 0) {
    throw "Provenance output must be Git-ignored so writing evidence cannot dirty the verified source tree: $outputRelativePath"
}

$artifactSpecs = @(
    [ordered]@{ name = "sidecar"; path = $SidecarPath; expected_sha256 = $ExpectedSidecarSha256.ToLowerInvariant() },
    [ordered]@{ name = "desktop"; path = $DesktopPath; expected_sha256 = $ExpectedDesktopSha256.ToLowerInvariant() },
    [ordered]@{ name = "installer"; path = $InstallerPath; expected_sha256 = $ExpectedInstallerSha256.ToLowerInvariant() }
)
$artifactEvidence = @()
$artifactByName = @{}
foreach ($spec in $artifactSpecs) {
    $item = Resolve-RepositoryFile $spec.path ($spec.name + " artifact")
    if ($item.LastWriteTimeUtc -lt $buildStartedAt.UtcDateTime) {
        throw "$($spec.name) artifact predates this build session: $($item.LastWriteTimeUtc.ToString('o'))."
    }
    if ($item.LastWriteTimeUtc -gt $artifactsCompletedAt.UtcDateTime.AddSeconds(1)) {
        throw "$($spec.name) artifact changed after artifact completion was recorded."
    }
    $artifactSha256 = Get-Sha256 $item.FullName
    if ($artifactSha256 -ne $spec.expected_sha256) {
        throw "$($spec.name) artifact changed after the build completed."
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
    $certificateTablePresent = Test-PeCertificateTablePresent $item.FullName
    $evidence = [ordered]@{
        name = $spec.name
        path = Get-RepositoryRelativePath $item.FullName
        bytes = [long]$item.Length
        sha256 = $artifactSha256
        built_at = $item.LastWriteTimeUtc.ToString("o")
        authenticode = [ordered]@{
            status = $signature.Status.ToString()
            certificate_table_present = $certificateTablePresent
            signer_subject = $(if ($null -ne $signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { $null })
            signer_thumbprint = $(if ($null -ne $signature.SignerCertificate) { [string]$signature.SignerCertificate.Thumbprint } else { $null })
            timestamped = $null -ne $signature.TimeStamperCertificate
            timestamper_subject = $(if ($null -ne $signature.TimeStamperCertificate) { [string]$signature.TimeStamperCertificate.Subject } else { $null })
            timestamper_thumbprint = $(if ($null -ne $signature.TimeStamperCertificate) { [string]$signature.TimeStamperCertificate.Thumbprint } else { $null })
        }
    }
    $artifactEvidence += $evidence
    $artifactByName[$spec.name] = $evidence
}

$fault = Read-BoundReport $FaultReportPath "fault" "bookreader-windows-fault-smoke" $ExpectedFaultReportSha256 $artifactsCompletedAt
$migration = Read-BoundReport $MigrationReportPath "migration" "bookreader-windows-migration-fixtures" $ExpectedMigrationReportSha256 $artifactsCompletedAt
$readiness = Read-BoundReport $ReadinessReportPath "readiness" "bookreader-windows-release-readiness" $ExpectedReadinessReportSha256 $artifactsCompletedAt

$faultCases = @(
    "windows_host",
    "sidecar_present",
    "desktop_present",
    "unicode_launch_path",
    "long_data_root",
    "missing_sidecar_preflight",
    "authenticated_health",
    "unauthenticated_rejected",
    "isolated_store_initialization",
    "managed_book_path_240_to_250",
    "authenticated_long_path_api",
    "clean_process_tree_shutdown",
    "desktop_spawned_owned_sidecar",
    "desktop_sidecar_hash_matches_release_artifact",
    "desktop_isolated_store_initialization",
    "desktop_crash_watchdog_shutdown",
    "invalid_data_root_fails_closed"
)
$migrationCases = @(
    "legacy_data_migration_is_allowlisted_verified_and_non_destructive",
    "legacy_data_migration_replaces_only_pristine_destination_scaffold",
    "legacy_data_migration_does_not_partially_clear_non_pristine_scaffold",
    "legacy_data_migration_rejects_conflicting_destination_data",
    "legacy_data_migration_rejects_same_size_staged_tampering",
    "legacy_data_migration_rejects_invalid_completed_marker"
)
Assert-RequiredCaseMatrix $fault.data "Fault" $faultCases
Assert-RequiredCaseMatrix $migration.data "Migration" $migrationCases

$requiredReadinessChecks = @(
    "policy_version_semver",
    "policy_versions_aligned",
    "policy_product_name_frozen",
    "policy_main_binary_name_frozen",
    "policy_identifier_present",
    "policy_downgrades_blocked",
    "policy_install_scope_frozen",
    "policy_runtime_updater_disabled",
    "policy_command",
    "evidence_build_id",
    "evidence_source_commit",
    "evidence_source_branch",
    "evidence_worktree_clean",
    "artifact_shortcut_guide_resource_mapping",
    "artifact_shortcut_guide_source_exists",
    "artifact_shortcut_guide_exists",
    "artifact_sidecar_exists",
    "artifact_sidecar_fresh",
    "artifact_desktop_exists",
    "artifact_desktop_filename",
    "artifact_desktop_product_name",
    "artifact_desktop_fresh",
    "artifact_installer_exists",
    "artifact_installer_product_name",
    "artifact_installer_fresh",
    "artifact_shortcut_guide_hash_matches",
    "artifact_shortcut_guide_fresh",
    "windows_fault_report",
    "windows_fault_kind",
    "windows_fault_application_version",
    "windows_fault_build_id",
    "windows_fault_source_commit",
    "windows_fault_sidecar_sha256",
    "windows_fault_desktop_sha256",
    "windows_fault_fresh",
    "migration_fixtures_report",
    "migration_fixtures_kind",
    "migration_fixtures_application_version",
    "migration_fixtures_build_id",
    "migration_fixtures_source_commit",
    "migration_fixtures_migration_source_sha256",
    "migration_fixtures_desktop_sha256",
    "migration_fixtures_fresh"
)
$requiredReadinessChecks += @($faultCases | ForEach-Object { "windows_fault_case_" + $_ })
$requiredReadinessChecks += @($migrationCases | ForEach-Object { "migration_fixtures_case_" + $_ })
foreach ($artifact in $artifactEvidence) {
    if ($artifact.authenticode.status -notin @("NotSigned", "Valid")) {
        throw "Release candidates reject damaged or indeterminate Authenticode state: $($artifact.name) is $($artifact.authenticode.status)."
    }
    if ($artifact.authenticode.status -eq "NotSigned" -and $artifact.authenticode.certificate_table_present) {
        throw "Release candidates reject an invalid embedded Authenticode certificate table: $($artifact.name)."
    }
}

if ($Profile -eq "Public") {
    $requiredReadinessChecks += @(
        "policy_release_identifier_frozen",
        "policy_publisher_frozen",
        "policy_certificate_thumbprint_present",
        "policy_timestamp_url_https"
    )
    foreach ($name in @("sidecar", "desktop", "installer")) {
        $requiredReadinessChecks += @(
            "signature_${name}_valid",
            "signature_${name}_publisher",
            "signature_${name}_timestamped"
        )
    }
    $requiredReadinessChecks += "signature_single_publisher"
}
Assert-RequiredReadinessChecks $readiness.data $requiredReadinessChecks

if ([string]$fault.data.sidecar_sha256 -ne [string]$artifactByName.sidecar.sha256 -or [string]$fault.data.desktop_sha256 -ne [string]$artifactByName.desktop.sha256) {
    throw "Fault report artifact hashes do not match this build."
}
$migrationSourcePath = Join-Path $RootDir "frontend\src-tauri\src\lib.rs"
$migrationSource = Resolve-RepositoryFile $migrationSourcePath "migration source"
if ([string]$migration.data.desktop_sha256 -ne [string]$artifactByName.desktop.sha256 -or [string]$migration.data.migration_source_sha256 -ne (Get-Sha256 $migrationSource.FullName)) {
    throw "Migration report hashes do not match this build."
}
if ([string]$readiness.data.profile -ne $Profile.ToLowerInvariant()) {
    throw "Readiness profile does not match the requested release profile."
}
foreach ($name in @("sidecar", "desktop", "installer")) {
    $matches = @($readiness.data.artifacts | Where-Object { [string]$_.name -eq $name })
    if ($matches.Count -ne 1) {
        throw "Readiness report must contain exactly one $name artifact."
    }
    $reported = $matches[0]
    if ([string]$reported.sha256 -ne [string]$artifactByName[$name].sha256 -or [long]$reported.bytes -ne [long]$artifactByName[$name].bytes) {
        throw "Readiness $name artifact does not match this build."
    }
    $reportedPath = [string]$reported.path
    $reportedFullPath = $(if ([IO.Path]::IsPathRooted($reportedPath)) { [IO.Path]::GetFullPath($reportedPath) } else { [IO.Path]::GetFullPath((Join-Path $RootDir $reportedPath)) })
    $expectedFullPath = [IO.Path]::GetFullPath((Join-Path $RootDir ([string]$artifactByName[$name].path)))
    if (-not $reportedFullPath.Equals($expectedFullPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Readiness $name artifact path does not match the explicit build artifact."
    }
}

if ($Profile -eq "Public") {
    $publicSigners = @()
    foreach ($artifact in $artifactEvidence) {
        if ($artifact.authenticode.status -ne "Valid" -or -not $artifact.authenticode.timestamped -or [string]::IsNullOrWhiteSpace([string]$artifact.authenticode.signer_thumbprint)) {
            throw "Public provenance requires every executable artifact to have a valid timestamped Authenticode signature."
        }
        $publicSigners += [string]$artifact.authenticode.signer_thumbprint
    }
    if (@($publicSigners | Select-Object -Unique).Count -ne 1) {
        throw "Public provenance requires one signer across sidecar, desktop, and installer."
    }
}

foreach ($spec in $artifactSpecs) {
    $item = Resolve-RepositoryFile $spec.path ($spec.name + " artifact")
    $recorded = $artifactByName[$spec.name]
    if ([long]$item.Length -ne [long]$recorded.bytes -or (Get-Sha256 $item.FullName) -ne [string]$recorded.sha256) {
        throw "$($spec.name) artifact changed during provenance verification."
    }
}
foreach ($reportCheck in @($fault, $migration, $readiness)) {
    if ((Get-Sha256 $reportCheck.item.FullName) -ne [string]$reportCheck.sha256) {
        throw "A release report changed during provenance verification."
    }
}
$sourceAtEnd = Assert-ExpectedSourceState "provenance end"
$verificationCompletedAt = [DateTimeOffset]::UtcNow

function Get-ReportEvidence {
    param($BoundReport, [hashtable]$Bindings)
    return [ordered]@{
        path = Get-RepositoryRelativePath $BoundReport.item.FullName
        bytes = [long]$BoundReport.item.Length
        sha256 = $BoundReport.sha256
        kind = [string]$BoundReport.data.kind
        profile = $(if ($null -ne $BoundReport.data.PSObject.Properties["profile"]) { [string]$BoundReport.data.profile } else { $null })
        generated_at = $BoundReport.generated_at
        passed = $true
        binds = $Bindings
    }
}

$manifest = [ordered]@{
    schema_version = 1
    kind = "bookreader-windows-release-provenance"
    application_version = $(if ([string]::IsNullOrWhiteSpace($ApplicationVersion)) { [string]$readiness.data.application_version } else { $ApplicationVersion })
    profile = $Profile.ToLowerInvariant()
    generated_at = $verificationCompletedAt.ToString("o")
    passed = $true
    source = [ordered]@{
        commit = $sourceAtEnd.commit
        branch = $sourceAtEnd.branch
        detached = $sourceAtEnd.branch -eq "HEAD"
        clean_at_start = $true
        clean_at_end = $true
    }
    build = [ordered]@{
        id = $BuildId
        started_at = $buildStartedAt.ToString("o")
        artifacts_completed_at = $artifactsCompletedAt.ToString("o")
        verification_completed_at = $verificationCompletedAt.ToString("o")
        environment_captured_at = $environmentCapturedAt.ToString("o")
        host = $buildEnvironment.host
        tools = $buildEnvironment.tools
        scripts = $buildEnvironment.scripts
    }
    artifacts = $artifactEvidence
    reports = [ordered]@{
        fault = Get-ReportEvidence $fault @{ sidecar_sha256 = $artifactByName.sidecar.sha256; desktop_sha256 = $artifactByName.desktop.sha256 }
        migration = Get-ReportEvidence $migration @{ desktop_sha256 = $artifactByName.desktop.sha256; migration_source_sha256 = Get-Sha256 $migrationSource.FullName }
        readiness = Get-ReportEvidence $readiness @{ sidecar_sha256 = $artifactByName.sidecar.sha256; desktop_sha256 = $artifactByName.desktop.sha256; installer_sha256 = $artifactByName.installer.sha256 }
    }
}

$outputParent = Split-Path -Parent $outputFullPath
if (-not [string]::IsNullOrWhiteSpace($outputParent)) {
    New-Item -ItemType Directory -Path $outputParent -Force | Out-Null
}
Assert-NoReparsePoints $outputFullPath "Provenance output"
$temporaryOutput = $outputFullPath + ".tmp-" + [Guid]::NewGuid().ToString("N")
try {
    $manifestJson = $manifest | ConvertTo-Json -Depth 12
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($temporaryOutput, $manifestJson, $utf8WithoutBom)
    [IO.File]::Move($temporaryOutput, $outputFullPath)
    if (-not (Test-Path -LiteralPath $outputFullPath -PathType Leaf)) {
        throw "Atomic provenance write did not produce the expected manifest file."
    }
    Assert-NoReparsePoints $outputFullPath "Provenance output"
}
finally {
    if (Test-Path -LiteralPath $temporaryOutput) { Remove-Item -LiteralPath $temporaryOutput -Force }
}

Write-Host "[release] provenance written to $outputFullPath"
Write-Output ($manifest | ConvertTo-Json -Depth 12)
