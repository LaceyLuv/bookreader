param(
    [ValidateSet("Candidate", "Public")]
    [string]$Profile = "Public",
    [string]$FaultReportPath = "",
    [string]$MigrationReportPath = "",
    [string]$ReadinessReportPath = "",
    [string]$ProvenancePath = ""
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    throw "Gyeol Reader Windows releases must be built on Windows."
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Split-Path -Parent $ScriptDir
$RootDir = Split-Path -Parent $FrontendDir
$TauriDir = Join-Path $FrontendDir "src-tauri"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmssfff"
$profileSlug = $Profile.ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($FaultReportPath)) {
    $FaultReportPath = Join-Path $RootDir ("reports\release\windows-fault-" + $timestamp + ".json")
}
if ([string]::IsNullOrWhiteSpace($MigrationReportPath)) {
    $MigrationReportPath = Join-Path $RootDir ("reports\release\migration-fixtures-" + $timestamp + ".json")
}
if ([string]::IsNullOrWhiteSpace($ReadinessReportPath)) {
    $ReadinessReportPath = Join-Path $RootDir ("reports\release\" + $profileSlug + "-readiness-" + $timestamp + ".json")
}
if ([string]::IsNullOrWhiteSpace($ProvenancePath)) {
    $ProvenancePath = Join-Path $RootDir ("reports\release\release-provenance-" + $timestamp + ".json")
}
foreach ($pathVariable in @("FaultReportPath", "MigrationReportPath", "ReadinessReportPath", "ProvenancePath")) {
    $pathValue = Get-Variable -Name $pathVariable -ValueOnly
    if (-not [IO.Path]::IsPathRooted($pathValue)) {
        $pathValue = Join-Path $RootDir $pathValue
    }
    $normalizedPath = [IO.Path]::GetFullPath($pathValue)
    $rootPrefix = $RootDir.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $normalizedPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$pathVariable must stay inside the repository: $normalizedPath"
    }
    Set-Variable -Name $pathVariable -Value $normalizedPath
}
$releaseOutputPaths = @($FaultReportPath, $MigrationReportPath, $ReadinessReportPath, $ProvenancePath)
if (@($releaseOutputPaths | Select-Object -Unique).Count -ne $releaseOutputPaths.Count) {
    throw "Fault, migration, readiness, and provenance output paths must be distinct."
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
    if ($exitCode -ne 0) { throw "Git status failed for $RootDir" }
    return @($lines | ForEach-Object { $_.ToString() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Invoke-NativeToHost {
    param([scriptblock]$Command)
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Command | Out-Host
        return $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousErrorActionPreference }
}

function Get-ToolEvidence {
    param([string]$Command, [string[]]$Arguments = @())
    $resolved = Get-Command $Command -ErrorAction SilentlyContinue
    if ($null -eq $resolved) { throw "Required build tool was not found: $Command" }
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $LASTEXITCODE = 0
        $lines = @(& $Command @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousErrorActionPreference }
    if ($exitCode -ne 0) { throw "Build tool version command failed ($Command, exit $exitCode)." }
    $toolPath = [string]$resolved.Source
    return [ordered]@{
        path = $toolPath
        version = ($lines -join [Environment]::NewLine).Trim()
        sha256 = $(if (Test-Path -LiteralPath $toolPath -PathType Leaf) { (Get-FileHash -LiteralPath $toolPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null })
    }
}

function Assert-CleanSourceState {
    param([string]$ExpectedCommit = "", [string]$ExpectedBranch = "", [string]$Phase)
    $commit = Read-GitValue @("rev-parse", "HEAD")
    $branch = Read-GitValue @("rev-parse", "--abbrev-ref", "HEAD")
    $status = @(Read-GitStatus)
    if ($status.Count -ne 0) {
        throw "Release build requires a clean worktree at $Phase. Dirty entries: $($status -join '; ')"
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedCommit) -and $commit -ne $ExpectedCommit) {
        throw "Git commit changed during release build at $Phase."
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedBranch) -and $branch -ne $ExpectedBranch) {
        throw "Git branch changed during release build at $Phase."
    }
    return [ordered]@{ commit = $commit; branch = $branch }
}

function Resolve-OneFreshArtifact {
    param([string]$Directory, [string]$Filter, [DateTime]$MinimumBuiltAtUtc, [string]$Label)
    $matches = @(Get-ChildItem -LiteralPath $Directory -Filter $Filter -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTimeUtc -ge $MinimumBuiltAtUtc })
    if ($matches.Count -ne 1) {
        throw "Expected exactly one fresh $Label artifact from this build, found $($matches.Count)."
    }
    return $matches[0]
}

