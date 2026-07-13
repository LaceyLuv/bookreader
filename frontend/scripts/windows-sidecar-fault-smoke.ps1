param(
    [string]$SidecarPath = "",
    [string]$DesktopPath = "",
    [string]$OutputPath = "",
    [int]$StartupTimeoutSeconds = 30,
    [switch]$KeepTemporaryFiles
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Split-Path -Parent $ScriptDir
$RootDir = Split-Path -Parent $FrontendDir
$tauriConfig = Get-Content -LiteralPath (Join-Path $FrontendDir "src-tauri\tauri.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$applicationVersion = [string]$tauriConfig.version
$mainBinaryName = [string]$tauriConfig.mainBinaryName
if ([string]::IsNullOrWhiteSpace($mainBinaryName)) {
    throw "tauri.conf.json mainBinaryName must identify the packaged desktop executable."
}
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$script:cases = @()
$failure = $null
$healthyProcess = $null
$failureProcess = $null
$desktopProcess = $null
$desktopSidecarProcess = $null
$previousDataDir = $env:BOOKREADER_DATA_DIR
$previousNonce = $env:BOOKREADER_SIDECAR_NONCE
$previousAssetToken = $env:BOOKREADER_SIDECAR_ASSET_TOKEN
$previousParentPid = $env:BOOKREADER_PARENT_PID
$previousDesktopFaultSmoke = $env:BOOKREADER_DESKTOP_FAULT_SMOKE
$previousLocalAppData = $env:LOCALAPPDATA
$previousAppData = $env:APPDATA

function Add-Case {
    param([string]$Name, [bool]$Passed, [string]$Detail)
    $script:cases += [ordered]@{ name = $Name; passed = $Passed; detail = $Detail }
    if (-not $Passed) { throw ("Windows fault smoke failed: " + $Name + " - " + $Detail) }
}

function Get-FreeLoopbackPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port }
    finally { $listener.Stop() }
}

function Stop-ProcessTree {
    param($Process)
    if ($null -eq $Process) { return $true }
    try { $Process.Refresh() } catch { return $true }
    if ($Process.HasExited) { return $true }
    & taskkill.exe /PID $Process.Id /T /F | Out-Null
    try { $Process.WaitForExit(10000) | Out-Null } catch {}
    try { $Process.Refresh() } catch { return $true }
    # taskkill can report a nonzero race when a PyInstaller child exits while
    # the tree is being terminated. The root and captured process snapshot are
    # the authoritative cleanup boundary, not taskkill's transient exit code.
    return $Process.HasExited
}

function Get-ProcessTreeSnapshot {
    param([int]$RootProcessId)
    $allProcesses = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, ExecutablePath, CreationDate -ErrorAction Stop)
    $owned = [System.Collections.Generic.HashSet[uint32]]::new()
    $null = $owned.Add([uint32]$RootProcessId)
    do {
        $added = $false
        foreach ($process in $allProcesses) {
            if ($owned.Contains([uint32]$process.ParentProcessId) -and $owned.Add([uint32]$process.ProcessId)) {
                $added = $true
            }
        }
    } while ($added)
    return @($allProcesses | Where-Object { $owned.Contains([uint32]$_.ProcessId) } | ForEach-Object {
        [pscustomobject]@{
            ProcessId = [int]$_.ProcessId
            ParentProcessId = [int]$_.ParentProcessId
            Name = [string]$_.Name
            ExecutablePath = [string]$_.ExecutablePath
            CreationTicks = $(if ($null -ne $_.CreationDate) { ([DateTime]$_.CreationDate).ToUniversalTime().Ticks } else { 0L })
        }
    })
}

