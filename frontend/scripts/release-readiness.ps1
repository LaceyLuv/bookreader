param(
    [ValidateSet("Development", "Candidate", "Public", "Updater")]
    [string]$Profile = "Development",
    [string]$FaultReportPath = "",
    [string]$RollbackReportPath = "",
    [string]$MigrationReportPath = "",
    [string]$UpdaterManifestPath = "",
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Split-Path -Parent $ScriptDir
$RootDir = Split-Path -Parent $FrontendDir
$TauriDir = Join-Path $FrontendDir "src-tauri"
$tauriConfig = Get-Content -LiteralPath (Join-Path $TauriDir "tauri.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$mainBinaryName = [string]$tauriConfig.mainBinaryName
if ([string]::IsNullOrWhiteSpace($mainBinaryName)) {
    throw "tauri.conf.json mainBinaryName must identify the packaged desktop executable."
}
$script:checks = @()
$artifacts = @()

function Add-Check {
    param([string]$Name, [bool]$Passed, [string]$Detail)
    $script:checks += [ordered]@{ name = $Name; passed = $Passed; detail = $Detail }
}

function Resolve-LatestFile {
    param([string]$Path, [string]$Filter)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return Get-ChildItem -LiteralPath $Path -Filter $Filter -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
}

function Read-PassedReport {
    param(
        [string]$Path,
        [string]$Label,
        [string]$ExpectedKind = "",
        [string]$ExpectedApplicationVersion = "",
        [hashtable]$ExpectedHashes = @{},
        [string[]]$RequiredCases = @(),
        [string]$MinimumGeneratedAtUtc = ""
    )
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Add-Check ($Label + "_report") $false ("Missing " + $Label + " report.")
        return
    }
    try {
        $report = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        $validReport = $report.schema_version -eq 1 -and $report.passed -eq $true
        Add-Check ($Label + "_report") $validReport ("Report: " + (Resolve-Path -LiteralPath $Path))
        if (-not [string]::IsNullOrWhiteSpace($ExpectedKind)) {
            Add-Check ($Label + "_kind") ($validReport -and [string]$report.kind -eq $ExpectedKind) ("Expected report kind: " + $ExpectedKind)
        }
        if (-not [string]::IsNullOrWhiteSpace($ExpectedApplicationVersion)) {
            $reportedVersion = [string]$report.application_version
            Add-Check ($Label + "_application_version") ($validReport -and $reportedVersion -eq $ExpectedApplicationVersion) ("Expected application version " + $ExpectedApplicationVersion + "; report version " + $(if ($reportedVersion) { $reportedVersion } else { "(missing)" }))
        }
        foreach ($hashName in $ExpectedHashes.Keys) {
            $property = $report.PSObject.Properties[[string]$hashName]
            $reportedHash = $(if ($null -ne $property) { ([string]$property.Value).ToLowerInvariant() } else { "" })
            $expectedHash = ([string]$ExpectedHashes[$hashName]).ToLowerInvariant()
            Add-Check ($Label + "_" + $hashName) ($validReport -and $reportedHash -match '^[0-9a-f]{64}$' -and $reportedHash -eq $expectedHash) ("The report must match the current " + $hashName + ".")
        }
        foreach ($requiredCase in $RequiredCases) {
            $matchingCases = @($report.cases | Where-Object { [string]$_.name -eq $requiredCase })
            Add-Check ($Label + "_case_" + $requiredCase) ($validReport -and $matchingCases.Count -eq 1 -and $matchingCases[0].passed -eq $true) ("Required passing case: " + $requiredCase)
        }
        if (-not [string]::IsNullOrWhiteSpace($MinimumGeneratedAtUtc)) {
            $generatedAt = [DateTimeOffset]::Parse([string]$report.generated_at).UtcDateTime
            $minimum = [DateTimeOffset]::Parse($MinimumGeneratedAtUtc).UtcDateTime
            $fresh = $generatedAt -ge $minimum -and $generatedAt -le (Get-Date).ToUniversalTime().AddMinutes(5)
            Add-Check ($Label + "_fresh") ($validReport -and $fresh) ("Report generated " + $generatedAt.ToString('o') + "; required after " + $minimum.ToString('o'))
        }
    }
    catch {
        Add-Check ($Label + "_report") $false ("Invalid " + $Label + " report: " + $_.Exception.Message)
    }
}

$policyProfile = $Profile.ToLowerInvariant()
$policyLines = & node (Join-Path $ScriptDir "release-policy.mjs") --profile $policyProfile 2>&1
$policyExit = $LASTEXITCODE
try {
    $policy = ($policyLines -join [Environment]::NewLine) | ConvertFrom-Json
    foreach ($item in $policy.checks) {
        Add-Check ("policy_" + $item.name) ([bool]$item.passed) ([string]$item.detail)
    }
    Add-Check "policy_command" ($policyExit -eq 0 -and $policy.ok -eq $true) ("Policy profile: " + $policyProfile)
}
catch {
    Add-Check "policy_command" $false ("Release policy did not return valid JSON: " + ($policyLines -join " "))
}

if ($Profile -ne "Development") {
    $sidecar = Resolve-LatestFile (Join-Path $TauriDir "binaries") "bookreader-backend-*.exe"
    $desktop = Get-Item -LiteralPath (Join-Path $TauriDir ("target\release\" + $mainBinaryName + ".exe")) -ErrorAction SilentlyContinue
    $installer = Resolve-LatestFile (Join-Path $TauriDir "target\release\bundle\nsis") "*-setup.exe"
    $artifactItems = @(
        [ordered]@{ name = "sidecar"; item = $sidecar },
        [ordered]@{ name = "desktop"; item = $desktop },
        [ordered]@{ name = "installer"; item = $installer }
    )

    $shortcutGuideMappings = @()
    if ($null -ne $tauriConfig.bundle.resources) {
        $productName = [string]$tauriConfig.productName
        $shortcutGuideMappings = @($tauriConfig.bundle.resources.PSObject.Properties | Where-Object {
            $targetName = [IO.Path]::GetFileName([string]$_.Value)
            $targetStem = [IO.Path]::GetFileNameWithoutExtension($targetName)
            [IO.Path]::GetExtension([string]$_.Name) -ieq ".txt" -and
                [IO.Path]::GetExtension($targetName) -ieq ".txt" -and
                $targetStem.StartsWith($productName + "_", [StringComparison]::Ordinal)
        })
    }
    Add-Check "artifact_shortcut_guide_resource_mapping" ($shortcutGuideMappings.Count -eq 1) ("Expected one product TXT resource mapping; found " + $shortcutGuideMappings.Count)

    $shortcutGuideSource = $null
    $shortcutGuide = $null
    if ($shortcutGuideMappings.Count -eq 1) {
        $shortcutGuideMapping = $shortcutGuideMappings[0]
        $shortcutGuideSource = Get-Item -LiteralPath (Join-Path $TauriDir ([string]$shortcutGuideMapping.Name)) -ErrorAction SilentlyContinue
        $bundledGuideName = [IO.Path]::GetFileName([string]$shortcutGuideMapping.Value)
        $bundledGuideExtension = [IO.Path]::GetExtension($bundledGuideName)
        $bundledGuideStem = [IO.Path]::GetFileNameWithoutExtension($bundledGuideName)
        $bundledGuideSuffix = $bundledGuideStem.Substring(([string]$tauriConfig.productName).Length)
        $releaseGuideName = ([string]$tauriConfig.productName) + "_" + ([string]$tauriConfig.version) + $bundledGuideSuffix + $bundledGuideExtension
        $shortcutGuide = Get-Item -LiteralPath (Join-Path $TauriDir ("target\release\bundle\nsis\" + $releaseGuideName)) -ErrorAction SilentlyContinue
    }
    Add-Check "artifact_shortcut_guide_source_exists" ($null -ne $shortcutGuideSource) ($(if ($null -ne $shortcutGuideSource) { $shortcutGuideSource.FullName } else { "Missing shortcut guide source" }))
    Add-Check "artifact_shortcut_guide_exists" ($null -ne $shortcutGuide) ($(if ($null -ne $shortcutGuide) { $shortcutGuide.FullName } else { "Missing packaged shortcut guide" }))

    $sourceFiles = @()
    foreach ($sourceRoot in @(
        (Join-Path $RootDir "backend"),
        (Join-Path $FrontendDir "src"),
        (Join-Path $FrontendDir "scripts"),
        (Join-Path $TauriDir "src"),
        (Join-Path $TauriDir "icons"),
        (Join-Path $TauriDir "resources")
    )) {
        $sourceFiles += Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object {
                $_.FullName -notmatch '\\(build-sidecar|dist-sidecar|books|fonts|__pycache__)\\' -and
                $_.Name -notin @('library.json', 'annotations.json', 'reading-progress.json', 'delete-journal.json', 'restore-journal.json') -and
                $_.Extension -in @('.py', '.js', '.jsx', '.mjs', '.rs', '.toml', '.json', '.ps1', '.spec', '.png', '.ico', '.icns', '.txt')
            }
    }
    foreach ($sourceFile in @(
        (Join-Path $FrontendDir "package.json"),
        (Join-Path $TauriDir "Cargo.toml"),
        (Join-Path $TauriDir "Cargo.lock"),
        (Join-Path $TauriDir "tauri.conf.json")
    )) {
        if (Test-Path -LiteralPath $sourceFile -PathType Leaf) { $sourceFiles += Get-Item -LiteralPath $sourceFile }
    }
    $newestSource = $sourceFiles | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1

    $sidecarSha256 = ""
    $desktopSha256 = ""
    $installerSha256 = ""
    $desktopBuiltAtUtc = ""
    $installerBuiltAtUtc = ""
    $newestArtifactBuiltAtUtc = [DateTime]::MinValue
    foreach ($entry in $artifactItems) {
        $exists = $null -ne $entry.item
        Add-Check ("artifact_" + $entry.name + "_exists") $exists ($(if ($exists) { $entry.item.FullName } else { "Missing artifact" }))
        if (-not $exists) { continue }
        if ($entry.name -eq "desktop") {
            Add-Check "artifact_desktop_filename" ($entry.item.Name -ceq ($mainBinaryName + ".exe")) ("Expected packaged desktop filename: " + $mainBinaryName + ".exe")
        }
        if ($entry.name -eq "desktop" -or $entry.name -eq "installer") {
            $embeddedProductName = [string]$entry.item.VersionInfo.ProductName
            Add-Check ("artifact_" + $entry.name + "_product_name") ($embeddedProductName -ceq [string]$tauriConfig.productName) ("Embedded ProductName: " + $(if ($embeddedProductName) { $embeddedProductName } else { "(missing)" }) + "; expected: " + [string]$tauriConfig.productName)
        }
        $fresh = $null -eq $newestSource -or $entry.item.LastWriteTimeUtc -ge $newestSource.LastWriteTimeUtc
        Add-Check ("artifact_" + $entry.name + "_fresh") $fresh ("Built " + $entry.item.LastWriteTimeUtc.ToString('o') + "; newest source " + $newestSource.LastWriteTimeUtc.ToString('o'))
        $artifactSha256 = (Get-FileHash -LiteralPath $entry.item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($entry.name -eq "sidecar") { $sidecarSha256 = $artifactSha256 }
        if ($entry.name -eq "desktop") {
            $desktopSha256 = $artifactSha256
            $desktopBuiltAtUtc = $entry.item.LastWriteTimeUtc.ToString('o')
        }
        if ($entry.name -eq "installer") {
            $installerSha256 = $artifactSha256
            $installerBuiltAtUtc = $entry.item.LastWriteTimeUtc.ToString('o')
        }
        if ($entry.item.LastWriteTimeUtc -gt $newestArtifactBuiltAtUtc) { $newestArtifactBuiltAtUtc = $entry.item.LastWriteTimeUtc }
        $artifacts += [ordered]@{
            name = $entry.name
            path = $entry.item.FullName
            bytes = $entry.item.Length
            sha256 = $artifactSha256
            built_at = $entry.item.LastWriteTimeUtc.ToString('o')
        }
    }

    if ($null -ne $shortcutGuideSource -and $null -ne $shortcutGuide) {
        $shortcutGuideSourceSha256 = (Get-FileHash -LiteralPath $shortcutGuideSource.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $shortcutGuideSha256 = (Get-FileHash -LiteralPath $shortcutGuide.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        Add-Check "artifact_shortcut_guide_hash_matches" ($shortcutGuideSha256 -eq $shortcutGuideSourceSha256) "The separately distributed shortcut guide must exactly match the bundled source."
        Add-Check "artifact_shortcut_guide_fresh" ($shortcutGuide.LastWriteTimeUtc -ge $shortcutGuideSource.LastWriteTimeUtc) ("Packaged " + $shortcutGuide.LastWriteTimeUtc.ToString('o') + "; source " + $shortcutGuideSource.LastWriteTimeUtc.ToString('o'))
        $artifacts += [ordered]@{
            name = "shortcut_guide"
            path = $shortcutGuide.FullName
            bytes = $shortcutGuide.Length
            sha256 = $shortcutGuideSha256
            built_at = $shortcutGuide.LastWriteTimeUtc.ToString('o')
        }
    }

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
        "desktop_isolated_store_initialization",
        "desktop_crash_watchdog_shutdown",
        "invalid_data_root_fails_closed"
    )
    Read-PassedReport -Path $FaultReportPath -Label "windows_fault" -ExpectedKind "bookreader-windows-fault-smoke" -ExpectedApplicationVersion ([string]$policy.version) -ExpectedHashes @{ sidecar_sha256 = $sidecarSha256; desktop_sha256 = $desktopSha256 } -RequiredCases $faultCases -MinimumGeneratedAtUtc $newestArtifactBuiltAtUtc.ToString('o')

    if ($Profile -eq "Public" -or $Profile -eq "Updater") {
        $migrationCases = @(
            "legacy_data_migration_is_allowlisted_verified_and_non_destructive",
            "legacy_data_migration_rejects_conflicting_destination_data",
            "legacy_data_migration_rejects_same_size_staged_tampering",
            "legacy_data_migration_rejects_invalid_completed_marker"
        )
        $migrationSourceSha256 = (Get-FileHash -LiteralPath (Join-Path $TauriDir "src\lib.rs") -Algorithm SHA256).Hash.ToLowerInvariant()
        Read-PassedReport -Path $MigrationReportPath -Label "migration_fixtures" -ExpectedKind "bookreader-windows-migration-fixtures" -ExpectedApplicationVersion ([string]$policy.version) -ExpectedHashes @{ migration_source_sha256 = $migrationSourceSha256; desktop_sha256 = $desktopSha256 } -RequiredCases $migrationCases -MinimumGeneratedAtUtc $desktopBuiltAtUtc

        $expectedThumbprint = (([string]$env:BOOKREADER_WINDOWS_CERTIFICATE_THUMBPRINT) -replace '\s', '').ToUpperInvariant()
        $signers = @()
        foreach ($entry in $artifactItems) {
            if ($null -eq $entry.item) { continue }
            $signature = Get-AuthenticodeSignature -LiteralPath $entry.item.FullName
            $valid = $signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid
            $thumbprint = if ($null -ne $signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint.ToUpperInvariant() } else { "" }
            $timestamped = $null -ne $signature.TimeStamperCertificate
            Add-Check ("signature_" + $entry.name + "_valid") $valid ("Authenticode status: " + $signature.Status)
            $publisherMatches = $valid -and -not [string]::IsNullOrWhiteSpace($expectedThumbprint) -and $thumbprint -eq $expectedThumbprint
            Add-Check ("signature_" + $entry.name + "_publisher") $publisherMatches ("Signer thumbprint matches configured release certificate: " + $publisherMatches)
            Add-Check ("signature_" + $entry.name + "_timestamped") $timestamped "A trusted timestamp must remain after certificate expiry."
            if ($thumbprint) { $signers += $thumbprint }
        }
        Add-Check "signature_single_publisher" ($signers.Count -eq 3 -and (@($signers | Select-Object -Unique).Count -eq 1)) "Desktop, sidecar, and installer must share one signer."
    }
}

if ($Profile -eq "Updater") {
    $rollbackCases = @(
        "upgrade_n_minus_1_to_n",
        "downgrade_rejected",
        "signed_rollback_restores_snapshot",
        "future_schema_not_rewritten"
    )
    Read-PassedReport -Path $RollbackReportPath -Label "rollback_drill" -ExpectedKind "bookreader-updater-rollback-drill" -ExpectedApplicationVersion ([string]$policy.version) -ExpectedHashes @{ artifact_sha256 = $installerSha256 } -RequiredCases $rollbackCases -MinimumGeneratedAtUtc $installerBuiltAtUtc
    if ([string]::IsNullOrWhiteSpace($UpdaterManifestPath) -or -not (Test-Path -LiteralPath $UpdaterManifestPath -PathType Leaf)) {
        Add-Check "updater_manifest" $false "Missing static updater manifest."
    }
    else {
        try {
            $manifest = Get-Content -LiteralPath $UpdaterManifestPath -Raw | ConvertFrom-Json
            $platform = $manifest.platforms.'windows-x86_64'
            $urlIsHttps = $false
            try { $urlIsHttps = ([Uri]$platform.url).Scheme -eq 'https' } catch { $urlIsHttps = $false }
            $signature = [string]$platform.signature
            $signatureLooksLiteral = $signature.Length -ge 64 -and $signature -notmatch '^(?i:https?://|[a-z]:\\)' -and $signature -notmatch '(?i:\.sig)$' -and $signature -notmatch '(?i:placeholder|change[._-]?me)'
            $manifestFresh = (Get-Item -LiteralPath $UpdaterManifestPath).LastWriteTimeUtc -ge ([DateTimeOffset]::Parse($installerBuiltAtUtc).UtcDateTime)
            $manifestValid = [string]$manifest.version -eq [string]$policy.version -and $null -ne $platform -and $urlIsHttps -and $signatureLooksLiteral -and $manifestFresh
            Add-Check "updater_manifest" $manifestValid "Manifest must match the release version, be newer than the installer, and contain literal non-placeholder signature content for an HTTPS windows-x86_64 artifact."
        }
        catch {
            Add-Check "updater_manifest" $false ("Invalid updater manifest: " + $_.Exception.Message)
        }
    }
}

$passed = @($checks | Where-Object { -not $_.passed }).Count -eq 0
$result = [ordered]@{
    schema_version = 1
    profile = $Profile.ToLowerInvariant()
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    passed = $passed
    checks = $checks
    artifacts = $artifacts
}
$json = $result | ConvertTo-Json -Depth 8

if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
    $parent = Split-Path -Parent $OutputPath
    if (-not [string]::IsNullOrWhiteSpace($parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    Set-Content -LiteralPath $OutputPath -Value $json -Encoding UTF8
    Write-Host "[release] report written to $OutputPath"
}

Write-Output $json
if (-not $passed) { exit 1 }
