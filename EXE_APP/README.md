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


## Resolution picker and background companions

Opening Neon_Swarm.exe directly now opens Neon_Swarm_Pick.exe first. The picker offers 144P, 244P, 345P, 480P, 720P (recommended), 1080P, 2K (1440P) and 2160P (4K). These are internal game-render targets; they do not alter Windows display settings. Lower presets disable decorative VFX and animation effects while preserving core gameplay movement.

The picker displays a boot-console sequence and starts Neon_Swarm.exe with the selected render options. The crash-recovery helper preserves that render profile when it retries the game.

The Windows package includes:

- Neon_Swarm_Update_Checker_Background.exe and its DLL — periodically checks the latest desktop release while the game is running, downloads the official Setup.exe, and asks before launching it.
- Neon_Swarm_Webview2_Background.exe and its DLL — tray monitor for the WebView2 Runtime. The actual WebView2 rendering engine remains hosted by the game.
- Admin_Panel.exe and its DLL — native GUI connected to the live game through a current-user-only named pipe. Closing the panel hides it in the notification area; the tray menu can reopen or exit it.
- Neon_Swarm_Pick.exe and its DLL — startup resolution and render-profile picker.

Admin commands are local gameplay overrides, not secure server administration. The password remains the one already defined by the existing game's Admin module.

## Python-hosted desktop runtime and multiplayer

The desktop host does not load a prebuilt static HTML file as its runtime anymore. It starts `neon_web_python.exe --server --lan --no-browser` on a free port, checks `/api/health`, and then navigates WebView2 to the local Python HTTP server. The Python server binds to the local network for room hosting; Windows Firewall may ask for permission.

In the Round 2 Command Center, open **Servers** to fetch the live room directory, host a room, or join another room. On the host PC, share the LAN address shown in the server address field. Players on the same Wi-Fi can connect using that address and port. Internet players need a publicly reachable host (or router port forwarding); a local desktop server is not automatically exposed to the internet.

Room membership, presence and pilot positions are synchronized by the Python backend. The current build does not synchronize authoritative enemy waves, shots or shared damage between players, so each connected pilot still runs their own combat simulation. Marketplace sessions, listings and current live-event totals are stored in the running server process and reset when that process restarts.
