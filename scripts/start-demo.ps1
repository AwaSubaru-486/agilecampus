param(
    [ValidateRange(1, 65535)][int]$Port = 3110,
    [ValidateRange(1, 65535)][int]$DatabasePort = 55437,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Join-Path $project '.runtime\demo'
$nodeRelease = 'node-v22.23.5-win-x64'
$pgRelease = 'postgresql-16.16-2-windows-x64-binaries'
$pgRoot = Join-Path $runtime $pgRelease

function Get-Sha256($Path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead([IO.Path]::Combine($project, $Path))
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
}

function Install-PortableRuntime($Url, $Sha256, $Archive, $Program, $Destination, $Entries = @()) {
    if (Test-Path -LiteralPath $Program -PathType Leaf) { return }
    if (-not (Test-Path -LiteralPath $Archive) -or (Get-Sha256 $Archive) -ne $Sha256) {
        Write-Host ('Downloading ' + [IO.Path]::GetFileName($Archive) + '...')
        & curl.exe --fail --location --retry 2 --silent --show-error --output $Archive $Url
        if ($LASTEXITCODE -ne 0) { throw 'Runtime download failed. Check your internet connection, then run start-demo.cmd again.' }
    }
    if ((Get-Sha256 $Archive) -ne $Sha256) { throw 'Runtime download failed SHA-256 verification.' }
    [void](New-Item -ItemType Directory -Path $Destination -Force)
    & tar.exe -xf $Archive -C $Destination @Entries
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Program -PathType Leaf)) {
        throw 'Could not extract the demo runtime.'
    }
}

function Invoke-Native($Program, [string[]]$Arguments, $Failure) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw $Failure }
}

