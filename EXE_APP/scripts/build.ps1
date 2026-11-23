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

    Write-Host "[3/5] Building the background Python game server..." -ForegroundColor Cyan
    $repoRoot = Split-Path -Parent $exeApp
    $pythonEntry = Join-Path $repoRoot "neon_swarm.py"
    $pythonRequirements = Join-Path $exeApp "PythonHost\requirements.txt"
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        throw "Python 3.12 is required to build neon_web_python.exe."
    }
    & python --version
    & python -m pip install --disable-pip-version-check -r $pythonRequirements
    if ($LASTEXITCODE -ne 0) { throw "Python host dependencies could not be installed." }
    $pythonArgs = @(
        "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--windowed",
        "--name", "neon_web_python", "--distpath", $publish,
        "--workpath", (Join-Path $dist "python-work"),
        "--specpath", (Join-Path $dist "python-spec"),
        "--collect-all", "cryptography", "--hidden-import", "auth"
    )
    foreach ($asset in @(
        "neon_swarm_features.js",
        "neon_swarm_expansion.js",
        "neon_swarm_apex.js",
        "neon_swarm_ultimate.js",
        "neon_swarm_round2.js",
        "Raya(Slowed).mp3"
    )) {
        $assetPath = Join-Path $repoRoot $asset
        if (-not (Test-Path $assetPath)) { throw "Python server asset is missing: $assetPath" }
        $pythonArgs += @("--add-data", "$assetPath;.")
    }
    $pythonArgs += $pythonEntry
    Push-Location $repoRoot
    try {
        & python @pythonArgs
        if ($LASTEXITCODE -ne 0) { throw "neon_web_python.exe packaging failed." }
    }
    finally { Pop-Location }

    foreach ($required in @(
        (Join-Path $publish "Neon_Swarm.exe"),
        (Join-Path $publish "Neon_Swarm_Crash_Handler.exe"),
        (Join-Path $publish "Neon_Swarm_Pick.exe"),
        (Join-Path $publish "Admin_Panel.exe"),
        (Join-Path $publish "Neon_Swarm_Update_Checker_Background.exe"),
        (Join-Path $publish "Neon_Swarm_Webview2_Background.exe"),
        (Join-Path $publish "Game\index.html")
    )) {
        if (-not (Test-Path $required)) { throw "Required publish output is missing: $required" }
    }
    if ($SkipInstaller) {
        Write-Host "Portable build ready: $publish" -ForegroundColor Green
        return
    }

    Write-Host "[3/4] Publishing resolution picker, Admin Panel and background services..." -ForegroundColor Cyan
    $extraProjects = @(
        "Picker/Picker.csproj",
        "AdminPanel/AdminPanel.csproj",
        "UpdateChecker/UpdateChecker.csproj",
        "WebViewBackground/WebViewBackground.csproj"
    )
    foreach ($project in $extraProjects) {
        & dotnet publish $project -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -p:PublishReadyToRun=true -o $publish
        if ($LASTEXITCODE -ne 0) { throw "Publish failed: $project" }
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
    & wix extension add -g WixToolset.Util.wixext/6.0.0
    if ($LASTEXITCODE -ne 0) { throw "Could not add the WiX Util extension." }

    $runtime = Join-Path $dist "MicrosoftEdgeWebView2Setup.exe"
    Invoke-WebRequest -UseBasicParsing -Uri "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $runtime
    $msi = Join-Path $dist "Neon_Swarm_Setup.msi"
    $setup = Join-Path $dist "Neon_Swarm_Setup.exe"
    $buildNumber = if ($env:GITHUB_RUN_NUMBER) { [int]$env:GITHUB_RUN_NUMBER } else { 1 }
    $productVersion = "1.0.$buildNumber"
    & wix build -arch x64 -ext WixToolset.UI.wixext -d "PublishDir=$publish" -d "ProductVersion=$productVersion" "Installer/Msi/Package.wxs" -out $msi
    if ($LASTEXITCODE -ne 0) { throw "WiX could not create the MSI." }
    & wix build -arch x64 -ext WixToolset.BootstrapperApplications.wixext -ext WixToolset.Util.wixext -d "BundleVersion=1.0.$buildNumber.0" -d "MsiPath=$msi" -d "WebView2Installer=$runtime" "Installer/Bundle/Bundle.wxs" -out $setup
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
