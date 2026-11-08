# Neon Swarm

Neon Swarm is a neon arcade survival shooter. Clear 60 fixed-position enemy formations while your ship automatically targets nearby threats. Enemies stay in formation and fire distinct projectile patterns. Bosses guard waves 5–10 and 30, followed by the wave-50 and wave-60 finales. All score awards are multiplied by 50.

You start with 200/200 HP. Enemy projectiles deal 10 damage. Health pickups restore you to full and add 25 to your maximum HP, up to 500/500; wave 5 spawns 20 health pickups, and wave 29 spawns 30. Boss health is 4,500 on wave 5, 25,000/50,000/75,000/100,000 on waves 6–9, 100,000 on wave 10, 1,000,000 on wave 30, 5,000,000 on wave 50, and 1,000,000,000 on wave 60. Boss hits on waves 30 and 50 are paced so volleys cannot instantly skip the fight; the wave-60 boss allows up to 10,000,000 damage per paced hit. Finale waves grant 10,000/10,000 HP and bosses deal 250 damage per projectile. Max-level shots deal up to 500 damage on other waves. Collect gems to level up your weapon, fire faster, and widen its volley. Wave clears award score and credits. Spend credits on persistent ship skins, or defeat the final boss to unlock the Nova skin. Other pickups grant a shield, a screen-clearing nova, or eight seconds of rapid fire.

## Play

## Download game files!

[Download](https://github.com/luisdiko14-lab/Cool.game/archive/refs/tags/finished-game.zip) Link if that doesn’t work: https://github.com/luisdiko14-lab/Cool.game/archive/refs/tags/finished-game.zip

### Open the standalone game

Open [`Neon Swarm.html`](Neon%20Swarm.html) in a modern browser. It needs no installation or build step. Personal high scores, settings, credits, selected ship skins, and arcade records are stored in that browser for that page's site address. Opening the HTML file and opening the Python server use separate browser storage. The **Other games!** hub contains Snake, 2048, and Memory Match. The Settings screen controls music and effects volume. The bundled `Raya(Slowed).mp3` track starts after pressing Start. Phones get an on-screen joystick and dash button. The Syne font is optional and loads from Google Fonts when online.

### Music attribution and rights

`Raya(Slowed).mp3` is credited to producer Zericxxn as a Brazilian Funk / Dark Phonk track (attribution supplied by the project maintainer). Its file metadata does not identify the creator, source, or license, so verify the source and permission terms before distributing the game. This third-party track is not covered by the project's MIT License, and attribution by itself does not grant permission to use copyrighted music. The prior `MATADORA (Sped Up).mp3` track is attributed to DJ Asul in its embedded metadata.

Open **Admin commands** from the menu or pause screen and enter `12345678` to unlock the local controls. You can grant a shield for up to 100 seconds, set fire rate up to 50 shots per second, and set damage up to 10,000,000 per shot. These client-side overrides are available to anyone and do not provide secure server administration; submitted scores remain untrusted.

### Run the server

Python 3.7 or newer is required. Install the encrypted-storage dependency first:

```sh
python3 -m pip install -r requirements.txt
python3 neon_swarm.py
```

This serves the game at `http://localhost:8000`, opens it in your browser, and enables a shared top-ten leaderboard saved to `neon_swarm_scores.json`. The server binds to exactly the requested port; if 8000 is occupied, it exits with an error instead of silently changing the URL. Stop the other process or intentionally choose a different port with `--port 9000`. Suppress browser launch with `--no-browser`.

To play from a phone on the same Wi-Fi network, start with:

```sh
python3 neon_swarm.py --lan
```

The server prints the network address to open on your phone. Submitted scores are browser-reported and are not tamper-proof.

### Neon Swarm account

Create an account with a username, email, and 12-128 character password, then authorize **Username**, **Email**, and **Game Data** before syncing. Email ownership is not verified. Passwords are PBKDF2-hashed; account and save databases are encrypted at rest. The game stores no Discord OAuth credentials, and the old Discord settings in `.env` are unused.

Local runs automatically create an encryption key in the user's private Neon Swarm data directory. For the hosted GitHub Actions workflow, create a Fernet key with `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` and add it as the repository Actions secret `NEON_SWARM_DATA_KEY`. The workflow keeps encrypted accounts and saves in its private runtime cache; they are not committed to the repository or included in snapshot artifacts. Keep this key stable or previously encrypted accounts and saves cannot be read. Login sessions are in memory, so users sign in again after a workflow leg restarts the server. The downloadable executable generates a local key and never contains a hosted secret.

### Windows executable

The **Game Exe Maker** workflow builds and smoke-tests the game, then commits the small `Build_and_use_game.exe` bootstrap to the repository root. Download that file directly from the repository. Its Windows GUI shows whether Python and Git are already installed and lets you select per-user installs. Click **Build Game** to clone this repository (or download its source archive if Git is unavailable), install the build dependencies, build the game, and create `NeonSwarm-Windows.zip` on your Desktop. The ZIP contains `NeonSwarm.exe`; scores and saves are also written to the Desktop.

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