$runtimeHash = [Security.Cryptography.SHA256]::Create()
$lockName = [BitConverter]::ToString($runtimeHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($project))).Replace('-', '')
$runtimeHash.Dispose()
$mutex = New-Object Threading.Mutex($false, "Local\AgileCampus-Demo-$lockName")
$locked = $false
Push-Location -LiteralPath $project
try {
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { Write-Host 'The demo is already starting. Please wait.'; return }

    [void](New-Item -ItemType Directory -Path $runtime -Force)
    $nodeRoot = Join-Path $runtime $nodeRelease
    $nodeExe = Join-Path $nodeRoot 'node.exe'
    $pgBin = Join-Path $pgRoot 'pgsql\bin'
    $pgCtl = Join-Path $pgBin 'pg_ctl.exe'
    Install-PortableRuntime "https://nodejs.org/dist/v22.23.5/$nodeRelease.zip" '4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3' (Join-Path $runtime "$nodeRelease.zip") $nodeExe $runtime
    Install-PortableRuntime "https://get.enterprisedb.com/postgresql/$pgRelease.zip" 'add1de261b150e6923266abee293f05050795e73f5356158aee4221a2170c073' $(
        Join-Path $runtime "$pgRelease.zip"
    ) $pgCtl $pgRoot @('pgsql/bin', 'pgsql/lib', 'pgsql/share')
    $env:Path = "$nodeRoot;$env:Path"
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $env:AGILECAMPUS_DEMO_RUNTIME = '1'

    $settingsPath = Join-Path $runtime 'settings.json'
    if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
        $settingsJson = & $nodeExe -e "const { randomBytes } = require('node:crypto'); console.log(JSON.stringify({ dbPassword: randomBytes(24).toString('hex'), authSecret: randomBytes(32).toString('hex') }))"
        if ($LASTEXITCODE -ne 0) { throw 'Could not generate demo credentials.' }
        $settingsJson | Set-Content -LiteralPath $settingsPath -Encoding ASCII
    }
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    $data = Join-Path $runtime 'pgdata'
    $env:PGPASSWORD = $settings.dbPassword
    if (-not (Test-Path -LiteralPath (Join-Path $data 'PG_VERSION'))) {
        $passwordFile = Join-Path $runtime 'initdb-password.txt'
        $settings.dbPassword | Set-Content -LiteralPath $passwordFile -Encoding ASCII
        try {
            Invoke-Native (Join-Path $pgBin 'initdb.exe') @('-D', $data, '-U', 'agilecampus_demo', '--encoding=UTF8', '--locale=C', '--auth=scram-sha-256', "--pwfile=$passwordFile") 'Could not initialize the demo database.'
        } finally {
            Remove-Item -LiteralPath $passwordFile -Force
        }
    }

    # Keep PostgreSQL on loopback and isolated from the development database.
    & $pgCtl -D $data status | Out-Null
    if ($LASTEXITCODE -ne 0) {
        $config = "listen_addresses = '127.0.0.1'" + [Environment]::NewLine + "port = $DatabasePort"
        $config | Set-Content -LiteralPath (Join-Path $data 'postgresql.auto.conf') -Encoding ASCII
        $pgLog = Join-Path $runtime 'postgres.log'
        $started = Start-Process -FilePath $pgCtl -ArgumentList '-D', ('"' + $data + '"'), '-l', ('"' + $pgLog + '"'), '-w', 'start' -WindowStyle Hidden -PassThru
        $started.WaitForExit()
        if ($started.ExitCode -ne 0) { throw "Demo database startup failed. Check $pgLog." }
    }

    $pgArgs = @('-h', '127.0.0.1', '-p', [string]$DatabasePort, '-U', 'agilecampus_demo', '-w')
    $psql = Join-Path $pgBin 'psql.exe'
    $exists = & $psql @pgArgs -d postgres -Atc "select 1 from pg_database where datname = 'agilecampus_demo'"
    if ($LASTEXITCODE -ne 0) { throw 'Could not reach the demo database. Use the same database port as the running demo.' }
    if ($exists -ne '1') {
        Invoke-Native (Join-Path $pgBin 'createdb.exe') ($pgArgs + 'agilecampus_demo') 'Could not create the demo database.'
    }

    $env:DATABASE_URL = "postgresql://agilecampus_demo:$($settings.dbPassword)@127.0.0.1:$DatabasePort/agilecampus_demo"
    $env:AUTH_SECRET = $settings.authSecret
    $env:AUTH_TRUST_HOST = 'true'
    $env:AUTH_URL = "http://127.0.0.1:$Port"
    $env:AGILECAMPUS_URL = $env:AUTH_URL

    $npm = Join-Path $nodeRoot 'npm.cmd'
    $lockHash = Get-Sha256 (Join-Path $project 'package-lock.json')
    $npmStamp = Join-Path $runtime 'npm-lock-hash'
    if (-not (Test-Path -LiteralPath 'node_modules\next\dist\bin\next') -or
        -not (Test-Path -LiteralPath $npmStamp) -or (Get-Content -LiteralPath $npmStamp) -ne $lockHash) {
        Write-Host 'Installing web app dependencies. This can take a few minutes on the first launch.'
        Invoke-Native $npm @('ci', '--include=dev', '--no-audit', '--no-fund') 'Could not install the web app dependencies.'
        $lockHash | Set-Content -LiteralPath $npmStamp -Encoding ASCII
    }

    $schemaHash = Get-Sha256 (Join-Path $project 'src\db\schema.ts')
    $schemaStamp = Join-Path $runtime 'schema-hash'
    if ($exists -ne '1' -or -not (Test-Path -LiteralPath $schemaStamp) -or
        (Get-Content -LiteralPath $schemaStamp) -ne $schemaHash) {
        Invoke-Native $npm @('run', 'db:push') 'Could not prepare the demo schema.'
        $schemaHash | Set-Content -LiteralPath $schemaStamp -Encoding ASCII
    }
    Invoke-Native $nodeExe @('scripts/seed-showcase.mjs') 'Could not prepare the showcase data.'
    & (Join-Path $PSScriptRoot 'start-local.ps1') -Port $Port -NoBrowser:$NoBrowser
} finally {
    Pop-Location
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