$sourceAtStart = Assert-CleanSourceState -Phase "build start"
$sourceCommit = [string]$sourceAtStart.commit
$sourceBranch = [string]$sourceAtStart.branch
$buildId = [Guid]::NewGuid().ToString("D")
$buildStartedAt = [DateTimeOffset]::UtcNow

$pythonCommand = Join-Path $RootDir "backend\.venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $pythonCommand -PathType Leaf)) { $pythonCommand = "python" }
$tauriCliPath = Join-Path $ScriptDir "tauri-cli.cjs"
$hostInfo = $null
try { $hostInfo = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop } catch {}
$tauriTool = Get-ToolEvidence "node" @($tauriCliPath, "--version")
$tauriTool["cli_path"] = $tauriCliPath
$tauriTool["cli_sha256"] = (Get-FileHash -LiteralPath $tauriCliPath -Algorithm SHA256).Hash.ToLowerInvariant()
$buildEnvironment = [ordered]@{
    captured_at = [DateTimeOffset]::UtcNow.ToString("o")
    host = [ordered]@{
        os = $(if ($null -ne $hostInfo) { [string]$hostInfo.Caption } else { [Environment]::OSVersion.VersionString })
        version = $(if ($null -ne $hostInfo) { [string]$hostInfo.Version } else { [Environment]::OSVersion.Version.ToString() })
        architecture = [string]$env:PROCESSOR_ARCHITECTURE
    }
    tools = [ordered]@{
        powershell = [ordered]@{
            path = $(if ($null -ne (Get-Process -Id $PID).Path) { (Get-Process -Id $PID).Path } else { $null })
            version = $PSVersionTable.PSVersion.ToString()
            sha256 = $(if ($null -ne (Get-Process -Id $PID).Path) { (Get-FileHash -LiteralPath (Get-Process -Id $PID).Path -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null })
        }
        git = Get-ToolEvidence "git" @("--version")
        node = Get-ToolEvidence "node" @("--version")
        npm = Get-ToolEvidence "npm" @("--version")
        python = Get-ToolEvidence $pythonCommand @("--version")
        pyinstaller = Get-ToolEvidence $pythonCommand @("-m", "PyInstaller", "--version")
        rustc = Get-ToolEvidence "rustc" @("--version")
        cargo = Get-ToolEvidence "cargo" @("--version")
        tauri = $tauriTool
    }
    scripts = [ordered]@{
        orchestrator_sha256 = (Get-FileHash -LiteralPath $MyInvocation.MyCommand.Path -Algorithm SHA256).Hash.ToLowerInvariant()
        provenance_finalizer_sha256 = (Get-FileHash -LiteralPath (Join-Path $ScriptDir "write-release-provenance.ps1") -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$buildEnvironmentJson = $buildEnvironment | ConvertTo-Json -Depth 8 -Compress
$buildEnvironmentBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($buildEnvironmentJson))

$tauriConfig = Get-Content -LiteralPath (Join-Path $TauriDir "tauri.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$mainBinaryName = [string]$tauriConfig.mainBinaryName
if ([string]::IsNullOrWhiteSpace($mainBinaryName)) {
    throw "tauri.conf.json mainBinaryName must identify the packaged desktop executable."
}

$thumbprint = (([string]$env:BOOKREADER_WINDOWS_CERTIFICATE_THUMBPRINT) -replace '\s', '').ToUpperInvariant()
$timestampUrl = [string]$env:BOOKREADER_WINDOWS_TIMESTAMP_URL

Push-Location $FrontendDir
try {
    $policyExit = Invoke-NativeToHost { & node (Join-Path $ScriptDir "release-policy.mjs") --profile $profileSlug }
    if ($policyExit -ne 0) {
        throw "$Profile release policy failed."
    }

    if ($Profile -eq "Public") {
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
            $tauriExit = Invoke-NativeToHost { & node (Join-Path $ScriptDir "tauri-cli.cjs") build --ci --config $overlayPath -- --locked }
            if ($tauriExit -ne 0) { throw "Tauri public release build failed with exit code $tauriExit." }
        }
        finally {
            if (Test-Path -LiteralPath $overlayPath) { Remove-Item -LiteralPath $overlayPath -Force }
        }
    }
    else {
        $tauriExit = Invoke-NativeToHost { & node (Join-Path $ScriptDir "tauri-cli.cjs") build --ci -- --locked }
        if ($tauriExit -ne 0) { throw "Tauri candidate build failed with exit code $tauriExit." }
    }

    $guideExit = Invoke-NativeToHost { & node (Join-Path $ScriptDir "package-shortcut-guide.mjs") }
    if ($guideExit -ne 0) { throw "Shortcut guide packaging failed with exit code $guideExit." }

    $stagingSidecar = Resolve-OneFreshArtifact (Join-Path $TauriDir "binaries") "bookreader-backend-*.exe" $buildStartedAt.UtcDateTime "staging sidecar"
    $sidecar = Get-Item -LiteralPath (Join-Path $TauriDir "target\release\bookreader-backend.exe") -ErrorAction SilentlyContinue
    if ($null -eq $sidecar -or $sidecar.LastWriteTimeUtc -lt $buildStartedAt.UtcDateTime) {
        throw "Packaged sidecar artifact was not produced by this build session."
    }
    $stagingSidecarSha256 = (Get-FileHash -LiteralPath $stagingSidecar.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $sidecarSha256 = (Get-FileHash -LiteralPath $sidecar.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($stagingSidecarSha256 -ne $sidecarSha256) {
        throw "Packaged sidecar does not match the freshly built staging sidecar."
    }
    $desktop = Get-Item -LiteralPath (Join-Path $TauriDir ("target\release\" + $mainBinaryName + ".exe")) -ErrorAction SilentlyContinue
    if ($null -eq $desktop -or $desktop.LastWriteTimeUtc -lt $buildStartedAt.UtcDateTime) {
        throw "Desktop artifact was not produced by this build session."
    }
    $installer = Resolve-OneFreshArtifact (Join-Path $TauriDir "target\release\bundle\nsis") "*-setup.exe" $buildStartedAt.UtcDateTime "installer"
    $desktopSha256 = (Get-FileHash -LiteralPath $desktop.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $installerSha256 = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $artifactsCompletedAt = [DateTimeOffset]::UtcNow

    $migrationExit = Invoke-NativeToHost { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "windows-migration-fixtures.ps1") -DesktopPath $desktop.FullName -OutputPath $MigrationReportPath -BuildId $buildId -SourceCommit $sourceCommit -SourceBranch $sourceBranch }
    if ($migrationExit -ne 0) { throw "Windows migration fixtures failed." }
    $migrationReportSha256 = (Get-FileHash -LiteralPath $MigrationReportPath -Algorithm SHA256).Hash.ToLowerInvariant()

    $faultExit = Invoke-NativeToHost { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "windows-sidecar-fault-smoke.ps1") -SidecarPath $sidecar.FullName -DesktopPath $desktop.FullName -OutputPath $FaultReportPath -BuildId $buildId -SourceCommit $sourceCommit -SourceBranch $sourceBranch }
    if ($faultExit -ne 0) { throw "Windows sidecar fault smoke failed." }
    $faultReportSha256 = (Get-FileHash -LiteralPath $FaultReportPath -Algorithm SHA256).Hash.ToLowerInvariant()

    $readinessExit = Invoke-NativeToHost { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "release-readiness.ps1") -Profile $Profile -SidecarPath $sidecar.FullName -DesktopPath $desktop.FullName -InstallerPath $installer.FullName -FaultReportPath $FaultReportPath -MigrationReportPath $MigrationReportPath -BuildId $buildId -SourceCommit $sourceCommit -SourceBranch $sourceBranch -OutputPath $ReadinessReportPath }
    if ($readinessExit -ne 0) { throw "$Profile release artifact verification failed." }
    $readinessReportSha256 = (Get-FileHash -LiteralPath $ReadinessReportPath -Algorithm SHA256).Hash.ToLowerInvariant()

    $null = Assert-CleanSourceState -ExpectedCommit $sourceCommit -ExpectedBranch $sourceBranch -Phase "pre-provenance"
    $provenanceExit = Invoke-NativeToHost { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "write-release-provenance.ps1") -Profile $Profile -BuildId $buildId -ExpectedGitCommit $sourceCommit -ExpectedGitBranch $sourceBranch -BuildStartedAtUtc $buildStartedAt.ToString("o") -ArtifactsCompletedAtUtc $artifactsCompletedAt.ToString("o") -BuildEnvironmentBase64 $buildEnvironmentBase64 -SidecarPath $sidecar.FullName -DesktopPath $desktop.FullName -InstallerPath $installer.FullName -ExpectedSidecarSha256 $sidecarSha256 -ExpectedDesktopSha256 $desktopSha256 -ExpectedInstallerSha256 $installerSha256 -FaultReportPath $FaultReportPath -ExpectedFaultReportSha256 $faultReportSha256 -MigrationReportPath $MigrationReportPath -ExpectedMigrationReportSha256 $migrationReportSha256 -ReadinessReportPath $ReadinessReportPath -ExpectedReadinessReportSha256 $readinessReportSha256 -OutputPath $ProvenancePath -ApplicationVersion ([string]$tauriConfig.version) }
    if ($provenanceExit -ne 0) { throw "Release provenance finalization failed." }

    Write-Host "[release] $Profile Windows release passed: $ProvenancePath"
}
finally {
    Pop-Location
}
