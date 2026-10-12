param(
    [ValidateSet('production', 'development')][string]$Mode = 'production',
    [ValidateRange(1, 65535)][int]$Port = 3106,
    [switch]$Rebuild,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimePath = Join-Path $projectPath '.runtime'
$runtimeScript = Join-Path $PSScriptRoot 'production-runtime.mjs'
$nodePath = (Get-Command node.exe).Source
$url = "http://127.0.0.1:$Port"
$hashTool = [Security.Cryptography.SHA256]::Create()
$lockHash = [BitConverter]::ToString($hashTool.ComputeHash([Text.Encoding]::UTF8.GetBytes("$projectPath|$Port"))).Replace('-', '')
$hashTool.Dispose()
$mutex = New-Object Threading.Mutex($false, "Local\AgileCampus-$lockHash")
$locked = $false

function Test-ProjectProcess($process) {
    return $process -and $process.Name -eq 'node.exe' -and $process.CommandLine -and
        $process.CommandLine.IndexOf("$projectPath\", [StringComparison]::OrdinalIgnoreCase) -ge 0
}

try {
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { Write-Host 'AgileCampus is already starting. Please wait.'; return }
    [void](New-Item -ItemType Directory -Path $runtimePath -Force)

    $statePath = Join-Path $runtimePath "server-$Port.json"
    $buildState = & $nodePath $runtimeScript check
    if ($LASTEXITCODE -ne 0) { throw 'Could not check the production build.' }
    $needsBuild = $Mode -eq 'production' -and ($Rebuild -or $buildState -ne 'ready')
    $listener = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) | Select-Object -First 1
    $reuse = $false
    if ($listener) {
        $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        if (-not (Test-ProjectProcess $serverProcess)) { throw "Port $Port is used by another application. It has not been stopped." }
        if (Test-Path -LiteralPath $statePath) {
            try {
                $record = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
                $wrapper = Get-Process -Id $record.processId -ErrorAction SilentlyContinue
                $reuse = $wrapper -and $record.mode -eq $Mode -and
                    $wrapper.StartTime.ToUniversalTime() -eq ([datetime]$record.startedAt).ToUniversalTime() -and
                    ($serverProcess.ProcessId -eq $record.processId -or $serverProcess.ParentProcessId -eq $record.processId) -and
                    -not $needsBuild
            } catch { $reuse = $false }
        }
        if (-not $reuse) {
            # Only replace the server whose absolute command path belongs to this
            # checkout. Other project previews and unrelated applications stay open.
            $parentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($serverProcess.ParentProcessId)"
            $stopParent = (Test-ProjectProcess $parentProcess) -or
                ($parentProcess.Name -eq 'node.exe' -and $parentProcess.CommandLine -match 'node_modules[/\\]next[/\\]dist[/\\]bin[/\\]next\s+dev\b')
            Stop-Process -Id $serverProcess.ProcessId -ErrorAction SilentlyContinue
            if ($stopParent) { Stop-Process -Id $parentProcess.ProcessId -ErrorAction SilentlyContinue }
            for ($attempt = 0; $attempt -lt 20; $attempt++) {
                if (-not (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) { break }
                Start-Sleep -Milliseconds 250
            }
            if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Port $Port did not become available." }
        }
    }

    if (-not $reuse) {
        # Use the existing database configuration; never seed or reset data.
        # Some local installations include their own PostgreSQL service.
        $workspacePath = Split-Path -Parent $projectPath
        $pgControl = Join-Path $workspacePath '.local/pgsql/bin/pg_ctl.exe'
        $pgData = Join-Path $workspacePath '.local/pgdata'
        if ((Test-Path -LiteralPath $pgControl) -and (Test-Path -LiteralPath $pgData)) {
            & $pgControl -D $pgData status *> $null
            if ($LASTEXITCODE -ne 0) {
                $databaseStart = Start-Process -FilePath $pgControl -ArgumentList '-D', ('"' + $pgData + '"'), '-l', ('"' + (Join-Path $workspacePath '.local/postgres.log') + '"'), '-w', 'start' -WindowStyle Hidden -PassThru
                $databaseStart.WaitForExit()
                if ($databaseStart.ExitCode -ne 0) { throw 'Database startup failed. Check .local/postgres.log.' }
            }
        }
        if ($needsBuild) {
            Write-Host 'Preparing the production build. Later launches reuse it until source changes.'
            & $nodePath $runtimeScript build
            if ($LASTEXITCODE -ne 0) { throw 'Build failed. No outdated production server was started.' }
        }
        if ($Mode -eq 'production') {
            $arguments = @(('"' + $runtimeScript + '"'), 'start', '--port', [string]$Port, '--hostname', '127.0.0.1')
        } else {
            $nextCli = Join-Path $projectPath 'node_modules/next/dist/bin/next'
            $arguments = @(('"' + $nextCli + '"'), 'dev', '--turbopack', '--port', [string]$Port, '--hostname', '127.0.0.1')
        }
        $started = Start-Process -FilePath $nodePath -ArgumentList $arguments -WorkingDirectory $projectPath -RedirectStandardOutput (Join-Path $runtimePath "server-$Port.log") -RedirectStandardError (Join-Path $runtimePath "server-$Port-error.log") -WindowStyle Hidden -PassThru
        @{ processId = $started.Id; startedAt = $started.StartTime.ToUniversalTime().ToString('o'); mode = $Mode } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    }

    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri "$url/login" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200 -and $response.Content -match 'AgileCampus') { $ready = $true; break }
        } catch { }
        if ($started -and $started.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw "Server did not become ready. Check .runtime/server-$Port-error.log." }
    if (-not $NoBrowser) { Start-Process $url -WindowStyle Hidden }
    Write-Host "AgileCampus is running in $Mode mode at $url"
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
