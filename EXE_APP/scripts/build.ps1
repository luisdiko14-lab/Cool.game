[CmdletBinding()]
param([switch]$SkipInstaller)

$ErrorActionPreference = "Stop"
$exeApp = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $exeApp "dist"
$publish = Join-Path $dist "Neon_Swarm"
$gameProject = Join-Path $exeApp "NeonSwarm\NeonSwarm.csproj"
$handlerProject = Join-Path $exeApp "CrashHandler\CrashHandler.csproj"

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw ".NET 10 SDK is required. Install it from https://dotnet.microsoft.com/download/dotnet/10.0."
}
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Remove-Item -LiteralPath $publish -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $publish | Out-Null

Push-Location $exeApp
try {
    Write-Host "[1/4] Publishing Neon_Swarm.exe with .NET 10..." -ForegroundColor Cyan
    & dotnet publish $gameProject -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -p:PublishReadyToRun=true -o $publish
    if ($LASTEXITCODE -ne 0) { throw "Neon_Swarm.exe publish failed." }

    Write-Host "[2/4] Publishing the crash recovery helper..." -ForegroundColor Cyan
    & dotnet publish $handlerProject -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -p:PublishReadyToRun=true -o $publish
    if ($LASTEXITCODE -ne 0) { throw "Crash handler publish failed." }

    foreach ($required in @(
        (Join-Path $publish "Neon_Swarm.exe"),
        (Join-Path $publish "Neon_Swarm_Crash_Handler.exe"),
        (Join-Path $publish "Game\index.html")
    )) {
        if (-not (Test-Path $required)) { throw "Required publish output is missing: $required" }
    }
    if ($SkipInstaller) {
        Write-Host "Portable build ready: $publish" -ForegroundColor Green
        return
    }

    Write-Host "[3/4] Preparing WiX Toolset 6 and WebView2..." -ForegroundColor Cyan
    if (-not (Get-Command wix -ErrorAction SilentlyContinue)) {
        & dotnet tool install --global wix --version 6.0.0
        if ($LASTEXITCODE -ne 0) { throw "Could not install WiX Toolset 6." }
        $env:PATH = "$env:PATH;$([Environment]::GetFolderPath('UserProfile'))\.dotnet\tools"
    }
    & wix extension add -g WixToolset.UI.wixext/6.0.0
    if ($LASTEXITCODE -ne 0) { throw "Could not add the WiX UI extension." }
    & wix extension add -g WixToolset.BootstrapperApplications.wixext/6.0.0
    if ($LASTEXITCODE -ne 0) { throw "Could not add the WiX bootstrapper extension." }

    $runtime = Join-Path $dist "MicrosoftEdgeWebView2Setup.exe"
    Invoke-WebRequest -UseBasicParsing -Uri "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $runtime
    $msi = Join-Path $dist "Neon_Swarm_Setup.msi"
    $setup = Join-Path $dist "Neon_Swarm_Setup.exe"
    & wix build -arch x64 -ext WixToolset.UI.wixext -d "PublishDir=$publish" "Installer/Msi/Package.wxs" -out $msi
    if ($LASTEXITCODE -ne 0) { throw "WiX could not create the MSI." }
    & wix build -arch x64 -ext WixToolset.BootstrapperApplications.wixext -d "MsiPath=$msi" -d "WebView2Installer=$runtime" "Installer/Bundle/Bundle.wxs" -out $setup
    if ($LASTEXITCODE -ne 0) { throw "WiX could not create Setup.exe." }

    Write-Host "[4/4] Creating the complete portable ZIP..." -ForegroundColor Cyan
    $portable = Join-Path $dist "Neon_Swarm_Portable.zip"
    Remove-Item -LiteralPath $portable -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path (Join-Path $publish "*") -DestinationPath $portable -CompressionLevel Optimal
    Write-Host "Build completed:" -ForegroundColor Green
    Write-Host $setup
    Write-Host $msi
    Write-Host $portable
}
finally { Pop-Location }
