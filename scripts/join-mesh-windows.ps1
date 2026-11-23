<#
.SYNOPSIS
    Optional fallback helper to join this Windows laptop to the MoonWitness EasyTier P2P mesh via --dhcp.
.DESCRIPTION
    Reads $env:USERPROFILE\.moonwitness\mesh.env, downloads easytier-core.exe into
    $env:USERPROFILE\.moonwitness\bin\ if missing, and connects with automatic IP assignment (--dhcp)
    to bootstrap peer apps.mycocolink.com:11010 so VPS mesh peers (e.g. 10.144.0.1:3003 / :3000)
    are directly reachable from apps/desktop DX Mode.
#>
[CmdletBinding()]
param(
    [string]$MeshEnvPath = (Join-Path $env:USERPROFILE '.moonwitness\mesh.env'),
    [string]$BinDir = (Join-Path $env:USERPROFILE '.moonwitness\bin'),
    [string]$BootstrapHost = 'apps.mycocolink.com',
    [int]$BootstrapPort = 11010,
    [string]$EasyTierVersion = 'v2.2.4',
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Format-RedactedSecret {
    param([Parameter(Mandatory)][string]$Secret)
    $trimmed = $Secret.Trim()
    if ($trimmed.Length -lt 12) {
        return '[REDACTED]'
    }
    return "$($trimmed.Substring(0, 4))...$($trimmed.Substring($trimmed.Length - 4))"
}

function Read-MeshEnvFile {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Mesh credentials file not found at '$Path'. Launch apps/desktop or run ensureMeshCredentials() first."
    }
    $values = @{}
    foreach ($rawLine in Get-Content -LiteralPath $Path) {
        $line = $rawLine.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) {
            continue
        }
        $eqIndex = $line.IndexOf('=')
        if ($eqIndex -le 0) {
            continue
        }
        $key = $line.Substring(0, $eqIndex).Trim()
        $val = $line.Substring($eqIndex + 1).Trim()
        if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
            $val = $val.Substring(1, $val.Length - 2)
        }
        $values[$key] = $val
    }
    return $values
}

function Ensure-EasyTierBinary {
    param(
        [Parameter(Mandatory)][string]$TargetDir,
        [Parameter(Mandatory)][string]$Version
    )
    if (-not (Test-Path -LiteralPath $TargetDir)) {
        New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    }
    $exePath = Join-Path $TargetDir 'easytier-core.exe'
    if (Test-Path -LiteralPath $exePath) {
        return $exePath
    }

    $zipName = "easytier-windows-x86_64-$Version.zip"
    $downloadUrl = "https://github.com/EasyTier/EasyTier/releases/download/$Version/$zipName"
    $tempZip = Join-Path ([System.IO.Path]::GetTempPath()) $zipName
    $tempExtract = Join-Path ([System.IO.Path]::GetTempPath()) ("easytier-extract-" + [System.Guid]::NewGuid().ToString('N'))

    Write-Host "[mesh] Downloading EasyTier $Version from $downloadUrl ..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempZip -UseBasicParsing

    try {
        Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force
        $found = Get-ChildItem -Path $tempExtract -Filter 'easytier-core.exe' -Recurse | Select-Object -First 1
        if (-not $found) {
            throw "easytier-core.exe not found inside downloaded archive '$zipName'."
        }
        Copy-Item -LiteralPath $found.FullName -Destination $exePath -Force
        $cliFound = Get-ChildItem -Path $tempExtract -Filter 'easytier-cli.exe' -Recurse | Select-Object -First 1
        if ($cliFound) {
            Copy-Item -LiteralPath $cliFound.FullName -Destination (Join-Path $TargetDir 'easytier-cli.exe') -Force
        }
    }
    finally {
        Remove-Item -LiteralPath $tempZip -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
    }

    return $exePath
}

$meshEnv = Read-MeshEnvFile -Path $MeshEnvPath
$networkName = $meshEnv['MW_MESH_NETWORK_NAME']
$networkSecret = $meshEnv['MW_MESH_NETWORK_SECRET']

if ([string]::IsNullOrWhiteSpace($networkName) -or [string]::IsNullOrWhiteSpace($networkSecret)) {
    throw "Mesh credentials file '$MeshEnvPath' is missing MW_MESH_NETWORK_NAME or MW_MESH_NETWORK_SECRET."
}

$easyTierExe = Ensure-EasyTierBinary -TargetDir $BinDir -Version $EasyTierVersion
$tcpPeer = "tcp://${BootstrapHost}:${BootstrapPort}"
$udpPeer = "udp://${BootstrapHost}:${BootstrapPort}"

$argsList = @(
    '--dhcp',
    '--network-name', $networkName,
    '--network-secret', $networkSecret,
    '--peers', $tcpPeer, $udpPeer
)

$redactedSecret = Format-RedactedSecret -Secret $networkSecret
Write-Host "[mesh] Binary:        $easyTierExe"
Write-Host "[mesh] Network:       $networkName (secret: $redactedSecret)"
Write-Host "[mesh] IP Mode:       --dhcp (automatic)"
Write-Host "[mesh] Bootstrap:     $tcpPeer, $udpPeer"
Write-Host "[mesh] Sync Targets:  http://10.144.0.1:3003 (control-plane), http://10.144.0.1:3000 (api), http://10.144.0.1:4174 (board)"

if ($DryRun) {
    Write-Host "[mesh] DryRun enabled; skipping easytier-core launch."
    exit 0
}

& $easyTierExe @argsList
exit $LASTEXITCODE
