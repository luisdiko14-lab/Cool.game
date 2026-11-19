# Neon Swarm

Neon Swarm is a neon arcade survival shooter. Clear 60 fixed-position enemy formations while your ship automatically targets nearby threats. Enemies stay in formation and fire distinct projectile patterns. Bosses guard waves 5–10 and 30, followed by the wave-50 and wave-60 finales. All score awards are multiplied by 50.

You start with 200/200 HP. Enemy projectiles deal 10 damage. Health pickups restore you to full and add 25 to your maximum HP, up to 500/500; wave 5 spawns 20 health pickups, and wave 29 spawns 30. Boss health is 4,500 on wave 5, 25,000/50,000/75,000/100,000 on waves 6–9, 100,000 on wave 10, 1,000,000 on wave 30, 5,000,000 on wave 50, and 1,000,000,000 on wave 60. Boss hits on waves 30 and 50 are paced so volleys cannot instantly skip the fight; the wave-60 boss allows up to 10,000,000 damage per paced hit. Finale waves grant 10,000/10,000 HP and bosses deal 250 damage per projectile. Max-level shots deal up to 500 damage on other waves. Collect gems to level up your weapon, fire faster, and widen its volley. Wave clears award score and credits. Spend credits on persistent ship skins, or defeat the final boss to unlock the Nova skin. Other pickups grant a shield, a screen-clearing nova, or eight seconds of rapid fire.

## Play

## Download game files!

[Download](https://github.com/luisdiko14-lab/Cool.game/archive/refs/tags/finished-game.zip) Link if that doesn’t work: https://github.com/luisdiko14-lab/Cool.game/archive/refs/tags/finished-game.zip

### Open the standalone game

Open [`Neon Swarm.html`](Neon%20Swarm.html) in a modern browser. It needs no installation or build step. Personal high scores, settings, credits, selected ship skins, and arcade records are stored in that browser for that page's site address. Opening the HTML file and opening the Python server use separate browser storage. The **Other games!** hub contains Snake, 2048, and Memory Match. The Settings screen controls music and effects volume. The **Modes & features** panel includes daily and endless runs, boss rush, local co-op, weapon and loadout choices, daily missions, a flight recorder, and accessibility options. Its Records & achievements view tracks lifetime kills, gems, cleared waves, bosses, score, and completed runs, awarding credits when milestones unlock. It also includes an optional AI autopilot that steers around enemies and incoming shots while collecting nearby supplies, plus Time Attack (90-second score run), Bullet Hell (extra projectile volleys), Veteran Survival (endless waves starting at wave 10), and Hardcore (100,000 player HP, +10,000 damage on every wave, a 25,000-HP boss on every wave from 1–20, 25,000-HP enemies through wave 20, and a repeating 30-orb / 100-damage wave-60 barrage).  Combat also includes ten new features: a live tactical HUD, boss health bar, 12% critical-hit chance (2.5x damage), kill-streak score bonuses every five kills, near-miss score rewards, a dash pulse that clears nearby projectiles and damages nearby enemies, 8% hull repair after each cleared wave, a longer-range pickup magnet, a Nova screen burst on **E** or its on-screen button (25-second cooldown), and one emergency revive per run at 35% hull.  It now adds 15 more features: passive hull regeneration, delayed shield recharge, combo-earned shields, elite enemies every fourth wave, elite kill bonuses, elite/boss reward bonuses, a 50%-HP boss enrage phase, five-wave milestone score rewards, a gem jackpot every ten gems, level-up hull repair, dash cooldown reductions every ten kills, a nearby-threat radar, critical-hull warnings, projectile-storm warnings, and keyboard shortcuts (**P** to pause/resume, **A** to toggle autopilot).  The 25-system combat and progression pack adds an orbiting combat drone, deployable sentry turret, proximity mines, critical-hit chain lightning, periodic piercing volleys, kill-triggered lifesteal, shield reflection, stacking armor break, low-health execution damage, and a heat-managed weapon overdrive. Bosses can be staggered, telegraph aimed volleys, and unleash rotating nova patterns. Elite enemies gain Bulwark, Volatile, Commander, or Medic affixes. Every third wave can carry a score/health/fire-rate mutator; wave contracts reward optional objectives; rescue pods arrive during long runs; every seventh wave becomes a 12-crystal treasure wave; post-campaign endless play gains escalating projectile fractures; and five flawless clears award a victory streak bonus. Level-ups open a three-choice perk draft with Field, Rare, and Legendary rarities, perk-pair synergies, weapon mastery rewards every 25 kills, and a personal-best challenge bonus. The next feature pack adds five active tactical abilities: **Overdrive** (Q, temporary fire-rate and damage boost), **EMP** (R, clears hostile shots and damages enemies), **Guardian Shield** (F), **Field Repair** (C), and **Phase Blink** (X). **Tactical Scan** (T) marks the three nearest threats. New run systems include flawless-wave bonuses and streak credits, a 22-second rapid-clear bounty, supply beacons every four waves, elimination contracts, kill-chain score and shield rewards, periodic hull salvage, gem-chain bonuses and crystal contracts, boss bounty credits with ability refresh, a 20%-health boss final phase with radial volleys, close-range boss warnings, low-hull regeneration, and a score/credit stipend for every 30 seconds survived. An in-game ability dock displays cooldowns and wave stats; all five buttons also work on touch screens. These are client-side game mechanics and rewards, not server-verified competitive results. The bundled `Raya(Slowed).mp3` track starts after pressing Start. The Windows desktop edition also has a **Check for updates** demo: it displays a 1–100% progress window at 0.35-second intervals and restarts the app when complete. It is explicitly a simulation; it does not contact an update server or download/replace any files. Phones get an on-screen joystick and dash button. The Syne font is optional and loads from Google Fonts when online.

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
