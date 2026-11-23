$ErrorActionPreference = "Stop"
$exeApp = Split-Path -Parent $PSScriptRoot
$game = Join-Path $exeApp "dist\Neon_Swarm\Neon_Swarm.exe"
if (-not (Test-Path $game)) { throw "Neon_Swarm.exe was not found. Run EXE_APP\scripts\build.ps1 first." }
Start-Process -FilePath $game -WorkingDirectory (Split-Path -Parent $game)
