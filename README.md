# Neon Swarm

Neon Swarm is a neon arcade survival shooter. Clear 30 fixed-position enemy formations while your ship automatically targets nearby threats. Enemies stay in formation and fire distinct projectile patterns. Bosses guard waves 5–10, and the wave-30 boss is the final fight.

You start with 200/200 HP. Enemy projectiles deal 10 damage. Health pickups restore you to full and add 25 to your maximum HP, up to 500/500; wave 5 spawns 20 health pickups, and wave 29 spawns 30. Boss health is 4,500 on wave 5, 25,000/50,000/75,000/100,000 on waves 6–9, 100,000 on wave 10, and 1,000,000 on wave 30. Each boss arrival grants a 10-second player shield. Wave 30 boosts the player to 10,000/10,000 HP and 10,000 damage per shot; the wave-30 boss deals 100 damage per projectile. Max-level shots deal up to 500 damage on other waves. Collect gems to level up your weapon, fire faster, and widen its volley. Wave clears award score and credits. Spend credits on persistent ship skins, or defeat the final boss to unlock the Nova skin. Other pickups grant a shield, a screen-clearing nova, or eight seconds of rapid fire.

## Play

### Open the standalone game

Open [`Neon Swarm.html`](Neon%20Swarm.html) in a modern browser. It needs no installation or build step. Personal high scores and uploaded player photos are stored in that browser. Photo upload accepts PNG, JPG/JPEG, and HEIC/HEIF; HEIC conversion may need an internet connection if the browser cannot decode it natively. The Syne font is optional and loads from Google Fonts when online.

### Run the server

Python 3.7 or newer is required. The server uses only the Python standard library.

```sh
python3 neon_swarm.py
```

This serves the game at `http://localhost:8000`, opens it in your browser, and enables a shared top-ten leaderboard saved to `neon_swarm_scores.json`. Stop the server with Ctrl+C. To choose a port or suppress browser launch, use `--port 9000` or `--no-browser`.

To play from a phone on the same Wi-Fi network, start with:

```sh
python3 neon_swarm.py --lan
```

The server prints the network address to open on your phone. Submitted scores are browser-reported and are not tamper-proof.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | WASD or arrow keys | Drag on the play area |
| Dash | Space or Shift | Quick tap or second finger while moving |
| Pause or resume | P or Escape | Pause button |
| Toggle sound | M | Not available |

## License

This project is available under the MIT License. See [`LICENSE`](LICENSE) for details.