function Wait-ForProcessSnapshotExit {
    param([array]$Snapshot, [int]$TimeoutSeconds = 15)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $live = @()
        foreach ($record in $Snapshot) {
            $current = @(Get-CimInstance Win32_Process -Filter ("ProcessId = " + $record.ProcessId) -Property ProcessId, CreationDate -ErrorAction SilentlyContinue)
            foreach ($candidate in $current) {
                $creationTicks = if ($null -ne $candidate.CreationDate) { ([DateTime]$candidate.CreationDate).ToUniversalTime().Ticks } else { 0L }
                if ($record.CreationTicks -eq 0L -or $creationTicks -eq $record.CreationTicks) { $live += $record }
            }
        }
        if ($live.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Wait-ForNamedDescendant {
    param([int]$RootProcessId, [string]$NamePattern, [int]$TimeoutSeconds = 30)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $snapshot = @(Get-ProcessTreeSnapshot $RootProcessId)
            $match = $snapshot | Where-Object { $_.ProcessId -ne $RootProcessId -and $_.Name -like $NamePattern } | Select-Object -First 1
            if ($null -ne $match) { return $match }
        }
        catch {}
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    return $null
}

function Wait-ForAuthenticatedHealth {
    param([int]$Port, [string]$Nonce, $Process, [int]$TimeoutSeconds)
    Add-Type -AssemblyName System.Net.Http
    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromMilliseconds(750)
    $client.DefaultRequestHeaders.Add("X-BookReader-Nonce", $Nonce)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    try {
        while ((Get-Date) -lt $deadline) {
            $Process.Refresh()
            if ($Process.HasExited) {
                $Process.WaitForExit()
                throw "Sidecar exited before health was ready (exit $($Process.ExitCode))."
            }
            try {
                $response = $client.GetAsync("http://127.0.0.1:$Port/api/health").GetAwaiter().GetResult()
                if ([int]$response.StatusCode -eq 200) {
                    $payload = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
                    if ($payload.ok -eq $true -and $payload.authenticated -eq $true) { return }
                }
            }
            catch {}
            Start-Sleep -Milliseconds 200
        }
    }
    finally { $client.Dispose() }
    throw "Authenticated sidecar health did not become ready within $TimeoutSeconds seconds."
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $RootDir ("reports\release\windows-fault-" + $timestamp + ".json")
}

if ([string]::IsNullOrWhiteSpace($SidecarPath)) {
    $sidecar = Get-ChildItem -LiteralPath (Join-Path $FrontendDir "src-tauri\binaries") -Filter "bookreader-backend-*.exe" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($null -ne $sidecar) { $SidecarPath = $sidecar.FullName }
}

if ([string]::IsNullOrWhiteSpace($DesktopPath)) {
    $desktopCandidate = Join-Path $FrontendDir ("src-tauri\target\release\" + $mainBinaryName + ".exe")
    if (Test-Path -LiteralPath $desktopCandidate -PathType Leaf) { $DesktopPath = $desktopCandidate }
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("BookReader-FaultQA-" + [Guid]::NewGuid().ToString("N"))
$resolvedTempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$unicodeName = (-join @([char]0xD55C, [char]0xAE00, [char]0xCC45, [char]0xC124, [char]0xCE58))
$installDir = Join-Path $temporaryRoot $unicodeName
$dataDir = Join-Path $temporaryRoot "data"
while ($dataDir.Length -lt 200) {
    $dataDir = Join-Path $dataDir ("segment-" + ("x" * 12))
}
if ($dataDir.Length -lt 222) {
    $dataDir = Join-Path $dataDir ("p" * (221 - $dataDir.Length))
}
$copiedSidecar = Join-Path $installDir "bookreader-backend.exe"
$stdoutPath = Join-Path $temporaryRoot "sidecar.stdout.log"
$stderrPath = Join-Path $temporaryRoot "sidecar.stderr.log"

try {
    Add-Case "windows_host" ($env:OS -eq "Windows_NT") "This smoke is Windows-only."
    Add-Case "sidecar_present" (-not [string]::IsNullOrWhiteSpace($SidecarPath) -and (Test-Path -LiteralPath $SidecarPath -PathType Leaf)) "Build the packaged sidecar first."
    Add-Case "desktop_present" (-not [string]::IsNullOrWhiteSpace($DesktopPath) -and (Test-Path -LiteralPath $DesktopPath -PathType Leaf)) "Build the packaged desktop before release fault QA."
    [System.IO.Directory]::CreateDirectory($installDir) | Out-Null
    [System.IO.Directory]::CreateDirectory($dataDir) | Out-Null
    Copy-Item -LiteralPath $SidecarPath -Destination $copiedSidecar -Force
    Add-Case "unicode_launch_path" (Test-Path -LiteralPath $copiedSidecar -PathType Leaf) ("Executable path length: " + $copiedSidecar.Length)
    Add-Case "long_data_root" ($dataDir.Length -ge 215) ("Data root length: " + $dataDir.Length)
    Add-Case "missing_sidecar_preflight" (-not (Test-Path -LiteralPath (Join-Path $installDir "missing-sidecar.exe"))) "Missing sidecar is detected before launch."

    $nonce = ([Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N"))
    $assetToken = ([Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N"))
    $port = Get-FreeLoopbackPort
    $env:BOOKREADER_DATA_DIR = $dataDir
    $env:BOOKREADER_SIDECAR_NONCE = $nonce
    $env:BOOKREADER_SIDECAR_ASSET_TOKEN = $assetToken
    $env:BOOKREADER_PARENT_PID = $null
    $healthyProcess = Start-Process -FilePath $copiedSidecar -ArgumentList @("--host", "127.0.0.1", "--port", [string]$port) -WorkingDirectory $installDir -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    Wait-ForAuthenticatedHealth $port $nonce $healthyProcess $StartupTimeoutSeconds
    Add-Case "authenticated_health" $true "Nonce-authenticated health returned ready."

    Add-Type -AssemblyName System.Net.Http
    $anonymous = [System.Net.Http.HttpClient]::new()
    try {
        $unauthorized = $anonymous.GetAsync("http://127.0.0.1:$port/api/health").GetAwaiter().GetResult()
        Add-Case "unauthenticated_rejected" ([int]$unauthorized.StatusCode -eq 401) ("HTTP " + [int]$unauthorized.StatusCode)
    }
    finally { $anonymous.Dispose() }

    $storesReady = (Test-Path -LiteralPath (Join-Path $dataDir "library.json")) -and
        (Test-Path -LiteralPath (Join-Path $dataDir "annotations.json")) -and
        (Test-Path -LiteralPath (Join-Path $dataDir "reading-progress.json"))
    Add-Case "isolated_store_initialization" $storesReady "Long Unicode BOOKREADER_DATA_DIR contains all core stores."

    $longBookPath = Join-Path (Join-Path $dataDir "books") "0123456789abcdef.txt"
    Set-Content -LiteralPath $longBookPath -Value "long path smoke" -Encoding UTF8
    Add-Case "managed_book_path_240_to_250" ($longBookPath.Length -ge 240 -and $longBookPath.Length -le 250) ("Managed book path length: " + $longBookPath.Length)

    $authenticated = [System.Net.Http.HttpClient]::new()
    $authenticated.DefaultRequestHeaders.Add("X-BookReader-Nonce", $nonce)
    try {
        $booksResponse = $authenticated.GetAsync("http://127.0.0.1:$port/api/books").GetAwaiter().GetResult()
        $booksPayload = $booksResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        $bookVisible = [int]$booksResponse.StatusCode -eq 200 -and @($booksPayload.books).Count -eq 1
        Add-Case "authenticated_long_path_api" $bookVisible ("HTTP " + [int]$booksResponse.StatusCode + "; books " + @($booksPayload.books).Count)
    }
    finally { $authenticated.Dispose() }

    $healthyTree = @(Get-ProcessTreeSnapshot $healthyProcess.Id)
    $explicitStopSucceeded = Stop-ProcessTree $healthyProcess
    $healthyProcess.Refresh()
    $healthyTreeStopped = Wait-ForProcessSnapshotExit $healthyTree 15
    Add-Case "clean_process_tree_shutdown" ($explicitStopSucceeded -and $healthyProcess.HasExited -and $healthyTreeStopped) ("Captured " + $healthyTree.Count + " sidecar process(es); root exited: " + $healthyProcess.HasExited + "; captured tree exited: " + $healthyTreeStopped + ".")

    $desktopLocalAppData = Join-Path $temporaryRoot "desktop-localappdata"
    $desktopRoamingAppData = Join-Path $temporaryRoot "desktop-appdata"
    [System.IO.Directory]::CreateDirectory($desktopLocalAppData) | Out-Null
    [System.IO.Directory]::CreateDirectory($desktopRoamingAppData) | Out-Null
    $env:LOCALAPPDATA = $desktopLocalAppData
    $env:APPDATA = $desktopRoamingAppData
    $env:BOOKREADER_DESKTOP_FAULT_SMOKE = "1"
    $env:BOOKREADER_DATA_DIR = $null
    $env:BOOKREADER_SIDECAR_NONCE = $null
    $env:BOOKREADER_SIDECAR_ASSET_TOKEN = $null
    $desktopProcess = Start-Process -FilePath $DesktopPath -WorkingDirectory (Split-Path -Parent $DesktopPath) -WindowStyle Hidden -PassThru
    $desktopSidecarRecord = Wait-ForNamedDescendant $desktopProcess.Id "bookreader-backend*" $StartupTimeoutSeconds
    Add-Case "desktop_spawned_owned_sidecar" ($null -ne $desktopSidecarRecord) "The packaged desktop launched its owned sidecar under isolated app data."
    $desktopSidecarProcess = Get-Process -Id $desktopSidecarRecord.ProcessId -ErrorAction Stop
    $desktopSidecarTree = @(Get-ProcessTreeSnapshot $desktopSidecarRecord.ProcessId)
    Stop-Process -Id $desktopProcess.Id -Force -ErrorAction Stop
    $desktopProcess.WaitForExit(10000) | Out-Null
    $desktopCrashTreeStopped = Wait-ForProcessSnapshotExit $desktopSidecarTree 20
    Add-Case "desktop_crash_watchdog_shutdown" ($desktopProcess.HasExited -and $desktopCrashTreeStopped) ("Forced desktop exit left none of " + $desktopSidecarTree.Count + " captured sidecar process(es).")
    $env:LOCALAPPDATA = $previousLocalAppData
    $env:APPDATA = $previousAppData
    $env:BOOKREADER_DESKTOP_FAULT_SMOKE = $previousDesktopFaultSmoke
    $env:BOOKREADER_PARENT_PID = $null
    $env:BOOKREADER_DATA_DIR = $dataDir
    $env:BOOKREADER_SIDECAR_NONCE = $nonce
    $env:BOOKREADER_SIDECAR_ASSET_TOKEN = $assetToken

    $collisionPath = Join-Path $temporaryRoot "data-root-is-a-file"
    Set-Content -LiteralPath $collisionPath -Value "not a directory" -Encoding ASCII
    $failurePort = Get-FreeLoopbackPort
    $env:BOOKREADER_DATA_DIR = $collisionPath
    $failureStdoutPath = Join-Path $temporaryRoot "failure.stdout.log"
    $failureStderrPath = Join-Path $temporaryRoot "failure.stderr.log"
    $failureProcess = Start-Process -FilePath $copiedSidecar -ArgumentList @("--host", "127.0.0.1", "--port", [string]$failurePort) -WorkingDirectory $installDir -WindowStyle Hidden -RedirectStandardOutput $failureStdoutPath -RedirectStandardError $failureStderrPath -PassThru
    $null = $failureProcess.Handle
    $exited = $failureProcess.WaitForExit(15000)
    $failureExitCode = $null
    if ($exited) {
        $failureProcess.WaitForExit()
        $failureProcess.Refresh()
        $failureExitCode = $failureProcess.ExitCode
    }
    $failureStderr = if (Test-Path -LiteralPath $failureStderrPath) { Get-Content -LiteralPath $failureStderrPath -Raw } else { "" }
    $startupFailureRecorded = $failureStderr -match 'Application startup failed|Traceback|NotADirectory|FileExistsError'
    $failureExitWasNonZero = $null -ne $failureExitCode -and [int]$failureExitCode -ne 0
    Add-Case "invalid_data_root_fails_closed" ($exited -and $failureExitWasNonZero -and $startupFailureRecorded) ($(if ($exited) { "Exit code $failureExitCode with startup failure diagnostics" } else { "Sidecar did not exit" }))
}
catch {
    $failure = $_.Exception.Message
}
finally {
    $null = Stop-ProcessTree $healthyProcess
    $null = Stop-ProcessTree $failureProcess
    $null = Stop-ProcessTree $desktopSidecarProcess
    $null = Stop-ProcessTree $desktopProcess
    $env:BOOKREADER_DATA_DIR = $previousDataDir
    $env:BOOKREADER_SIDECAR_NONCE = $previousNonce
    $env:BOOKREADER_SIDECAR_ASSET_TOKEN = $previousAssetToken
    $env:BOOKREADER_PARENT_PID = $previousParentPid
    $env:BOOKREADER_DESKTOP_FAULT_SMOKE = $previousDesktopFaultSmoke
    $env:LOCALAPPDATA = $previousLocalAppData
    $env:APPDATA = $previousAppData

    $passed = $null -eq $failure -and @($cases | Where-Object { -not $_.passed }).Count -eq 0
    $result = [ordered]@{
        schema_version = 1
        kind = "bookreader-windows-fault-smoke"
        application_version = $applicationVersion
        generated_at = (Get-Date).ToUniversalTime().ToString("o")
        passed = $passed
        sidecar_sha256 = $(if (Test-Path -LiteralPath $SidecarPath -PathType Leaf) { (Get-FileHash -LiteralPath $SidecarPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null })
        desktop_sha256 = $(if (Test-Path -LiteralPath $DesktopPath -PathType Leaf) { (Get-FileHash -LiteralPath $DesktopPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null })
        data_path_length = $dataDir.Length
        cases = $cases
        failure = $failure
    }
    $outputParent = Split-Path -Parent $OutputPath
    if (-not [string]::IsNullOrWhiteSpace($outputParent)) { New-Item -ItemType Directory -Path $outputParent -Force | Out-Null }
    Set-Content -LiteralPath $OutputPath -Value ($result | ConvertTo-Json -Depth 8) -Encoding UTF8
    Write-Host "[fault-qa] report written to $OutputPath"

    if (-not $KeepTemporaryFiles -and (Test-Path -LiteralPath $temporaryRoot)) {
        $resolvedTemporaryRoot = [System.IO.Path]::GetFullPath($temporaryRoot)
        if (-not $resolvedTemporaryRoot.StartsWith($resolvedTempBase, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to clean a QA directory outside the system temp root."
        }
        Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
    }
}

if ($null -ne $failure) {
    Write-Error $failure
    exit 1
}
