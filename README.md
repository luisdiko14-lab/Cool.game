# Neon Swarm

Neon Swarm is a neon arcade survival shooter. Clear 60 fixed-position enemy formations while your ship automatically targets nearby threats. Enemies stay in formation and fire distinct projectile patterns. Bosses guard waves 5–10 and 30, followed by the wave-50 and wave-60 finales. All score awards are multiplied by 50.

You start with 200/200 HP. Enemy projectiles deal 10 damage. Health pickups restore you to full and add 25 to your maximum HP, up to 500/500; wave 5 spawns 20 health pickups, and wave 29 spawns 30. Boss health is 4,500 on wave 5, 25,000/50,000/75,000/100,000 on waves 6–9, 100,000 on wave 10, 1,000,000 on wave 30, 5,000,000 on wave 50, and 1,000,000,000 on wave 60. Boss hits on waves 30 and 50 are paced so volleys cannot instantly skip the fight; the wave-60 boss allows up to 10,000,000 damage per paced hit. Finale waves grant 10,000/10,000 HP and bosses deal 250 damage per projectile. Max-level shots deal up to 500 damage on other waves. Collect gems to level up your weapon, fire faster, and widen its volley. Wave clears award score and credits. Spend credits on persistent ship skins, or defeat the final boss to unlock the Nova skin. Other pickups grant a shield, a screen-clearing nova, or eight seconds of rapid fire.

## Play

## Download game files!

[Download](https://github.com/luisdiko14-lab/Cool.game/archive/refs/tags/finished-game.zip) Link if that doesn’t work: https://github.com/luisdiko14-lab/Cool.game/archive/refs/tags/finished-game.zip

### Open the standalone game

Open [`Neon Swarm.html`](Neon%20Swarm.html) in a modern browser. It needs no installation or build step. Personal high scores, settings, credits, selected ship skins, and arcade records are stored in that browser for that page's site address. Opening the HTML file and opening the Python server use separate browser storage. The **Other games!** hub contains Snake, 2048, and Memory Match. The Settings screen controls music and effects volume. The bundled `MATADORA (Sped Up).mp3` track starts after pressing Start. Phones get an on-screen joystick and dash button. The Syne font is optional and loads from Google Fonts when online.

Open **Admin commands** from the menu or pause screen and enter `12345678` to unlock the local controls. You can grant a shield for up to 100 seconds, set fire rate up to 50 shots per second, and set damage up to 10,000,000 per shot. These client-side overrides are available to anyone and do not provide secure server administration; submitted scores remain untrusted.

### Run the server

Python 3.7 or newer is required. The server uses only the Python standard library.

```sh
python3 neon_swarm.py
```

This serves the game at `http://localhost:8000`, opens it in your browser, and enables a shared top-ten leaderboard saved to `neon_swarm_scores.json`. At game over, save a name to submit your local score to the shared leaderboard. Stop the server with Ctrl+C. To choose a port or suppress browser launch, use `--port 9000` or `--no-browser`.

To play from a phone on the same Wi-Fi network, start with:

```sh
python3 neon_swarm.py --lan
```

The server prints the network address to open on your phone. Submitted scores are browser-reported and are not tamper-proof.

### Windows executable

The **Game Exe Maker** workflow builds and smoke-tests the game, then commits the small `Build_and_use_game.exe` bootstrap to the repository root. Download that file directly from the repository. When run on Windows, it installs Git and Python for your user only if missing, clones this repository, installs the build dependencies, builds the game, and creates `NeonSwarm-Windows.zip` on your Desktop. The ZIP contains `NeonSwarm.exe`; scores and saves are also written to the Desktop.

The executable is unsigned. A **Verified publisher** in Windows requires a trusted Authenticode code-signing certificate issued to you or your organization; GitHub cannot create or grant publisher verification. The executable bundles Qt WebEngine and extracts its runtime when launched; Microsoft Defender may still flag an unsigned application. Leaderboard and save data are stored on your Desktop.

To sign a downloaded executable, install `osslsigncode`, set `WINDOWS_CODESIGN_CERT` to the path of your trusted `.pfx` file, then run `scripts/sign-windows-exe.sh NeonSwarm.exe`. The script signs and verifies the executable in place; it prompts for the PFX password unless `WINDOWS_CODESIGN_CERT_PASSWORD` is set. You can pass an output path as a second argument to save a separate signed copy. A self-signed certificate does not establish a verified publisher.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | WASD or arrow keys | On-screen joystick or drag |
| Dash | Space or Shift | Dash button or quick tap |
| Pause or resume | P or Escape | Pause button |
| Toggle sound | M | Not available |


## License

This project is available under the MIT License. See [`LICENSE`](LICENSE) for details.


## Credits to [claude.ai](https://claude.ai) for the README.md information!
