# Neon Swarm — Windows Desktop Edition

This adds a native Windows desktop edition without replacing the existing web/Python game. The app loads the same public HTML, JavaScript feature modules and music file inside Microsoft Edge WebView2.

## Build outputs

- **Neon_Swarm.exe** — Windows desktop game host.
- **Neon_Swarm_Crash_Handler.exe** — notification-area helper. On a non-zero game exit it asks **Retry to open app?** Yes relaunches the game; No exits the helper.
- **Neon_Swarm_Setup.exe** — setup wizard which installs the WebView2 Evergreen Runtime when needed and then installs the MSI.
- **Neon_Swarm_Setup.msi** — Windows Installer package with the standard install-directory wizard and shortcuts.
- **Neon_Swarm_Portable.zip** — complete app folder with EXE, DLLs, .NET runtime files, WebView2 loader and game assets.

The desktop version keeps its local WebView profile, offline leaderboard and save backup in %LOCALAPPDATA%\NeonSwarm. Account sign-in/cloud accounts remain part of the hosted Python service. The desktop app runs the core game offline, including music, local scores and local saves.

## Build

Install the .NET 10 SDK and Windows PowerShell 5.1 or PowerShell 7, then run:

~~~powershell
.\EXE_APP\scripts\build.ps1
~~~

Or double-click EXE_APP\scripts\build.bat. To build the portable folder only, use:

~~~powershell
.\EXE_APP\scripts\build.ps1 -SkipInstaller
~~~

The .NET SDK is installed on the build machine; global.json pins the SDK feature band. Build outputs are written to EXE_APP\dist. The installer build downloads the small Microsoft WebView2 Evergreen bootstrapper and uses WiX Toolset 6.

The game Settings screen also contains Import/Export Progress controls. The JSON backup uses the same save keys as the web edition, so it can move pilot progress between the browser and desktop editions.
