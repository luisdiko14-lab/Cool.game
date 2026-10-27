#!/usr/bin/env python3
"""Neon Swarm game server.

Run:  python neon_swarm.py            (opens http://localhost:8000)
      python neon_swarm.py --lan      (also reachable from phones on your Wi-Fi)

Standard library only (Python 3.7+). The game page is embedded below, and the
server adds a shared leaderboard saved next to this file in neon_swarm_scores.json.
Scores are reported by the browser, so treat the leaderboard as friendly, not tamper-proof.
"""
import argparse
import hashlib
import json
import re
import socket
import sys
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.parse import unquote, urlsplit
from urllib.request import urlopen

if getattr(sys, "frozen", False):
  APP_DIR = Path.home() / "Desktop" if sys.platform == "win32" else Path(sys.executable).resolve().parent
  APP_DIR.mkdir(parents=True, exist_ok=True)
else:
  APP_DIR = Path(__file__).resolve().parent
DB = APP_DIR / "neon_swarm_scores.json"
SAVES_DB = APP_DIR / "neon_swarm_saves.json"
SAVE_KEYS = {"neonswarm.scores", "neonswarm.profile", "neonswarm.settings", "neonswarm.admin", "neonswarm.arcade"}
LOCK = threading.Lock()
LAST_POST = {}  # client ip -> time of last score submission (simple rate limit)
LAST_SAVE_POST = {}

# ---------------------------------------------------------------- the game ---
GAME_HTML = r'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Neon Swarm</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Syne:wght@600;800&display=swap">
<style>
:root{--bg:#0d0524;--ink:#f4eaff;--dim:#a592d6;--pink:#ff3d9a;--cyan:#3df5ff;--gold:#ffc23d;--vio:#9b5cff;color-scheme:dark;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
html{height:100%;scroll-padding-top:env(safe-area-inset-top,0px)}
body{margin:0;height:100%;position:relative;overflow:hidden;background:var(--bg);color:var(--ink);font:600 16px/1.5 "Syne","Trebuchet MS",system-ui,sans-serif;-webkit-user-select:none;user-select:none;touch-action:none}
canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.panel{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:16px;text-align:center;background:rgba(13,5,36,.74);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);overflow:auto}
.panel.on{display:flex}
h1,h2{margin:0;font-weight:800;color:#fff;line-height:1}
h1{font-size:clamp(44px,12vw,104px);text-shadow:0 0 10px var(--pink),0 0 34px var(--pink),0 0 76px var(--vio)}
h2{font-size:clamp(30px,7vw,54px);text-shadow:0 0 10px var(--cyan),0 0 34px var(--cyan)}
p{margin:0;max-width:36ch;color:var(--dim)}
#sc{font-size:20px;font-weight:800;color:var(--gold)}
button{font:800 18px "Syne","Trebuchet MS",system-ui,sans-serif;color:var(--ink);background:rgba(61,245,255,.08);border:2px solid var(--cyan);border-radius:999px;padding:12px 36px;cursor:pointer;box-shadow:0 0 14px rgba(61,245,255,.45),inset 0 0 14px rgba(61,245,255,.2);transition:transform .12s,box-shadow .12s}
button:hover,button:focus-visible{transform:scale(1.06);box-shadow:0 0 30px var(--cyan),inset 0 0 18px rgba(61,245,255,.35);outline:none}
button.alt,#pb{border-color:var(--vio);box-shadow:0 0 12px rgba(155,92,255,.5);padding:8px 24px;font-size:15px}
#pb{position:absolute;top:10px;right:96px;display:none;padding:6px 16px}
.board{margin:0;padding:0;list-style:none;counter-reset:r;width:min(260px,80vw)}
.board:empty{display:none}
.board li{counter-increment:r;display:flex;justify-content:space-between;padding:4px 14px;border-bottom:1px solid rgba(155,92,255,.3);color:var(--dim)}
.board li::before{content:counter(r)}
.board li.me{color:var(--gold)}
.board span{flex:1;text-align:left;padding-left:12px}
[hidden]{display:none!important}
#sv{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
input{font:600 16px "Syne","Trebuchet MS",system-ui,sans-serif;color:var(--ink);background:rgba(13,5,36,.8);border:2px solid var(--vio);border-radius:999px;padding:8px 16px;text-align:center;width:min(220px,60vw);outline:none;-webkit-user-select:text;user-select:text}
input:focus{border-color:var(--cyan)}
#profile{color:var(--gold);font-size:14px}
#skins{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:center;min-height:42px;max-width:min(360px,90vw)}
.skin{width:36px;height:36px;min-width:36px;padding:0;border:2px solid rgba(255,255,255,.45);border-radius:50%;background:var(--swatch);box-shadow:none}
.skin.selected{border-color:#fff;outline:2px solid var(--swatch);outline-offset:3px}
.skin:disabled{opacity:.35;filter:grayscale(1);cursor:not-allowed}
.setting-row{display:grid;grid-template-columns:minmax(110px,1fr) minmax(120px,1.2fr);align-items:center;gap:14px;width:min(340px,88vw);color:var(--ink);text-align:left}
.setting-row input[type=range]{width:100%;accent-color:var(--cyan)}
.setting-row input[type=checkbox]{width:22px;height:22px;justify-self:end;accent-color:var(--cyan)}
.setting-row select{width:100%;min-width:0;padding:8px 10px;border:2px solid var(--vio);border-radius:8px;background:#160a35;color:var(--ink);font:600 14px "Syne","Trebuchet MS",system-ui,sans-serif}
#fps-counter{position:absolute;z-index:7;top:12px;right:14px;padding:5px 9px;border:1px solid rgba(61,245,255,.6);border-radius:8px;background:rgba(7,2,26,.72);color:var(--cyan);font:800 13px/1.2 monospace;pointer-events:none}
#fps-counter[hidden]{display:none}
.shop-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;width:min(680px,94vw);max-height:46vh;overflow:auto;padding:4px}
.shop-item{display:flex;min-width:0;min-height:118px;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:10px 6px;border:1px solid rgba(61,245,255,.45);border-radius:12px;background:rgba(17,8,43,.92);box-shadow:none;font-size:13px}
.shop-item:hover,.shop-item:focus-visible{transform:translateY(-2px);box-shadow:0 0 18px rgba(61,245,255,.25)}
.shop-item:disabled{opacity:.6;cursor:default}
.shop-item small{color:var(--dim);font-size:11px}
.shop-icon{width:32px;height:32px;display:block;clip-path:polygon(50% 0,68% 36%,100% 82%,50% 66%,0 82%,32% 36%);filter:drop-shadow(0 0 6px currentColor)}
.shop-item.equipped{border-color:var(--gold);box-shadow:inset 0 0 12px rgba(255,194,61,.2)}
#racer.panel{padding:0;gap:0;background:#050713;backdrop-filter:none;overflow:hidden}
#racer-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.racer-top{position:absolute;z-index:2;inset:14px 110px auto 16px;display:flex;justify-content:space-between;align-items:start;pointer-events:none;text-shadow:0 2px 8px #000}
.racer-top h2{font-size:clamp(22px,5vw,38px);text-align:left;text-shadow:0 0 14px #22ddff}
.racer-top p{color:#fff;text-align:right}
.racer-controls{position:absolute;z-index:3;inset:auto 18px 18px;display:flex;justify-content:space-between;align-items:end;pointer-events:none}
.racer-controls button{width:74px;height:68px;padding:0;border-radius:18px;pointer-events:auto;background:rgba(5,12,28,.65)}
.racer-actions{position:absolute;z-index:3;top:78px;left:14px;display:flex;gap:8px}
.racer-actions button{padding:7px 15px;font-size:13px}
.racer-message{position:absolute;z-index:2;left:50%;top:45%;transform:translate(-50%,-50%);width:min(80vw,500px);color:#fff;text-shadow:0 2px 8px #000;pointer-events:none}
body.low-pixels canvas{image-rendering:pixelated}
#admin-damage{width:100%;min-width:0}
.arcade-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;width:min(560px,94vw)}
.arcade-game{min-height:88px;padding:12px 8px;border-radius:8px;font-size:16px}
.arcade-game small{display:block;color:var(--dim);font-size:12px}
.arcade-board{width:min(82vw,380px);aspect-ratio:1;display:grid;gap:4px;padding:6px;border:2px solid rgba(61,245,255,.5);border-radius:8px;background:rgba(13,5,36,.82)}
.snake-board{grid-template-columns:repeat(16,minmax(0,1fr));grid-template-rows:repeat(16,minmax(0,1fr))}
.snake-cell{border-radius:2px;background:rgba(165,146,214,.08)}
.snake-cell.body{background:var(--cyan);box-shadow:0 0 8px var(--cyan)}
.snake-cell.head{background:var(--gold);box-shadow:0 0 10px var(--gold)}
.snake-cell.food{background:var(--pink);border-radius:50%;box-shadow:0 0 10px var(--pink)}
.tile-board{grid-template-columns:repeat(4,minmax(0,1fr));grid-template-rows:repeat(4,minmax(0,1fr));background:rgba(13,5,36,.92)}
.tile{min-width:0;padding:0;border:1px solid rgba(255,255,255,.08);border-radius:5px;background:var(--tile-color,#261346);box-shadow:none;font-size:clamp(18px,5vw,34px);font-weight:800}
.tile:hover,.tile:focus-visible{transform:none;box-shadow:inset 0 0 14px rgba(255,255,255,.18)}
.memory-board{grid-template-columns:repeat(4,minmax(0,1fr));grid-template-rows:repeat(4,minmax(0,1fr))}
.memory-card{min-width:0;padding:0;border-radius:6px;font-size:clamp(18px,5vw,30px)}
.direction-pad{display:grid;grid-template-columns:repeat(3,54px);grid-template-rows:repeat(2,44px);gap:6px;justify-content:center}
.direction-pad button{padding:0;border-radius:6px;font-size:13px}
.direction-pad button:first-child{grid-column:2}
.direction-pad button:nth-child(2){grid-column:1;grid-row:2}
.direction-pad button:nth-child(3){grid-column:2;grid-row:2}
.direction-pad button:nth-child(4){grid-column:3;grid-row:2}
.arcade-actions{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
#touch-controls{display:none}
@media (pointer:coarse),(max-width:720px){
  .panel{gap:10px;padding:14px}
  h1{font-size:clamp(42px,14vw,68px)}
  p{font-size:14px;max-width:32ch}
  .shop-grid{grid-template-columns:repeat(2,minmax(0,1fr));max-height:42vh}
  #menu #play,#menu #settings-open{min-height:48px}
  body.playing #touch-controls{position:absolute;z-index:5;inset:auto 18px 22px;display:flex;justify-content:space-between;align-items:end;pointer-events:none}
  #move-pad{position:relative;width:124px;height:124px;border:2px solid rgba(61,245,255,.48);border-radius:50%;background:rgba(13,5,36,.52);box-shadow:inset 0 0 24px rgba(61,245,255,.16);touch-action:none;pointer-events:auto}
  #move-pad span{position:absolute;inset:8px 0 auto;text-align:center;color:var(--dim);font-size:10px;pointer-events:none}
  #move-knob{position:absolute;left:50%;top:50%;width:48px;height:48px;margin:-24px;border:2px solid var(--cyan);border-radius:50%;background:rgba(61,245,255,.25);pointer-events:none}
  #touch-dash{width:76px;height:76px;padding:0;border-radius:50%;pointer-events:auto;touch-action:none}
}
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="fps-counter" hidden aria-live="off">-- FPS</div>
<button id="pb" aria-label="Pause">Pause</button>
<div id="touch-controls" role="group" aria-label="Touch controls"><div id="move-pad" aria-label="Movement joystick"><span>MOVE</span><div id="move-knob"></div></div><button id="touch-dash" class="alt" type="button">Dash</button></div>
<audio id="bg-music" src="MATADORA%20(Sped%20Up).mp3" loop preload="none"></audio>
<section class="panel on" id="menu">
<h1>Neon<br>Swarm</h1>
<p>Survive 60 fixed formations. Bosses guard key waves, and wave 60 is the final fight. Collect health, tune audio, and use the mobile controls when playing on a phone.</p>
<p>Move with WASD, arrow keys or by dragging. Dash with Space, Shift or a quick tap. P pauses and M mutes.</p>
<p id="profile"></p><p id="save-status" role="status" aria-live="polite">Progress saves in this browser for this site address.</p><div id="skins" aria-label="Ship skins"></div>
<ol class="board" id="b0"></ol>
<button class="alt" id="shop-open-menu" type="button">Shop</button>
<button class="alt" id="settings-open" type="button">Settings</button>
<button class="alt" id="games-open-menu" type="button">Other games!</button>
<button class="alt" id="admin-open-menu" type="button">Admin commands</button>
<button id="play">Start run</button>
</section>
<section class="panel" id="pause"><h2>Paused</h2><button id="resume">Resume</button><button class="alt" id="shop-open-pause" type="button">Shop</button><button class="alt" id="settings-pause" type="button">Settings</button><button class="alt" id="games-open-pause" type="button">Other games!</button><button class="alt" id="admin-open-pause" type="button">Admin commands</button><button class="alt" id="quit">Quit to menu</button></section>
<section class="panel" id="settings"><h2>Settings</h2><label class="setting-row"><span>Music</span><input id="music-enabled" type="checkbox"></label><label class="setting-row"><span>Music volume</span><input id="music-volume" type="range" min="0" max="100" value="35"></label><label class="setting-row"><span>Effects volume</span><input id="effects-volume" type="range" min="0" max="100" value="65"></label><label class="setting-row"><span>Frame cap <output id="fps-cap-value">60</output> FPS</span><input id="fps-cap" type="range" min="20" max="1000" step="10" value="60"></label><label class="setting-row"><span>FPS counter</span><input id="fps-visible" type="checkbox"></label><label class="setting-row"><span>Resolution quality</span><select id="resolution"><option value="240">240p - Low (no FX/music)</option><option value="340">340p - Low (no FX/music)</option><option value="480">480p</option><option value="720">720p</option><option value="1080">1080p</option><option value="1440">1440p (2K HD)</option><option value="2160">2160p (4K Ultra HD)</option><option value="4320">4320p (8K Ultra HD+)</option></select></label><p>FPS is limited by your display/browser. Resolution changes in-game rendering quality, not your monitor, and may be capped by device memory.</p><button class="alt" id="settings-close" type="button">Done</button></section>
<section class="panel" id="shop"><h2>Hangar shop</h2><p id="shop-balance"></p><p>Earn credits by clearing waves. Buy a ship, then equip it here or from the quick-select row.</p><div class="shop-grid" id="shop-grid"></div><button class="alt" id="shop-close" type="button">Back</button></section>
<section class="panel" id="admin-lock"><h2>Admin Access</h2><label class="setting-row"><span>Password</span><input id="admin-password" type="password" inputmode="numeric" autocomplete="off" maxlength="16"></label><p id="admin-lock-status" role="status" aria-live="polite"></p><button id="admin-unlock" type="button">Unlock</button><button class="alt" id="admin-lock-close" type="button">Back</button></section>
<section class="panel" id="admin"><h2>Admin Commands</h2><p>Local gameplay overrides. These controls are not secure server administration.</p><label class="setting-row"><span>Shield duration (seconds)</span><input id="admin-shield-duration" type="number" min="1" max="100" step="1" value="10"></label><button id="admin-grant-shield" type="button">Grant shield</button><label class="setting-row"><span>Fire rate <output id="admin-fire-rate-value">10</output> shots/sec</span><input id="admin-fire-rate" type="range" min="1" max="50" step="1" value="10"></label><label class="setting-row"><span>Damage per shot <output id="admin-damage-value">500</output></span><input id="admin-damage" type="number" min="1" max="10000000" step="1" value="500"></label><label class="setting-row"><span>XP multi (max 10,000x)</span><input id="admin-xp-multiplier" type="number" min="1" max="10000" step="1" value="1"></label><p id="admin-status" role="status" aria-live="polite"></p><button class="alt" id="admin-close" type="button">Done</button></section>
<section class="panel" id="admin"><h2>Admin Commands</h2><p>Local gameplay overrides. These controls are not secure server administration.</p><label class="setting-row"><span>Shield duration (seconds)</span><input id="admin-shield-duration" type="number" min="1" max="100" step="1" value="10"></label><button id="admin-grant-shield" type="button">Grant shield</button><label class="setting-row"><span>Fire rate <output id="admin-fire-rate-value">10</output> shots/sec</span><input id="admin-fire-rate" type="range" min="1" max="50" step="1" value="10"></label><label class="setting-row"><span>Damage per shot <output id="admin-damage-value">500</output></span><input id="admin-damage" type="number" min="1" max="10000000" step="1" value="500"></label><p id="admin-status" role="status" aria-live="polite"></p><button class="alt" id="admin-close" type="button">Done</button></section>
<section class="panel" id="games"><h2>Other games!</h2><p id="arcade-records">Best scores save in this browser.</p><div class="arcade-grid"><button class="arcade-game" data-launch-game="snake">Snake<small>Eat, grow, don't collide</small></button><button class="arcade-game" data-launch-game="tile">2048<small>Join tiles to reach 2048</small></button><button class="arcade-game" data-launch-game="memory">Memory<small>Match all eight pairs</small></button><button class="arcade-game" data-launch-game="racer">Neon Racer 3D<small>Dodge traffic on a neon highway</small></button></div><button class="alt" id="games-back" type="button">Back</button></section>
<section class="panel" id="snake"><h2>Snake</h2><p id="snake-status" role="status" aria-live="polite"></p><div id="snake-board" class="arcade-board snake-board" aria-label="Snake game board"></div><div class="direction-pad"><button data-snake-dir="up">UP</button><button data-snake-dir="left">LEFT</button><button data-snake-dir="down">DOWN</button><button data-snake-dir="right">RIGHT</button></div><div class="arcade-actions"><button class="alt" id="snake-restart" type="button">Restart</button><button class="alt" data-games-back type="button">Other games</button></div></section>
<section class="panel" id="game2048"><h2>2048</h2><p id="tile-status" role="status" aria-live="polite"></p><div id="tile-board" class="arcade-board tile-board" aria-label="2048 board"></div><div class="direction-pad"><button data-tile-dir="up">UP</button><button data-tile-dir="left">LEFT</button><button data-tile-dir="down">DOWN</button><button data-tile-dir="right">RIGHT</button></div><div class="arcade-actions"><button class="alt" id="tile-restart" type="button">New game</button><button class="alt" data-games-back type="button">Other games</button></div></section>
<section class="panel" id="memory"><h2>Memory Match</h2><p id="memory-status" role="status" aria-live="polite"></p><div id="memory-board" class="arcade-board memory-board" aria-label="Memory match board"></div><div class="arcade-actions"><button class="alt" id="memory-restart" type="button">Restart</button><button class="alt" data-games-back type="button">Other games</button></div></section>
<section class="panel" id="racer"><canvas id="racer-canvas" aria-label="Neon Racer 3D game"></canvas><div class="racer-top"><h2>NEON RACER</h2><p id="racer-hud">0 km/h<br>Distance 0 m</p></div><div class="racer-message" id="racer-message">Use ← → or A / D to change lanes. Avoid traffic!</div><div class="racer-actions"><button class="alt" id="racer-restart" type="button">Restart</button><button class="alt" id="racer-back" type="button">Other games</button></div><div class="racer-controls"><button type="button" data-racer-dir="-1" aria-label="Steer left">◀</button><button type="button" data-racer-dir="1" aria-label="Steer right">▶</button></div></section>
<section class="panel" id="over"><h2 id="ovt">Signal lost</h2><div id="sc"></div><ol class="board" id="b1"></ol><div id="sv" hidden><input id="nm" maxlength="12" placeholder="Your name" autocomplete="off"><button class="alt" id="sub">Save score</button></div><p id="submit-status" role="status" aria-live="polite"></p><button id="again">Play again</button><button class="alt" id="home">Menu</button></section>
<script>
'use strict';
/* ================= CONFIG & HELPERS ================= */
const VIEW=560,TAU=Math.PI*2,FONT='"Syne","Trebuchet MS",system-ui,sans-serif'; // VIEW = logical units on the short screen side
const COL={cyan:'#3df5ff',pink:'#ff3d9a',gold:'#ffc23d',vio:'#9b5cff',mint:'#6dffb0'};
const MAX_WAVE=60;
const BOSS_HP={5:4500,6:25000,7:50000,8:75000,9:100000,10:100000,30:1000000,50:5000000,60:1000000000};
const SKINS=[
  {id:'cyan',name:'Neon Scout',color:COL.cyan,cost:0,shape:'classic',trail:'circle'},
  {id:'gold',name:'Solar Spear',color:COL.gold,cost:250,shape:'dart',trail:'diamond'},
  {id:'mint',name:'Manta Wing',color:COL.mint,cost:650,shape:'wing',trail:'circle'},
  {id:'pink',name:'Pulse Diamond',color:COL.pink,cost:1100,shape:'diamond',trail:'star'},
  {id:'nova',name:'Nova Crescent',color:'#ff3df5',cost:0,winOnly:true,shape:'crescent',trail:'star'},
  {id:'ruby',name:'Ruby Interceptor',color:'#ff465f',cost:1400,shape:'swept',trail:'square'},
  {id:'glacier',name:'Glacier Orbiter',color:'#8be9ff',cost:1800,shape:'orb',trail:'diamond'},
  {id:'comet',name:'Comet Longwing',color:'#ff9f43',cost:2200,shape:'longwing',trail:'star'},
  {id:'phantom',name:'Phantom Stealth',color:'#b49aff',cost:2800,shape:'stealth',trail:'square'},
  {id:'arcade',name:'Arcade Pixel',color:'#8dff58',cost:3400,shape:'pixel',trail:'square'},
  {id:'titan',name:'Titan Heavy',color:'#d6b4ff',cost:4200,shape:'heavy',trail:'diamond'},
  {id:'viper',name:'Viper Fang',color:'#ffe45e',cost:5000,shape:'fang',trail:'star'},
  {id:'prism',name:'Prism Shifter',color:'#56ffd0',cost:6200,shape:'prism',trail:'circle'},
  {id:'eclipse',name:'Eclipse Carrier',color:'#ff78d1',cost:7600,shape:'carrier',trail:'star'}
];
const TYPES={drone:{hp:1,r:9,spd:95,pts:10,col:COL.pink,n:4,gems:1},shooter:{hp:5,r:12,spd:78,pts:45,col:COL.gold,n:3,gems:2},tank:{hp:9,r:19,spd:42,pts:70,col:COL.vio,n:8,gems:4},lancer:{hp:2,r:10,spd:70,pts:25,col:'#ff7a1a',n:3,gems:2},spinner:{hp:7,r:15,spd:55,pts:60,col:'#5b8cff',n:6,gems:3},bomber:{hp:2,r:11,spd:120,pts:30,col:'#ff4d4d',n:5,gems:2},boss:{hp:1000000,r:52,spd:0,pts:50000,col:'#ff3df5',n:10,gems:80}};
const PAT=[[0],[-.07,.07],[-.17,0,.17],[-.22,-.08,.08,.22],[-.32,-.16,0,.16,.32]]; // shot spread per weapon level
const $=id=>document.getElementById(id),rnd=(a,b)=>a+Math.random()*(b-a),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const cv=$('c'),ctx=cv.getContext('2d');
let view={cw:1,ch:1,dpr:1,s:1,w:VIEW,h:VIEW},bg;

const SavedData={keys:['neonswarm.scores','neonswarm.profile','neonswarm.settings','neonswarm.admin','neonswarm.arcade'],id:null,timer:null,
  async init(){try{this.id=localStorage.getItem('neonswarm.save-id');if(!/^[a-f0-9]{32}$/.test(this.id||'')){this.id=crypto.randomUUID().replace(/-/g,'');localStorage.setItem('neonswarm.save-id',this.id)}}catch(e){return}
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),4000);
    try{const response=await fetch('/api/saves',{headers:{'X-Save-Token':this.id},signal:controller.signal});if(!response.ok)return;const result=await response.json();for(const key of this.keys)if(localStorage.getItem(key)===null&&result.data&&result.data[key]!==undefined)localStorage.setItem(key,JSON.stringify(result.data[key]))}catch(e){}finally{clearTimeout(timeout)}},
  schedule(){if(!this.id)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.push(),1500)},
  async push(){const data={};for(const key of this.keys){try{const value=localStorage.getItem(key);if(value!==null)data[key]=JSON.parse(value)}catch(e){}}
    try{const response=await fetch('/api/saves',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:this.id,data})});if(response.ok)$('save-status').textContent='Progress saved in this browser; repository backup is queued for this workflow leg.';else $('save-status').textContent='Progress is saved in this browser; server backup failed.'}catch(e){$('save-status').textContent='Progress is saved in this browser; server backup is unavailable.'}},
};

/* ================= STORAGE (top 5 scores) ================= */
const Store={key:'neonswarm.scores',
  load(){try{const a=JSON.parse(localStorage.getItem(this.key));return Array.isArray(a)?a.map(v=>typeof v==='number'?{n:'Player',s:v}:v).filter(v=>v&&Number.isSafeInteger(v.s)&&v.s>=0).sort((a,b)=>b.s-a.s).slice(0,5):[]}catch(e){return[]}},
  save(a){try{localStorage.setItem(this.key,JSON.stringify(a));SavedData.schedule();return true}catch(e){return false}},
  submit(name,score){const a=this.load().filter(v=>!(v.n==='Player'&&v.s===score));a.push({n:name,s:score});a.sort((x,y)=>y.s-x.s);return this.save(a.slice(0,5))?this.load():null}};
const Profile={key:'neonswarm.profile',data:null,
  init(){let saved={};try{saved=JSON.parse(localStorage.getItem(this.key))||{}}catch(e){}
    this.data={credits:Number.isFinite(saved.credits)?Math.max(0,saved.credits):0,unlocked:Array.isArray(saved.unlocked)?saved.unlocked.filter(id=>SKINS.some(s=>s.id===id)):['cyan'],skin:SKINS.some(s=>s.id===saved.skin)?saved.skin:'cyan'};
    if(!this.data.unlocked.includes('cyan'))this.data.unlocked.push('cyan');this.save();this.render()},
  save(){try{localStorage.setItem(this.key,JSON.stringify(this.data));$('save-status').textContent='Progress saves in this browser for this site address.';SavedData.schedule();return true}catch(e){$('save-status').textContent='Browser storage is unavailable; progress may not persist.';return false}},
  item(){return SKINS.find(s=>s.id===this.data.skin)||SKINS[0]},
  color(){return this.item().color},
  render(){const host=$('skins');if(!host)return;host.replaceChildren();
    for(const skin of SKINS){const owned=this.data.unlocked.includes(skin.id),button=document.createElement('button');button.type='button';button.className='skin'+(this.data.skin===skin.id?' selected':'');button.style.setProperty('--swatch',skin.color);button.disabled=!owned&&(skin.winOnly||this.data.credits<skin.cost);button.title=owned?skin.name:skin.winOnly?'Win the campaign to unlock':skin.name+' costs '+skin.cost+' credits';button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(this.data.skin===skin.id));
      button.onclick=()=>{if(!this.buy(skin.id))return;this.data.skin=skin.id;this.save();this.render()};host.append(button)}
    $('profile').textContent='Credits '+this.data.credits+' | '+this.item().name+' equipped ship';
    const grid=$('shop-grid');if(grid){grid.replaceChildren();$('shop-balance').textContent='Credits: '+this.data.credits;
      for(const skin of SKINS){const owned=this.data.unlocked.includes(skin.id),button=document.createElement('button');button.type='button';button.className='shop-item'+(this.data.skin===skin.id?' equipped':'');button.disabled=!owned&&(skin.winOnly||this.data.credits<skin.cost);
        const icon=document.createElement('span');icon.className='shop-icon';icon.style.background=skin.color;icon.style.color=skin.color;button.append(icon);
        const name=document.createElement('strong');name.textContent=skin.name;button.append(name);
        const desc=document.createElement('small');desc.textContent=owned?(this.data.skin===skin.id?'Equipped · '+skin.shape+' hull':'Owned · '+skin.shape+' hull'):skin.winOnly?'Unlock by winning the campaign':skin.cost.toLocaleString()+' credits · '+skin.shape+' hull';button.append(desc);
        button.onclick=()=>{if(!this.buy(skin.id))return;this.data.skin=skin.id;this.save();this.render()};grid.append(button)}}
  },
  buy(id){const skin=SKINS.find(s=>s.id===id);if(!skin)return false;
    if(!this.data.unlocked.includes(id)){if(skin.winOnly||this.data.credits<skin.cost)return false;this.data.credits-=skin.cost;this.data.unlocked.push(id)}
    return true},
  reward(wave){this.data.credits+=wave*150;this.save();this.render()},
  victory(){if(!this.data.unlocked.includes('nova'))this.data.unlocked.push('nova');this.data.credits+=750;this.save();this.render()}};
const Shop={returnTo:'menu',
  open(from){this.returnTo=from;Profile.render();Game.set('shop')},
  close(){Game.set(this.returnTo)}};
function board(el,list,mine){el.innerHTML=list.map(v=>{const o=typeof v==='object'?v:{n:'',s:v};return'<li'+(o.s===mine?' class="me"':'')+'><span>'+String(o.n).replace(/[^\w -]/g,'')+'</span><b>'+o.s.toLocaleString()+'</b></li>'}).join('')}

/* ================= AUDIO (Web Audio synth, no assets) ================= */
const Sfx={ctx:null,gain:null,muted:false,volume:.65,
  init(){if(this.ctx){if(this.ctx.state==='suspended')this.ctx.resume();return}
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    try{const c=this.ctx=new AC();this.out=c.createDynamicsCompressor();this.gain=c.createGain();this.gain.gain.value=this.volume;this.out.connect(this.gain);this.gain.connect(c.destination);
      const n=c.sampleRate>>1,b=c.createBuffer(1,n,c.sampleRate),d=b.getChannelData(0);for(let i=0;i<n;i++)d[i]=Math.random()*2-1;this.nb=b}catch(e){this.ctx=null}},
  setVolume(value){this.volume=clamp(value,0,1);if(this.gain)this.gain.gain.value=this.volume},
  tone(f0,f1,dur,type,vol,delay){const c=this.ctx;if(!c||this.muted)return;
    const t=c.currentTime+(delay||0),o=c.createOscillator(),g=c.createGain();
    o.type=type;o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur);
    g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
    o.connect(g);g.connect(this.out);o.start(t);o.stop(t+dur+.02)},
  noise(dur,vol,freq){const c=this.ctx;if(!c||this.muted)return;
    const t=c.currentTime,s=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();
    s.buffer=this.nb;f.type='lowpass';f.frequency.setValueAtTime(freq,t);f.frequency.exponentialRampToValueAtTime(80,t+dur);
    g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
    s.connect(f);f.connect(g);g.connect(this.out);s.start(t);s.stop(t+dur)},
  play(n,k){const T=(...a)=>this.tone(...a),m=Math.min(k||0,30);
    ({shoot:()=>T(rnd(620,760),220,.07,'square',.03),
      hit:()=>T(240,90,.06,'square',.05),
      boom:()=>{this.noise(.4,.3,1400);T(140,30,.35,'sawtooth',.2)},
      gem:()=>T(520+m*26,1040+m*40,.09,'triangle',.09),
      dash:()=>{this.noise(.18,.12,5000);T(260,900,.14,'sawtooth',.05)},
      hurt:()=>{this.noise(.45,.35,2500);T(330,50,.45,'sawtooth',.2)},
      up:()=>[523,659,784,1047].forEach((f,i)=>T(f,f,.16,'triangle',.12,i*.07)),
      win:()=>[523,659,784,1047,1319,1568].forEach((f,i)=>T(f,f,.22,'square',.07,i*.09)),
      lose:()=>[440,370,311,220,110].forEach((f,i)=>T(f,f*.9,.3,'sawtooth',.1,i*.14)),
      start:()=>[330,440,660].forEach((f,i)=>T(f,f*1.5,.14,'square',.07,i*.06))})[n]()}};

const RESOLUTIONS=[240,340,480,720,1080,1440,2160,4320];
const Settings={key:'neonswarm.settings',data:{music:true,musicVolume:.35,effectsVolume:.65,fps:60,showFps:true,resolution:1080},audio:null,returnTo:'menu',
  init(){let saved={};try{saved=JSON.parse(localStorage.getItem(this.key))||{}}catch(e){}
    const resolution=RESOLUTIONS.includes(Number(saved.resolution))?Number(saved.resolution):1080;
    this.data={music:saved.music!==false,musicVolume:clamp(Number(saved.musicVolume??.35),0,1),effectsVolume:clamp(Number(saved.effectsVolume??.65),0,1),fps:clamp(Math.round((Number(saved.fps)||60)/10)*10,20,1000),showFps:saved.showFps!==false,resolution};
    this.audio=$('bg-music');$('music-enabled').checked=this.data.music;$('music-volume').value=Math.round(this.data.musicVolume*100);$('effects-volume').value=Math.round(this.data.effectsVolume*100);$('fps-cap').value=this.data.fps;$('fps-cap-value').textContent=this.data.fps;$('fps-visible').checked=this.data.showFps;$('resolution').value=String(resolution);this.apply();resize()},
  save(){try{localStorage.setItem(this.key,JSON.stringify(this.data));SavedData.schedule()}catch(e){}},
  lowPixels(){return this.data.resolution<=340},
  animationsEnabled(){return !this.lowPixels()&&!reduce},
  apply(){this.audio.volume=this.data.musicVolume;this.audio.muted=!this.data.music||this.lowPixels();Sfx.setVolume(this.data.effectsVolume);$('fps-counter').hidden=!this.data.showFps;document.body.classList.toggle('low-pixels',this.lowPixels())},
  startMusic(){if(!this.data.music||this.data.musicVolume<=0||this.lowPixels())return;this.audio.play().catch(()=>{})},
  setMusic(enabled){this.data.music=enabled;this.save();this.apply();if(enabled)this.startMusic();else this.audio.pause()},
  setMusicVolume(value){this.data.musicVolume=clamp(value,0,1);this.save();this.apply()},
  setEffectsVolume(value){this.data.effectsVolume=clamp(value,0,1);this.save();this.apply()},
  setFps(value){this.data.fps=clamp(Math.round((Number(value)-20)/10)*10+20,20,1000);$('fps-cap').value=this.data.fps;$('fps-cap-value').textContent=this.data.fps;this.save()},
  setShowFps(value){this.data.showFps=Boolean(value);this.save();this.apply()},
  setResolution(value){const resolution=Number(value);if(!RESOLUTIONS.includes(resolution))return;this.data.resolution=resolution;this.save();this.apply();resize();if(resolution<=340)this.audio.pause();else if(this.data.music)this.startMusic()},
  open(from){this.returnTo=from;Game.set('settings')},
  close(){Game.set(this.returnTo)}};
const Admin={password:'12345678',key:'neonswarm.admin',config:{fireRate:10,damage:500,shieldDuration:10,xpMultiplier:1},unlocked:false,pendingShield:0,returnTo:'menu',
  init(){let saved={};try{saved=JSON.parse(localStorage.getItem(this.key))||{}}catch(e){}
    this.config={fireRate:clamp(Number(saved.fireRate)||10,1,50),damage:clamp(Number(saved.damage)||500,1,10000000),shieldDuration:clamp(Number(saved.shieldDuration)||10,1,100),xpMultiplier:clamp(Math.round(Number(saved.xpMultiplier)||1),1,10000)};this.render()},
  save(){try{localStorage.setItem(this.key,JSON.stringify(this.config));SavedData.schedule()}catch(e){}},
  render(){$('admin-fire-rate').value=this.config.fireRate;$('admin-fire-rate-value').textContent=this.config.fireRate;$('admin-damage').value=this.config.damage;$('admin-damage-value').textContent=this.config.damage;$('admin-shield-duration').value=this.config.shieldDuration;$('admin-xp-multiplier').value=this.config.xpMultiplier},
  open(from){this.returnTo=from;$('admin-lock-status').textContent='';$('admin-password').value='';Game.set(this.unlocked?'admin':'admin-lock')},
  unlock(){if($('admin-password').value!==this.password){$('admin-lock-status').textContent='Incorrect password.';return}this.unlocked=true;if(Game.p)Game.refreshMultiplier();$('admin-lock-status').textContent='Admin commands unlocked for this session.';this.render();Game.set('admin')},
  close(){Game.set(this.returnTo)},
  setFireRate(value){this.config.fireRate=clamp(Math.round(Number(value)||1),1,50);this.save();this.render()},
  setDamage(value){this.config.damage=clamp(Math.round(Number(value)||1),1,10000000);this.save();this.render()},
  setXpMultiplier(value){this.config.xpMultiplier=clamp(Math.round(Number(value)||1),1,10000);this.save();this.render();if(Game.p)Game.refreshMultiplier()},
  setShieldDuration(value){this.config.shieldDuration=clamp(Math.round(Number(value)||1),1,100);this.save();this.render()},
  grantShield(){const duration=clamp(Number($('admin-shield-duration').value)||this.config.shieldDuration,1,100);this.setShieldDuration(duration);if(Game.p)Game.p.shield=Math.max(Game.p.shield,duration);else this.pendingShield=duration;$('admin-status').textContent=Game.p?'Shield granted for '+duration+' seconds.':'Shield queued for the next run ('+duration+' seconds).'}};

/* ================= FX: particles, rings, floating text, shake ================= */
const FX={parts:[],texts:[],rings:[],shake:0,flash:0,
  burst(x,y,col,n,spd,life,size,shape='circle'){if(!Settings.animationsEnabled()||this.parts.length>700)return;for(let i=0;i<n;i++){const a=rnd(0,TAU),s=rnd(.2,1)*spd;this.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:life*rnd(.5,1),max:life,size:size*rnd(.6,1.4),col,shape})}},
  text(x,y,s,col,size){if(Settings.animationsEnabled())this.texts.push({x,y,s,col,size,life:.9,max:.9})},
  ring(x,y,max,col){if(Settings.animationsEnabled())this.rings.push({x,y,r:4,max,col,life:.5,max_t:.5})},
  hit(m){this.shake=Math.max(this.shake,reduce?m*.4:m)},
  update(dt){if(!Settings.animationsEnabled()){this.parts=[];this.texts=[];this.rings=[];this.shake=0;this.flash=0;return}const f=Math.pow(.02,dt);
    for(const p of this.parts){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=f;p.vy*=f}
    for(const t of this.texts){t.life-=dt;t.y-=45*dt}
    for(const r of this.rings){r.life-=dt;r.r+=(r.max-r.r)*Math.min(1,dt*7)}
    this.parts=this.parts.filter(p=>p.life>0);this.texts=this.texts.filter(t=>t.life>0);this.rings=this.rings.filter(r=>r.life>0);
    this.shake=Math.max(0,this.shake-dt*40);this.flash=Math.max(0,this.flash-dt*2.2)},
  draw(c,S){if(!Settings.animationsEnabled())return;c.shadowBlur=0;c.globalCompositeOperation='lighter'; // additive blending = glow
    for(const p of this.parts){const a=p.life/p.max,r=p.size*(.4+a*.6);c.globalAlpha=a;c.fillStyle=p.col;c.beginPath();
      if(p.shape==='square')c.rect(p.x-r,p.y-r,r*2,r*2);
      else if(p.shape==='diamond')poly(c,p.x,p.y,r,4,Math.PI/4);
      else if(p.shape==='star')poly(c,p.x,p.y,r,8,Math.PI/8);
      else c.arc(p.x,p.y,r,0,TAU);c.fill()}
    c.lineWidth=3;for(const r of this.rings){c.globalAlpha=r.life/r.max_t;c.strokeStyle=r.col;c.beginPath();c.arc(r.x,r.y,r.r,0,TAU);c.stroke()}
    c.globalCompositeOperation='source-over';c.textAlign='center';
    for(const t of this.texts){const a=t.life/t.max;c.globalAlpha=Math.min(1,a*2);c.font='800 '+t.size*(1+Math.max(0,a-.75)*2)+'px '+FONT;c.fillStyle=t.col;c.shadowColor=t.col;c.shadowBlur=8*S;c.fillText(t.s,t.x,t.y)}
    c.globalAlpha=1;c.shadowBlur=0}};

/* ================= INPUT: keyboard, mouse, touch (unified pointer stick) ================= */
const Input={keys:{},ptr:null,dash:false,
  vec(){const k=this.keys,x=(k.KeyD||k.ArrowRight?1:0)-(k.KeyA||k.ArrowLeft?1:0),y=(k.KeyS||k.ArrowDown?1:0)-(k.KeyW||k.ArrowUp?1:0);
    if(x||y){const m=Math.hypot(x,y);return{x:x/m,y:y/m}}
    const q=this.ptr;if(q){let dx=q.x-q.x0,dy=q.y-q.y0,m=Math.hypot(dx,dy);
      if(m>60){q.x0=q.x-dx/m*60;q.y0=q.y-dy/m*60;dx=q.x-q.x0;dy=q.y-q.y0;m=60} // floating stick follows the finger
      if(m>8){const f=Math.min(1,m/45)/m;return{x:dx*f,y:dy*f}}}
    return{x:0,y:0}},
  bind(){
    addEventListener('keydown',e=>{const k=e.code;if(Game.state==='racer'){if(k==='Escape'){MiniGames.showHub();return}if(k.startsWith('Arrow'))e.preventDefault();Racer.key(k,true);return}if(['snake','game2048','memory'].includes(Game.state)){if(k.startsWith('Arrow'))e.preventDefault();MiniGames.key(k);return}if(e.target.tagName==='INPUT'){if(k==='Enter'){if(e.target.id==='admin-password')Admin.unlock();else if(e.target.id==='nm')$('sub').click()}return}if(k.startsWith('Arrow')||k==='Space')e.preventDefault();this.keys[k]=true;Sfx.init();
      if(k==='Space'||k.startsWith('Shift'))this.dash=true;
      if(k==='KeyP'||k==='Escape')Game.state==='play'?Game.pause():Game.resume();
      if(k==='Enter'&&(Game.state==='menu'||Game.state==='over'))Game.start();
      if(k==='KeyM')Sfx.muted=!Sfx.muted});
    addEventListener('keyup',e=>{this.keys[e.code]=false;if(Game.state==='racer')Racer.key(e.code,false)});
    addEventListener('blur',()=>{this.keys={};Game.pause()});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)Game.pause()});
    const rel=e=>{const r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
    cv.addEventListener('pointerdown',e=>{Sfx.init();if(Game.state!=='play')return;if(this.ptr){this.dash=true;return} // second finger = dash
      try{cv.setPointerCapture(e.pointerId)}catch(_){}
      const q=rel(e);this.ptr={id:e.pointerId,x0:q.x,y0:q.y,sx:q.x,sy:q.y,x:q.x,y:q.y,t:performance.now()}});
    cv.addEventListener('pointermove',e=>{const q=this.ptr;if(q&&q.id===e.pointerId){const r=rel(e);q.x=r.x;q.y=r.y}});
    const up=e=>{const q=this.ptr;if(!q||q.id!==e.pointerId)return;
      if(e.type==='pointerup'&&performance.now()-q.t<220&&Math.hypot(q.x-q.sx,q.y-q.sy)<14)this.dash=true; // quick tap = dash
      this.ptr=null};
    cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
    const pad=$('move-pad'),knob=$('move-knob'),padPoint=e=>{const r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
    pad.addEventListener('pointerdown',e=>{e.preventDefault();Sfx.init();const q=padPoint(e),r=pad.getBoundingClientRect(),c=cv.getBoundingClientRect();this.ptr={id:e.pointerId,x0:r.left+r.width/2-c.left,y0:r.top+r.height/2-c.top,sx:q.x,sy:q.y,x:q.x,y:q.y,t:performance.now()};pad.setPointerCapture(e.pointerId)});
    pad.addEventListener('pointermove',e=>{const q=this.ptr;if(!q||q.id!==e.pointerId)return;const r=pad.getBoundingClientRect(),dx=clamp(e.clientX-(r.left+r.width/2),-42,42),dy=clamp(e.clientY-(r.top+r.height/2),-42,42);q.x=q.x0+dx;q.y=q.y0+dy;knob.style.transform='translate('+dx+'px,'+dy+'px)'});
    const padUp=e=>{if(this.ptr&&this.ptr.id===e.pointerId){this.ptr=null;knob.style.transform='translate(0,0)'}};
    pad.addEventListener('pointerup',padUp);pad.addEventListener('pointercancel',padUp);
    $('touch-dash').addEventListener('pointerdown',e=>{e.preventDefault();Sfx.init();this.dash=true})}};

/* ================= GAME STATE & RULES ================= */
const Game={state:'menu',time:0,best:0,p:null,
  reset(){Object.assign(this,{score:0,combo:0,comboT:0,mult:1,wave:1,betweenWaves:false,waveDelay:0,xp:0,totalXp:0,need:8,lvl:1,timeScale:1,dieT:0,hitT:0,enemies:[],bullets:[],eb:[],gems:[],pu:[],won:false});this.refreshMultiplier();
    this.p={x:view.w/2,y:view.h*.82,vx:0,vy:0,r:11,hp:200,maxHp:200,fireT:.12,dashT:0,dashCd:0,inv:1,aim:-1.57,face:-1.57,dx:0,dy:-1,dead:false,shield:0,rapid:0};
    FX.parts=[];FX.texts=[];FX.rings=[];FX.shake=0;FX.flash=0},
  set(s){this.state=s;for(const id of['menu','pause','over','settings','shop','admin-lock','admin','games','snake','game2048','memory','racer'])$(id).classList.toggle('on',id===s);$('pb').style.display=s==='play'?'block':'none';document.body.classList.toggle('playing',s==='play');
    if(document.activeElement&&document.activeElement.blur)document.activeElement.blur()},
  start(){Sfx.init();Settings.startMusic();Input.dash=false;Input.ptr=null;this.reset();if(Admin.pendingShield){this.p.shield=Admin.pendingShield;Admin.pendingShield=0}this.spawnWave();Sfx.play('start');FX.text(view.w/2,view.h*.3,'Wave 1 / '+MAX_WAVE,COL.cyan,34);this.set('play')},
  pause(){if(this.state==='play'){Input.ptr=null;this.set('pause')}},
  resume(){if(this.state==='pause'){Input.dash=false;this.set('play')}},
  goMenu(){this.p=null;board($('b0'),Store.load(),-1);Net.get().then(s=>s&&board($('b0'),s,-1));this.set('menu')},
  over(){const list=Store.load(),hi=this.score>0&&this.score>(list[0]?.s||0);
    const localSaved=this.score>0?Store.submit('Player',this.score):false;this.best=Store.load()[0]?.s||0;
    $('ovt').textContent=this.won?'Campaign complete!':hi?'New best score!':'Signal lost';$('sc').textContent='Score '+this.score.toLocaleString()+', reached wave '+this.wave+' / '+MAX_WAVE;
    board($('b1'),Store.load(),this.score);Sfx.play(hi?'win':'lose');$('sv').hidden=this.score<=0;$('submit-status').textContent=this.score>0?(localSaved?(Net.on?'Saved on this device. Add your name to the shared leaderboard.':'Saved on this device. The shared leaderboard is unavailable.'):'Browser storage is unavailable; try saving to the shared leaderboard.') :'';$('sub').disabled=false;try{$('nm').value=localStorage.getItem('neonswarm.name')||$('nm').value}catch(e){}this.set('over')},
  tick(raw){ // raw = real delta time in seconds (clamped); gameplay uses scaled dt
    if(this.state==='menu'){this.time+=raw;if(Math.random()<.3)FX.burst(rnd(0,view.w),rnd(0,view.h),[COL.cyan,COL.pink,COL.vio][Math.floor(rnd(0,3))],5,50,1.4,2.2);FX.update(raw);return}
    if(this.state==='over'){FX.update(raw);return}
    if(this.state!=='play'&&this.state!=='dying')return;
    let dt=raw;
    if(this.state==='dying'){this.timeScale+=(.25-this.timeScale)*Math.min(1,raw*6);dt=raw*this.timeScale;this.dieT+=raw;if(this.dieT>1.4){this.over();return}} // slow-mo death
    this.update(dt);FX.update(dt)},
  onScreen(e){return e.x>0&&e.x<view.w&&e.y>0&&e.y<view.h},
  update(dt){const p=this.p,W=view.w,H=view.h,dying=this.state==='dying';
    this.time+=dt;
    if(!dying){
      if(this.betweenWaves&&(this.waveDelay-=dt)<=0){if(this.wave>=MAX_WAVE){this.victory();return}this.wave++;this.betweenWaves=false;this.spawnWave();FX.text(W/2,H*.3,'Wave '+this.wave+' / '+MAX_WAVE,COL.cyan,34);Sfx.play('up')}
      this.control(dt)}
    if(this.comboT>0&&(this.comboT-=dt)<=0){this.combo=0;this.refreshMultiplier()}
    for(const e of this.enemies){const dx=p.x-e.x,dy=p.y-e.y,a=Math.atan2(dy,dx);e.flash-=dt;e.ang+=dt*(e.k==='tank'?1:3);if(dying||!this.onScreen(e))continue;
      if(e.k==='boss'){const bossDamage=this.wave>=50?250:this.wave>=30?100:10;e.t+=dt;e.sa+=dt*.9;if((e.fireT-=dt)<=0){e.fireT=.2;for(let i=0;i<3;i++){const shot=e.sa+i*TAU/3;this.eb.push({x:e.x,y:e.y,vx:Math.cos(shot)*205,vy:Math.sin(shot)*205,life:6,damage:bossDamage})}}if(e.t>2.6){e.t=0;for(let i=-4;i<=4;i++){const shot=a+i*.13;this.eb.push({x:e.x,y:e.y,vx:Math.cos(shot)*265,vy:Math.sin(shot)*265,life:6,damage:bossDamage})}}}
      else if(e.k==='lancer'){
        if(e.st===1){if((e.windup-=dt)<=0){e.st=0;e.fireT=1.7;const shot=Math.atan2(p.y-e.y,p.x-e.x);this.eb.push({x:e.x,y:e.y,vx:Math.cos(shot)*390,vy:Math.sin(shot)*390,life:6})}}
        else if((e.fireT-=dt)<=0){const shot=Math.atan2(p.y-e.y,p.x-e.x);e.cx=Math.cos(shot);e.cy=Math.sin(shot);e.st=1;e.windup=.7}
      }
      else if((e.fireT-=dt)<=0){let shots=1,spread=0,speed=190,interval=2.4;
        if(e.k==='shooter'){shots=this.wave>=4?5:this.wave>=2?3:1;spread=.18;speed=260;interval=Math.max(.75,1.65-this.wave*.12)}
        else if(e.k==='spinner'){shots=5;spread=TAU/5;speed=175;interval=1.45;e.sa+=.37}
        else if(e.k==='bomber'){shots=8;spread=TAU/8;speed=145;interval=2.1}
        else if(e.k==='tank'){shots=2;spread=.1;speed=200;interval=2.5}
        else{speed=170;interval=2.3}
        e.fireT=interval;
        for(let i=0;i<shots;i++){const shot=e.k==='spinner'?e.sa+i*spread:a+(i-(shots-1)/2)*spread;this.eb.push({x:e.x,y:e.y,vx:Math.cos(shot)*speed,vy:Math.sin(shot)*speed,life:6})}}
    }
    for(const arr of[this.bullets,this.eb])for(const b of arr){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(b.x<-30||b.x>W+30||b.y<-30||b.y>H+30)b.life=0}
    for(const g of this.gems){const dx=p.x-g.x,dy=p.y-g.y,d=Math.hypot(dx,dy)||1;g.a+=dt*4;
      if(!p.dead&&d<120){const v=140+520*(1-d/120);g.x+=dx/d*v*dt;g.y+=dy/d*v*dt}
      else{const f=Math.pow(.1,dt);g.vx*=f;g.vy*=f;g.x+=g.vx*dt;g.y+=g.vy*dt}
      if(!p.dead&&d<p.r+9){g.dead=true;this.gem(g)}}
    for(const u of this.pu){const dx=p.x-u.x,dy=p.y-u.y,d=Math.hypot(dx,dy)||1;u.t-=dt;u.a+=dt*2;
      if(!p.dead&&d<150){u.x+=dx/d*200*dt;u.y+=dy/d*200*dt}
      if(!p.dead&&d<p.r+14){u.t=0;this.power(u)}}
    for(const b of this.bullets)for(const e of this.enemies){if(e.dead||b.life<=0)continue;const r=e.r+4;
      if((b.x-e.x)**2+(b.y-e.y)**2<r*r){b.life=0;this.damage(e,Admin.unlocked?Admin.config.damage:this.wave>=30?10000:Math.min(500,20*this.lvl*this.lvl));FX.burst(b.x,b.y,TYPES[e.k].col,3,150,.25,2)}}
    if(!p.dead){
      for(const e of this.enemies){if(e.dead)continue;const r=p.r+e.r-2;
        if((p.x-e.x)**2+(p.y-e.y)**2<r*r){
          if(p.dashT>0){if(e.k!=='boss')this.damage(e,3)} // dashing rams enemies
          else if(p.inv<=0){if(e.k!=='boss')this.kill(e);this.hurt()}}}
      for(const b of this.eb){const r=p.r*.5+4;if(p.inv<=0&&p.dashT<=0&&(p.x-b.x)**2+(p.y-b.y)**2<r*r){b.life=0;this.hurt(b.damage||10)}}}
    this.enemies=this.enemies.filter(e=>!e.dead);this.bullets=this.bullets.filter(b=>b.life>0);this.eb=this.eb.filter(b=>b.life>0);this.gems=this.gems.filter(g=>!g.dead);this.pu=this.pu.filter(u=>u.t>0);
    if(!dying&&!this.enemies.length&&!this.betweenWaves)this.clearWave()},
  control(dt){const p=this.p,s=Input.vec();
    p.rapid=Math.max(0,p.rapid-dt);
    p.shield=Math.max(0,p.shield-dt);
    p.inv-=dt;p.dashCd-=dt;if(Math.hypot(s.x,s.y)>.1)p.face=Math.atan2(s.y,s.x);
    if(Input.dash){Input.dash=false;if(p.dashCd<=0){p.dashT=.17;p.dashCd=1.1;p.inv=Math.max(p.inv,.3);p.dx=Math.cos(p.face);p.dy=Math.sin(p.face);Sfx.play('dash');FX.burst(p.x,p.y,COL.cyan,14,260,.4,3)}}
    if(p.dashT>0){p.dashT-=dt;p.vx=p.dx*880;p.vy=p.dy*880}
    else{const k=Math.min(1,dt*12);p.vx+=(s.x*265-p.vx)*k;p.vy+=(s.y*265-p.vy)*k} // smooth acceleration
    p.x=clamp(p.x+p.vx*dt,p.r,view.w-p.r);p.y=clamp(p.y+p.vy*dt,p.r,view.h-p.r);
    if(Math.hypot(p.vx,p.vy)>40){const skin=Profile.item();FX.burst(p.x-Math.cos(p.face)*10,p.y-Math.sin(p.face)*10,skin.color,2,30,.3,2.4,skin.trail)}
    let near=null,nd=1e9;for(const e of this.enemies){const d=(e.x-p.x)**2+(e.y-p.y)**2;if(d<nd&&this.onScreen(e)){nd=d;near=e}}
    p.aim=near?Math.atan2(near.y-p.y,near.x-p.x):p.face;
    const fireInterval=Admin.unlocked?1/clamp(Admin.config.fireRate,1,50):Math.max(.045,.18-this.lvl*.022-(p.rapid>0?.07:0));
    if(near){p.fireT-=dt;if(p.fireT<=0)while(p.fireT<=0){p.fireT+=fireInterval;Sfx.play('shoot');
      for(const o of PAT[this.lvl-1])this.bullets.push({x:p.x,y:p.y,vx:Math.cos(p.aim+o)*650,vy:Math.sin(p.aim+o)*650,life:1.1})}}
    else p.fireT=fireInterval},
  add(k,x,y,hp){const T=TYPES[k],health=hp||T.hp;this.enemies.push({k,x,y,hp:health,mhp:health,r:T.r,fireT:rnd(.4,1.5),t:0,sa:rnd(0,TAU),flash:0,ang:rnd(0,TAU)})},
  spawnWave(){const W=view.w,cols=Math.min(5,Math.max(3,Math.floor((W-80)/100)));
    const formations=[[],['drone','drone','drone','drone','drone'],['drone','shooter','drone','shooter','drone','drone'],['drone','shooter','spinner','shooter','lancer','drone','bomber','drone'],['shooter','tank','bomber','spinner','shooter','bomber','lancer','shooter','tank'],[],['shooter','spinner','tank','bomber','lancer','shooter','spinner','tank','bomber','drone','lancer','shooter'],['tank','shooter','spinner','bomber','lancer','tank','shooter','spinner','bomber','lancer','tank','shooter','bomber','spinner'],['spinner','tank','bomber','shooter','lancer','spinner','tank','bomber','shooter','lancer','spinner','tank','bomber','shooter','lancer','tank'],['tank','spinner','bomber','shooter','lancer','tank','spinner','bomber','shooter','lancer','tank','spinner','bomber','shooter','lancer','tank','spinner','bomber']];
    const healthDrops=this.wave===5?20:this.wave===29?30:0;
    for(let i=0;i<healthDrops;i++){const row=Math.floor(i/6);this.pu.push({x:W*(.1+(i%6)*.16),y:view.h*(.57+row*.065),k:'life',t:45,a:0})}
    const bossHealth=BOSS_HP[this.wave];if(bossHealth){const final=this.wave===MAX_WAVE;this.add('boss',W/2,view.h*.22,bossHealth);if(final||this.wave===30||this.wave===50){this.enemies[this.enemies.length-1].r=88;this.p.maxHp=10000;this.p.hp=10000}this.p.shield=10;FX.text(W/2,view.h*.31,'BOSS SHIELD 10s',COL.cyan,24);
      const guards=final||this.wave===50?['shooter','spinner','tank','bomber','shooter','spinner','tank','bomber']:this.wave>=6&&this.wave<=9?['shooter','spinner','tank','bomber','shooter','spinner']:['shooter','spinner','shooter','spinner'];guards.forEach((k,i)=>this.add(k,W/2+(i-(guards.length-1)/2)*Math.min(105,(W-90)/Math.max(1,guards.length-1)),view.h*.43));
      FX.text(W/2,view.h*.38,final?'FINAL BOSS':'WAVE '+this.wave+' BOSS',COL.pink,30);return}
    const enemyKinds=['drone','shooter','spinner','tank','bomber','lancer'];
    const kinds=this.wave>=11?Array.from({length:Math.min(30,this.wave+5)},(_,i)=>enemyKinds[(i*3+this.wave)%enemyKinds.length]):formations[this.wave];
    const rows=Math.ceil(kinds.length/cols),rowGap=Math.min(88,(view.h-140)/Math.max(1,rows-1)),startY=Math.max(48,(view.h-rowGap*(rows-1))*.22);
    kinds.forEach((k,i)=>{const row=Math.floor(i/cols),rowKinds=Math.min(cols,kinds.length-row*cols),col=i%cols,gap=Math.min(110,(W-100)/Math.max(1,rowKinds-1));this.add(k,W/2+(col-(rowKinds-1)/2)*gap,startY+row*rowGap)})},
  refreshMultiplier(){const xpBonus=Math.floor(this.totalXp/10)*(Admin.unlocked?Admin.config.xpMultiplier:1);this.mult=Math.min(10000,1+xpBonus+Math.floor(this.combo/5))},
  awardScore(points){const earned=points*50;this.score+=earned;return earned},
  clearWave(){this.betweenWaves=true;this.waveDelay=2;const reward=this.wave*150;this.awardScore(this.wave*250*this.mult);Profile.reward(this.wave);FX.text(view.w/2,view.h*.32,'WAVE CLEAR  +'+reward+' CREDITS',COL.gold,25)},
  victory(){this.won=true;this.awardScore(2500*this.mult);Profile.victory();this.over()},
  damage(e,n){if(e.k==='boss'&&(this.wave===30||this.wave===50||this.wave===MAX_WAVE)){if(this.time<(e.nextHitAt||0))return;e.nextHitAt=this.time+.15}e.hp-=n;e.flash=.08;if(this.time-this.hitT>.05){this.hitT=this.time;Sfx.play('hit')}if(e.hp<=0&&!e.dead)this.kill(e)},
  kill(e){e.dead=true;const T=TYPES[e.k],old=this.mult;
    this.combo++;this.comboT=2.6;this.refreshMultiplier();
    const pts=this.awardScore(T.pts*this.mult);
    FX.burst(e.x,e.y,T.col,T.n*5,300,.7,3.2);FX.burst(e.x,e.y,'#fff',6,200,.35,2);FX.hit(e.k==='tank'?9:4);Sfx.play('boom');
    FX.text(e.x,e.y-12,'+'+pts,T.col,e.k==='tank'?24:16);
    if(this.mult>old)FX.text(this.p.x,this.p.y-32,'Combo x'+this.mult,COL.pink,20);
    if(e.k==='tank'){FX.ring(e.x,e.y,90,T.col);for(let i=0;i<3;i++)this.add('drone',e.x+rnd(-14,14),e.y+rnd(-14,14))} // tanks split into drones
    for(let i=0;i<T.gems;i++)this.gems.push({x:e.x,y:e.y,vx:rnd(-130,130),vy:rnd(-130,130),a:rnd(0,TAU)});
    if(e.k==='bomber')for(let i=0;i<8;i++){const a=i*TAU/8;this.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*170,vy:Math.sin(a)*170,life:5})} // bombers burst into a bullet ring
    if(e.k==='boss'){this.eb.length=0;FX.flash=.6;FX.hit(22);FX.ring(e.x,e.y,Math.max(view.w,view.h),T.col);Sfx.play('win')}
    if(e.k==='boss'||Math.random()<.07)this.pu.push({x:e.x,y:e.y,k:e.k==='boss'?'life':['shield','bomb','life','rapid'][Math.floor(rnd(0,4))],t:12,a:0})},
  gem(g){this.totalXp++;this.xp++;this.refreshMultiplier();this.awardScore(5*this.mult);Sfx.play('gem',this.combo);FX.burst(g.x,g.y,COL.mint,4,120,.3,2);
    if(this.xp>=this.need){this.xp=0;this.need+=4;this.levelUp()}},
  levelUp(){const p=this.p;
    if(this.lvl<5){this.lvl++;FX.text(p.x,p.y-30,'Weapon up!',COL.gold,22)}else{const bonus=this.awardScore(200*this.mult);FX.text(p.x,p.y-30,'+'+bonus,COL.gold,22)}
    this.blast(2,COL.gold);Sfx.play('up');
    
    },
  blast(n,col){FX.ring(this.p.x,this.p.y,Math.max(view.w,view.h)*.7,col);FX.hit(8); // shockwave: damage first so bomber rings get wiped too
    for(const e of this.enemies)if(!e.dead)this.damage(e,n);
    for(const b of this.eb)FX.burst(b.x,b.y,COL.pink,2,80,.3,2);this.eb.length=0},
  power(u){const p=this.p,m={shield:['Shield',COL.cyan],bomb:['Nova bomb',COL.gold],life:['Health +25',COL.pink],rapid:['Rapid fire',COL.mint]}[u.k];
    if(u.k==='shield')p.shield=Math.max(p.shield,8);else if(u.k==='bomb')this.blast(8,COL.gold);else if(u.k==='rapid')p.rapid=Math.max(p.rapid,8);else{p.maxHp=Math.min(this.wave>=30?10000:500,p.maxHp+25);p.hp=p.maxHp}
    FX.text(p.x,p.y-34,m[0],m[1],20);FX.burst(p.x,p.y,m[1],18,260,.5,3);Sfx.play('up')},
  hurt(amount=5){const p=this.p;if(p.shield>0){p.inv=.25;FX.ring(p.x,p.y,110,COL.cyan);FX.burst(p.x,p.y,COL.cyan,8,160,.3,2);FX.hit(3);Sfx.play('hit');for(const b of this.eb)b.life=0;return}p.hp=Math.max(0,p.hp-amount);p.inv=1.1;this.combo=0;this.comboT=0;this.refreshMultiplier();
    FX.hit(14);FX.flash=1;FX.burst(p.x,p.y,COL.pink,26,320,.7,3.5);FX.ring(p.x,p.y,130,COL.pink);Sfx.play('hurt');
    for(const b of this.eb)b.life=0;if(p.hp<=0)this.die()},
  die(){const p=this.p;p.dead=true;this.state='dying';this.dieT=0;$('pb').style.display='none';
    FX.burst(p.x,p.y,COL.cyan,70,430,1.1,4);FX.hit(18);Sfx.play('boom')}};

const Racer={canvas:null,ctx:null,w:1,h:1,lane:0,speed:0,distance:0,lives:3,traffic:[],spawn:0,clock:0,turnWait:0,keys:{},over:false,
  init(){this.canvas=$('racer-canvas');this.ctx=this.canvas.getContext('2d');this.resize()},
  resize(){if(!this.canvas)return;const r=this.canvas.getBoundingClientRect();this.w=r.width||innerWidth;this.h=r.height||innerHeight;const dpr=view.dpr||1;this.canvas.width=Math.max(1,Math.round(this.w*dpr));this.canvas.height=Math.max(1,Math.round(this.h*dpr))},
  start(){this.lane=0;this.speed=110;this.distance=0;this.lives=3;this.traffic=[];this.spawn=.5;this.clock=0;this.turnWait=0;this.keys={};this.over=false;$('racer-message').textContent='Use ← → or A / D to change lanes. Avoid traffic!';Game.set('racer')},
  steer(dir){if(this.over)return;this.lane=clamp(this.lane+dir,-1,1)},
  key(code,down){this.keys[code]=down},
  tick(dt){if(this.over)return;this.clock+=dt;this.turnWait=Math.max(0,this.turnWait-dt);
    const left=this.keys.ArrowLeft||this.keys.KeyA,right=this.keys.ArrowRight||this.keys.KeyD;
    if(this.turnWait<=0&&(left||right)){this.steer(left?-1:1);this.turnWait=.2}
    this.speed=Math.min(245,this.speed+12*dt);this.distance+=this.speed/3.6*dt;this.spawn-=dt;
    if(this.spawn<=0&&this.traffic.length<8){this.traffic.push({lane:Math.floor(Math.random()*3)-1,z:.02,color:['#ff3d9a','#ffc23d','#9b5cff','#6dffb0'][Math.floor(Math.random()*4)]});this.spawn=Math.max(.48,1.1-this.speed/400)}
    for(const car of this.traffic){car.z+=dt*(.2+this.speed/750);if(car.z>.82&&!car.hit&&car.lane===this.lane){car.hit=true;car.z=.83;this.lives--;this.speed=Math.max(70,this.speed*.55);$('racer-message').textContent='CRASH! '+this.lives+' '+(this.lives===1?'life':'lives')+' left';if(this.lives<=0){this.over=true;$('racer-message').textContent='RACE OVER · '+Math.floor(this.distance)+' m · press Restart';MiniGames.record('racer',Math.floor(this.distance))}}
    }
    this.traffic=this.traffic.filter(car=>car.z<1.08);
    $('racer-hud').innerHTML=Math.round(this.speed)+' km/h<br>Distance '+Math.floor(this.distance)+' m · ♥ '+this.lives;
    if(this.clock>3&&$('racer-message').textContent.startsWith('Use '))$('racer-message').textContent='';
    if($('racer-message').textContent.startsWith('CRASH!')&&this.clock%2<dt)$('racer-message').textContent=''
  },
  center(z){return this.w*.5+Math.sin(this.distance*.0012+z*3.1)*this.w*.09*z},
  drawCar(c,x,y,w,color,player=false){
    const h=w*.57;c.save();c.translate(x,y);c.shadowColor=color;c.shadowBlur=player?20:9;
    c.fillStyle='rgba(0,0,0,.55)';c.beginPath();c.ellipse(0,h*.42,w*.65,h*.2,0,0,TAU);c.fill();
    c.fillStyle='#101522';c.fillRect(-w*.5,-h*.05,w,h*.75);c.fillRect(-w*.62,h*.17,w*.15,h*.4);c.fillRect(w*.47,h*.17,w*.15,h*.4);
    c.fillStyle=color;c.beginPath();c.moveTo(-w*.47,h*.28);c.lineTo(-w*.38,-h*.12);c.lineTo(-w*.22,-h*.55);c.lineTo(w*.22,-h*.55);c.lineTo(w*.4,-h*.12);c.lineTo(w*.48,h*.28);c.closePath();c.fill();
    c.fillStyle='#132b42';c.beginPath();c.moveTo(-w*.28,-h*.17);c.lineTo(-w*.16,-h*.46);c.lineTo(w*.15,-h*.46);c.lineTo(w*.3,-h*.17);c.closePath();c.fill();
    c.fillStyle=player?'#fff6aa':'#ff304f';c.fillRect(-w*.38,h*.12,w*.18,h*.08);c.fillRect(w*.2,h*.12,w*.18,h*.08);c.restore()
  },
  draw(){if(!this.ctx||Game.state!=='racer')return;const c=this.ctx,w=this.w,h=this.h,dpr=view.dpr||1,horizon=h*.34;
    c.setTransform(dpr,0,0,dpr,0,0);const sky=c.createLinearGradient(0,0,0,horizon);sky.addColorStop(0,'#060a20');sky.addColorStop(1,'#35105b');c.fillStyle=sky;c.fillRect(0,0,w,horizon);
    for(let i=0;i<55;i++){const x=(i*127.1%997)/997*w,y=(i*61.7%263)/263*horizon;c.fillStyle=i%3?'#80eaff':'#ffda7a';c.fillRect(x,y,2,2)}
    c.fillStyle='#15243b';c.fillRect(0,horizon,w,h-horizon);
    const segments=40;
    for(let i=0;i<segments;i++){const z0=i/segments,z1=(i+1)/segments,y0=horizon+z0*z0*h*.68,y1=horizon+z1*z1*h*.68,c0=this.center(z0),c1=this.center(z1),rw0=w*(.025+.49*z0),rw1=w*(.025+.49*z1),stripe=(Math.floor(this.distance/18)+i)%2;
      c.fillStyle=stripe?'#1a2032':'#22283b';c.beginPath();c.moveTo(c0-rw0,y0);c.lineTo(c0+rw0,y0);c.lineTo(c1+rw1,y1);c.lineTo(c1-rw1,y1);c.closePath();c.fill();
      c.fillStyle=stripe?'#25eaff':'#ed3f9a';for(const side of[-1,1]){c.beginPath();c.moveTo(c0+side*rw0,y0);c.lineTo(c0+side*(rw0+2+z0*5),y0);c.lineTo(c1+side*(rw1+2+z1*5),y1);c.lineTo(c1+side*rw1,y1);c.closePath();c.fill()}
      if(i%2===0){c.strokeStyle='rgba(225,240,255,.68)';c.lineWidth=1+z1*3;for(const side of[-1,1]){const x0=c0+side*rw0/3,x1=c1+side*rw1/3;c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.stroke()}}
    }
    for(const car of this.traffic){const z=car.z,y=horizon+z*z*h*.68,roadW=w*(.025+.49*z),x=this.center(z)+car.lane*roadW*.62,carW=w*(.025+.095*z);this.drawCar(c,x,y-carW*.3,carW,car.color)}
    const z=.9,roadW=w*(.025+.49*z),playerX=this.center(z)+this.lane*roadW*.62;this.drawCar(c,playerX,horizon+z*z*h*.68,Math.min(w*.13,roadW*.35),'#32e8ff',true)
    c.fillStyle='rgba(3,7,20,.42)';c.fillRect(0,horizon,w,4)
  }};

const MiniGames={returnTo:'menu',active:null,snakeTimer:null,memoryTimer:null,stats:{snake:0,tile:0,memory:0,racer:0},
  init(){try{const saved=JSON.parse(localStorage.getItem('neonswarm.arcade'))||{};this.stats={...this.stats,...saved}}catch(e){}this.renderRecords()},
  save(){try{localStorage.setItem('neonswarm.arcade',JSON.stringify(this.stats));$('save-status').textContent='Progress and arcade records save in this browser for this site address.';SavedData.schedule();return true}catch(e){$('save-status').textContent='Browser storage is unavailable; progress may not persist.';return false}},
  record(id,value,lower=false){const old=this.stats[id];if((lower&&(!old||value<old))||(!lower&&value>old)){this.stats[id]=value;this.save()}this.renderRecords()},
  renderRecords(){$('arcade-records').textContent='Best Snake '+(this.stats.snake||0)+' | 2048 '+(this.stats.tile||0)+' | Memory '+(this.stats.memory||'--')+' moves | Racer '+(this.stats.racer||0)+' m'},
  open(from){this.returnTo=from;this.active=null;Game.set('games');this.renderRecords()},
  showHub(){this.stop();this.active=null;Game.set('games')},
  exit(){this.stop();this.active=null;Game.set(this.returnTo)},
  stop(){if(this.snakeTimer){clearInterval(this.snakeTimer);this.snakeTimer=null}if(this.memoryTimer){clearTimeout(this.memoryTimer);this.memoryTimer=null}},
  launch(id){this.stop();this.active=id;if(id==='racer'){Racer.start();return}Game.set({snake:'snake',tile:'game2048',memory:'memory'}[id]);if(id==='snake')this.startSnake();else if(id==='tile')this.startTile();else this.startMemory()},
  key(code){if(code==='Escape'){this.showHub();return}const dirs={ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right'};if(this.active==='snake'&&dirs[code])this.turnSnake(dirs[code]);if(this.active==='tile'&&dirs[code])this.moveTile(dirs[code])},
  startSnake(){this.active='snake';this.snake={body:[{x:7,y:8},{x:6,y:8},{x:5,y:8}],dir:'right',next:'right',food:{x:11,y:8},score:0,over:false};const host=$('snake-board');host.replaceChildren();for(let i=0;i<256;i++){const cell=document.createElement('div');cell.className='snake-cell';host.append(cell)}this.paintSnake();$('snake-status').textContent='Score 0 | Best '+(this.stats.snake||0);this.snakeTimer=setInterval(()=>this.stepSnake(),125)},
  turnSnake(dir){const opposite={up:'down',down:'up',left:'right',right:'left'};if(dir!==opposite[this.snake.dir])this.snake.next=dir},
  stepSnake(){const s=this.snake;if(!s||s.over)return;s.dir=s.next;const delta={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[s.dir],head={x:s.body[0].x+delta[0],y:s.body[0].y+delta[1]},eats=head.x===s.food.x&&head.y===s.food.y,limit=eats?s.body.length:s.body.length-1;if(head.x<0||head.y<0||head.x>=16||head.y>=16||s.body.slice(0,limit).some(p=>p.x===head.x&&p.y===head.y)){s.over=true;this.stop();$('snake-status').textContent='Game over | Score '+s.score+' | Best '+(this.stats.snake||0);return}s.body.unshift(head);if(eats){s.score+=10;this.record('snake',s.score);do{s.food={x:Math.floor(Math.random()*16),y:Math.floor(Math.random()*16)}}while(s.body.some(p=>p.x===s.food.x&&p.y===s.food.y))}else s.body.pop();$('snake-status').textContent='Score '+s.score+' | Best '+(this.stats.snake||0);this.paintSnake()},
  paintSnake(){const cells=$('snake-board').children,s=this.snake;for(const cell of cells)cell.className='snake-cell';for(let i=0;i<s.body.length;i++){const p=s.body[i];cells[p.y*16+p.x].className='snake-cell '+(i===0?'head':'body')}cells[s.food.y*16+s.food.x].className='snake-cell food'},
  startTile(){this.active='tile';this.tile={board:Array(16).fill(0),score:0};this.spawnTile();this.spawnTile();this.paintTile()},
  spawnTile(){const empty=this.tile.board.map((v,i)=>v?-1:i).filter(i=>i>=0);if(empty.length)this.tile.board[empty[Math.floor(Math.random()*empty.length)]]=Math.random()<.9?2:4},
  moveTile(dir){const t=this.tile,before=t.board.join(','),lines=[];for(let n=0;n<4;n++){const line=dir==='left'||dir==='right'?Array.from({length:4},(_,i)=>n*4+(dir==='left'?i:3-i)):Array.from({length:4},(_,i)=>(dir==='up'?i:3-i)*4+n);lines.push(line)}for(const line of lines){const values=line.map(i=>t.board[i]).filter(Boolean),merged=[];for(let i=0;i<values.length;i++){if(values[i]===values[i+1]){merged.push(values[i]*2);t.score+=values[i]*2;i++}else merged.push(values[i])}line.forEach((index,i)=>t.board[index]=merged[i]||0)}if(t.board.join(',')!==before){this.spawnTile();this.record('tile',t.score);this.paintTile()}},
  paintTile(){const host=$('tile-board');host.replaceChildren();for(const value of this.tile.board){const tile=document.createElement('div');tile.className='tile';tile.textContent=value||'';tile.style.setProperty('--tile-color',value?({2:'#204454',4:'#246b63',8:'#317f57',16:'#96772e',32:'#b64e36',64:'#dc3c68',128:'#7b53aa',256:'#4b62bc',512:'#347da9',1024:'#ce8b2e',2048:'#ffe044'}[value]||'#ef4fbd'):'rgba(255,255,255,.06)');host.append(tile)}$('tile-status').textContent='Score '+this.tile.score+' | Best '+(this.stats.tile||0)+' | Arrow keys or WASD'},
  startMemory(){this.active='memory';this.memory={cards:[0,1,2,3,4,5,6,7,0,1,2,3,4,5,6,7].sort(()=>Math.random()-.5),open:[],matched:[],moves:0,locked:false};this.paintMemory()},
  paintMemory(){const host=$('memory-board');host.replaceChildren();this.memory.cards.forEach((value,index)=>{const card=document.createElement('button');card.type='button';card.className='memory-card';card.textContent=this.memory.matched.includes(index)||this.memory.open.includes(index)?String.fromCharCode(65+value):'?';card.setAttribute('aria-label',this.memory.matched.includes(index)||this.memory.open.includes(index)?'Card '+String.fromCharCode(65+value):'Hidden card');card.disabled=this.memory.matched.includes(index)||this.memory.locked;card.onclick=()=>this.flipMemory(index);host.append(card)});$('memory-status').textContent='Moves '+this.memory.moves+' | Best '+(this.stats.memory||'--')+' moves'},
  flipMemory(index){const m=this.memory;if(m.locked||m.open.includes(index)||m.matched.includes(index))return;m.open.push(index);if(m.open.length===2){m.moves++;const [a,b]=m.open;if(m.cards[a]===m.cards[b]){m.matched.push(a,b);m.open=[];if(m.matched.length===16)this.record('memory',m.moves,true)}else{m.locked=true;this.memoryTimer=setTimeout(()=>{m.open=[];m.locked=false;this.memoryTimer=null;this.paintMemory()},650)}}this.paintMemory()}};
/* ================= RENDERING ================= */
function poly(c,x,y,r,n,a){for(let i=0;i<n;i++){const t=a+i*TAU/n,px=x+Math.cos(t)*r,py=y+Math.sin(t)*r;i?c.lineTo(px,py):c.moveTo(px,py)}c.closePath()}
function drawShip(c,p,skin,gl){
  c.save();c.translate(p.x,p.y);c.rotate(p.aim);c.beginPath();
  switch(skin.shape){
    case'dart':c.moveTo(23,0);c.lineTo(-14,-7);c.lineTo(-6,0);c.lineTo(-14,7);break;
    case'wing':c.moveTo(17,0);c.lineTo(-5,-7);c.lineTo(-16,-15);c.lineTo(-11,-3);c.lineTo(-16,0);c.lineTo(-11,3);c.lineTo(-16,15);c.lineTo(-5,7);break;
    case'diamond':c.moveTo(19,0);c.lineTo(0,-12);c.lineTo(-14,0);c.lineTo(0,12);break;
    case'crescent':c.moveTo(18,0);c.lineTo(-12,-13);c.lineTo(-4,0);c.lineTo(-12,13);c.lineTo(4,8);break;
    case'swept':c.moveTo(21,0);c.lineTo(-5,-5);c.lineTo(-17,-13);c.lineTo(-12,-2);c.lineTo(-17,13);c.lineTo(-5,5);break;
    case'orb':c.arc(0,0,10,0,TAU);break;
    case'longwing':c.moveTo(20,0);c.lineTo(-7,-4);c.lineTo(-18,-17);c.lineTo(-11,-4);c.lineTo(-17,0);c.lineTo(-11,4);c.lineTo(-18,17);c.lineTo(-7,4);break;
    case'stealth':c.moveTo(22,0);c.lineTo(-7,-4);c.lineTo(-15,-10);c.lineTo(-12,0);c.lineTo(-15,10);c.lineTo(-7,4);break;
    case'pixel':c.rect(-12,-9,18,18);c.rect(6,-4,9,8);break;
    case'heavy':c.moveTo(18,0);c.lineTo(8,-8);c.lineTo(-12,-11);c.lineTo(-8,-4);c.lineTo(-15,0);c.lineTo(-8,4);c.lineTo(-12,11);c.lineTo(8,8);break;
    case'fang':c.moveTo(23,0);c.lineTo(-5,-7);c.lineTo(-17,-13);c.lineTo(-11,-2);c.lineTo(-16,0);c.lineTo(-11,2);c.lineTo(-17,13);c.lineTo(-5,7);break;
    case'prism':c.moveTo(17,0);c.lineTo(7,-10);c.lineTo(-8,-10);c.lineTo(-16,0);c.lineTo(-8,10);c.lineTo(7,10);break;
    case'carrier':c.moveTo(17,0);c.lineTo(7,-7);c.lineTo(-14,-13);c.lineTo(-8,-4);c.lineTo(-14,0);c.lineTo(-8,4);c.lineTo(-14,13);c.lineTo(7,7);break;
    default:c.moveTo(17,0);c.lineTo(-11,-11);c.lineTo(-5,0);c.lineTo(-11,11);
  }
  c.closePath();gl(skin.color,22);c.fillStyle='#0d0524';c.strokeStyle=skin.color;c.lineWidth=3;c.fill();c.stroke();
  c.shadowBlur=0;c.fillStyle='#fff';c.globalAlpha=.8;c.beginPath();if(skin.shape==='orb')c.arc(1,0,3.5,0,TAU);else c.ellipse(3,0,4,2.4,0,0,TAU);c.fill();c.restore()
}
function draw(){
  const c=ctx,G=Game,p=G.p,{w:W,h:H,dpr}=view,S=view.s*dpr,gl=(col,b)=>{c.shadowColor=col;c.shadowBlur=b*S}; // glow scales with screen
  c.setTransform(1,0,0,1,0,0);c.shadowBlur=0;c.globalAlpha=1;c.fillStyle=bg;c.fillRect(0,0,cv.width,cv.height);
  const sh=G.state==='pause'?0:FX.shake*.5;c.setTransform(S,0,0,S,rnd(-sh,sh)*S,rnd(-sh,sh)*S); // screen shake
  c.lineWidth=1;c.strokeStyle='rgba(155,92,255,'+(.16+.06*Math.sin(G.time*2.2))+')';c.beginPath();
  const off=(G.time*10)%56;for(let x=-off;x<W+56;x+=56){c.moveTo(x,0);c.lineTo(x,H)}for(let y=-off;y<H+56;y+=56){c.moveTo(0,y);c.lineTo(W,y)}c.stroke();
  c.strokeStyle=COL.vio;c.lineWidth=2.5;gl(COL.vio,18);c.strokeRect(3,3,W-6,H-6);
  if(p){
    gl(COL.mint,10);c.fillStyle=COL.mint;c.beginPath();for(const g of G.gems)poly(c,g.x,g.y,5,4,g.a);c.fill();
    for(const u of G.pu){const col={shield:COL.cyan,bomb:COL.gold,life:COL.pink,rapid:COL.mint}[u.k];gl(col,14);c.strokeStyle=col;c.fillStyle='#1a0a3d';c.lineWidth=2.5;c.globalAlpha=u.t<3?.4+.6*(Math.floor(G.time*8)%2):1;
      c.beginPath();poly(c,u.x,u.y,12,6,u.a);c.fill();c.stroke();c.globalAlpha=1;c.fillStyle=col;c.font='800 13px '+FONT;c.textAlign='center';c.fillText(u.k==='life'?'+':u.k==='rapid'?'R':u.k[0].toUpperCase(),u.x,u.y+4.5)}
    c.lineWidth=2.5;c.lineJoin='round';
    for(const e of G.enemies){const T=TYPES[e.k];gl(T.col,16);c.strokeStyle=T.col;c.fillStyle=e.flash>0?'#fff':'#1a0a3d';
      c.beginPath();poly(c,e.x,e.y,e.r,T.n,e.ang);c.fill();c.stroke();
      if(e.hp<e.mhp&&e.k!=='boss'){c.beginPath();c.arc(e.x,e.y,e.r+6,-1.57,-1.57+TAU*e.hp/e.mhp);c.stroke()}
      if(e.st===1){c.save();c.globalAlpha=.55;c.lineWidth=2;c.beginPath();c.moveTo(e.x,e.y);c.lineTo(e.x+e.cx*700,e.y+e.cy*700);c.stroke();c.restore()}}
    gl(COL.cyan,12);c.strokeStyle=COL.cyan;c.lineWidth=3.5;c.lineCap='round';c.beginPath();
    for(const b of G.bullets){c.moveTo(b.x,b.y);c.lineTo(b.x-b.vx*.02,b.y-b.vy*.02)}c.stroke();
    gl(COL.pink,14);c.fillStyle='#ffe0f0';c.beginPath();for(const b of G.eb){c.moveTo(b.x+5,b.y);c.arc(b.x,b.y,5,0,TAU)}c.fill();
    if(!p.dead&&(p.inv<=0||Math.floor(G.time*18)%2)){
      drawShip(c,p,Profile.item(),gl);
      if(p.shield>0){gl(COL.cyan,16);c.strokeStyle=COL.cyan;c.lineWidth=2.5;c.beginPath();c.arc(p.x,p.y,p.r+17,0,TAU);c.stroke()}
      if(p.rapid>0){gl(COL.mint,14);c.strokeStyle=COL.mint;c.lineWidth=2;c.beginPath();c.arc(p.x,p.y,p.r+23,-1.57,-1.57+TAU*p.rapid/8);c.stroke()}
      if(p.dashCd>0){c.shadowBlur=0;c.strokeStyle='rgba(61,245,255,.4)';c.lineWidth=2;c.beginPath();c.arc(p.x,p.y,p.r+10,-1.57,-1.57+TAU*(1-p.dashCd/1.1));c.stroke()}}}
  FX.draw(c,S);
  // HUD in screen space
  c.setTransform(dpr,0,0,dpr,0,0);c.globalAlpha=1;
  if(FX.flash>0){c.shadowBlur=0;c.fillStyle='rgba(255,40,120,'+FX.flash*.3+')';c.fillRect(0,0,view.cw,view.ch)}
  if(p){const fs=clamp(Math.min(view.cw,view.ch)/22,14,28),y=16+fs*1.9;
    c.textAlign='left';c.font='800 '+fs*1.9+'px '+FONT;c.fillStyle='#fff';c.shadowColor=COL.pink;c.shadowBlur=14*dpr;c.fillText(G.score.toLocaleString(),16,y);
    c.font='800 '+fs+'px '+FONT;c.fillStyle=COL.gold;c.shadowColor=COL.gold;c.fillText('x'+G.mult+(G.combo>1?'  combo '+G.combo:''),16,y+fs*1.3);
    if(G.comboT>0)c.fillRect(16,y+fs*1.6,110*G.comboT/2.6,4);
    c.textAlign='center';c.fillStyle=COL.cyan;c.shadowColor=COL.cyan;c.fillText('Wave '+G.wave+'/'+MAX_WAVE+'  |  Lv '+G.lvl,view.cw/2,16+fs*1.1);
    const B=G.enemies.find(e=>e.k==='boss');if(B){const bw=Math.min(420,view.cw*.7),bx=(view.cw-bw)/2,by=view.ch-42;c.textAlign='center';c.font='700 11px '+FONT;c.fillStyle=COL.pink;c.shadowBlur=0;c.fillText('BOSS  '+Math.ceil(B.hp)+' / '+B.mhp,view.cw/2,by-5);c.fillStyle='rgba(255,61,245,.22)';c.fillRect(bx,by,bw,8);c.fillStyle=COL.pink;c.shadowColor=COL.pink;c.shadowBlur=10*dpr;c.fillRect(bx,by,bw*clamp(B.hp/B.mhp,0,1),8)}
    c.fillStyle='#a592d6';c.shadowBlur=0;c.font='600 '+fs*.8+'px '+FONT;c.fillText('Best '+Math.max(G.best,G.score).toLocaleString(),view.cw/2,16+fs*2.2);
    const xpw=Math.min(150,view.cw*.42),xpx=(view.cw-xpw)/2,xpy=16+fs*3.05;
    c.textAlign='center';c.font='600 '+fs*.62+'px '+FONT;c.fillStyle=COL.mint;c.shadowColor=COL.mint;c.shadowBlur=5*dpr;c.fillText('XP '+G.totalXp.toLocaleString()+' | next '+G.xp+'/'+G.need,view.cw/2,xpy);
    c.shadowBlur=0;c.fillStyle='rgba(255,255,255,.16)';c.fillRect(xpx,xpy+4,xpw,4);c.fillStyle=COL.mint;c.fillRect(xpx,xpy+4,xpw*clamp(G.xp/G.need,0,1),4);
    const hpw=Math.min(180,view.cw*.48),hpy=view.ch<500?142:view.ch-17;c.shadowBlur=0;c.textAlign='left';c.font='700 '+fs*.72+'px '+FONT;c.fillStyle=p.hp/p.maxHp<.3?COL.pink:COL.mint;c.fillText('HP  '+Math.ceil(p.hp)+' / '+p.maxHp,16,hpy-10);c.fillStyle='rgba(255,255,255,.16)';c.fillRect(16,hpy-7,hpw,7);c.fillStyle=p.hp/p.maxHp<.3?COL.pink:COL.mint;c.fillRect(16,hpy-7,hpw*clamp(p.hp/p.maxHp,0,1),7);
    if(p.shield>0){c.textAlign='right';c.fillStyle=COL.cyan;c.font='700 '+fs*.72+'px '+FONT;c.fillText('SHIELD '+Math.ceil(p.shield)+'s',view.cw-16,view.ch-10)}
    const q=Input.ptr;if(q&&G.state==='play'){c.shadowBlur=0;c.strokeStyle='rgba(255,255,255,.22)';c.lineWidth=2;c.beginPath();c.arc(q.x0,q.y0,60,0,TAU);c.stroke();
      c.fillStyle='rgba(61,245,255,.35)';c.beginPath();c.arc(q.x,q.y,22,0,TAU);c.fill()}}
}

/* ================= BOOT: resize + delta-time loop ================= */
function resize(){const cw=cv.clientWidth||innerWidth,ch=cv.clientHeight||innerHeight,s=Math.min(cw,ch)/VIEW;
  const targetHeight=Settings.data.resolution||1080,maxPixels=16777216;
  const renderDpr=Math.min(targetHeight/ch,Math.sqrt(maxPixels/(cw*ch)),16384/cw,16384/ch);
  cv.width=Math.max(1,Math.round(cw*renderDpr));cv.height=Math.max(1,Math.round(ch*renderDpr));view={cw,ch,dpr:renderDpr,s,w:cw/s,h:ch/s};ctx.imageSmoothingEnabled=targetHeight>340;
  bg=ctx.createRadialGradient(cv.width/2,cv.height/2,0,cv.width/2,cv.height/2,Math.max(cv.width,cv.height)*.7);bg.addColorStop(0,'#220c52');bg.addColorStop(1,'#07021a');
  const p=Game.p;if(p){p.x=clamp(p.x,p.r,view.w-p.r);p.y=clamp(p.y,p.r,view.h-p.r)}if(typeof Racer!=='undefined')Racer.resize()}
let last=0,fpsWindow=0,fpsFrames=0;
function frame(t){requestAnimationFrame(frame);const interval=1000/Settings.data.fps;if(last&&t-last+0.25<interval)return;const dt=Math.min((t-last)/1000||0,.05);last=t;Game.tick(dt);if(Game.state==='racer'){Racer.tick(dt);Racer.draw()}else draw();
  fpsFrames++;if(!fpsWindow)fpsWindow=t;if(t-fpsWindow>=500){if(Settings.data.showFps)$('fps-counter').textContent=Math.round(fpsFrames*1000/(t-fpsWindow))+' FPS';fpsFrames=0;fpsWindow=t}} // browser refresh rate bounds the actual maximum
addEventListener('resize',resize);
$('play').onclick=()=>Game.start();$('again').onclick=()=>Game.start();$('resume').onclick=()=>Game.resume();
$('quit').onclick=()=>Game.goMenu();$('home').onclick=()=>Game.goMenu();$('pb').onclick=()=>Game.pause();
$('settings-open').onclick=()=>Settings.open('menu');$('settings-pause').onclick=()=>Settings.open('pause');$('settings-close').onclick=()=>Settings.close();
$('shop-open-menu').onclick=()=>Shop.open('menu');$('shop-open-pause').onclick=()=>Shop.open('pause');$('shop-close').onclick=()=>Shop.close();
$('games-open-menu').onclick=()=>MiniGames.open('menu');$('games-open-pause').onclick=()=>MiniGames.open('pause');$('games-back').onclick=()=>MiniGames.exit();document.querySelectorAll('[data-games-back]').forEach(button=>button.onclick=()=>MiniGames.showHub());
document.querySelectorAll('[data-launch-game]').forEach(button=>button.onclick=()=>MiniGames.launch(button.dataset.launchGame));
document.querySelectorAll('[data-snake-dir]').forEach(button=>button.onclick=()=>MiniGames.turnSnake(button.dataset.snakeDir));
document.querySelectorAll('[data-tile-dir]').forEach(button=>button.onclick=()=>MiniGames.moveTile(button.dataset.tileDir));
$('snake-restart').onclick=()=>MiniGames.launch('snake');$('tile-restart').onclick=()=>MiniGames.launch('tile');$('memory-restart').onclick=()=>MiniGames.launch('memory');
$('admin-open-menu').onclick=()=>Admin.open('menu');$('admin-open-pause').onclick=()=>Admin.open('pause');
$('admin-unlock').onclick=()=>Admin.unlock();$('admin-lock-close').onclick=()=>Admin.close();$('admin-close').onclick=()=>Admin.close();
$('admin-fire-rate').oninput=e=>Admin.setFireRate(e.target.value);
$('admin-damage').onchange=e=>Admin.setDamage(e.target.value);
$('admin-xp-multiplier').onchange=e=>Admin.setXpMultiplier(e.target.value);
$('admin-shield-duration').onchange=e=>Admin.setShieldDuration(e.target.value);
$('admin-grant-shield').onclick=()=>Admin.grantShield();
$('music-enabled').onchange=e=>Settings.setMusic(e.target.checked);
$('music-volume').oninput=e=>Settings.setMusicVolume(Number(e.target.value)/100);
$('effects-volume').oninput=e=>Settings.setEffectsVolume(Number(e.target.value)/100);
$('fps-cap').oninput=e=>Settings.setFps(e.target.value);
$('fps-visible').onchange=e=>Settings.setShowFps(e.target.checked);
$('resolution').onchange=e=>Settings.setResolution(e.target.value);
$('racer-restart').onclick=()=>MiniGames.launch('racer');$('racer-back').onclick=()=>MiniGames.showHub();
document.querySelectorAll('[data-racer-dir]').forEach(button=>button.onclick=()=>Racer.steer(Number(button.dataset.racerDir)));
document.addEventListener('visibilitychange',()=>{if(document.hidden)Racer.keys={}});
const Net={on:false, // optional Python leaderboard: only present when served by neon_swarm.py
  async get(){try{const r=await fetch('api/scores');if(!r.ok)throw 0;const j=await r.json();this.on=true;return j.scores}catch(e){this.on=false;return null}},
  async post(n,s){try{const r=await fetch('api/scores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,score:s})});return r.ok?(await r.json()).scores:null}catch(e){return null}}};
$('sub').onclick=async()=>{const n=$('nm').value.trim().slice(0,12)||'Player';$('sub').disabled=true;$('submit-status').textContent='Saving score...';try{localStorage.setItem('neonswarm.name',n)}catch(e){}
  const local=Store.submit(n,Game.score),shared=await Net.post(n,Game.score);$('sub').disabled=false;$('sv').hidden=true;
  if(shared){board($('b1'),shared,Game.score);$('submit-status').textContent=local?'Saved to the shared leaderboard.':'Shared score saved; browser storage is unavailable.'}
  else if(local){board($('b1'),local,Game.score);$('submit-status').textContent='Saved on this device. The shared leaderboard is unavailable.'}
  else $('submit-status').textContent='Could not save this score. Check browser storage or the server.'};
SavedData.init().finally(()=>{Profile.init();Settings.init();Admin.init();MiniGames.init();Racer.init();Input.bind();resize();Game.best=Store.load()[0]?.s||0;board($('b0'),Store.load(),-1);Net.get().then(s=>s&&board($('b0'),s,-1));requestAnimationFrame(frame)});
</script>
</body>
</html>
'''
# ------------------------------------------------------------ the server -----


def load_scores():
    try:
        rows = json.loads(DB.read_text(encoding="utf-8"))
        return [r for r in rows if isinstance(r, dict)][:10]
    except (OSError, ValueError, TypeError):
        return []


def save_scores(rows):
    tmp = DB.with_suffix(".tmp")
    tmp.write_text(json.dumps(rows), encoding="utf-8")
    tmp.replace(DB)  # atomic swap so a crash never leaves a half-written file


def load_saves():
    try:
        rows = json.loads(SAVES_DB.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    if not isinstance(rows, dict):
        raise ValueError("saved data file must contain an object")
    return rows


def save_saves(rows):
    tmp = SAVES_DB.with_suffix(".tmp")
    tmp.write_text(json.dumps(rows), encoding="utf-8")
    tmp.replace(SAVES_DB)


class Handler(BaseHTTPRequestHandler):
    server_version = "NeonSwarm/2.0"

    def send_body(self, code, body, ctype="application/json"):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_audio(self, data):
        start, end, status = 0, len(data) - 1, 200
        value = self.headers.get("Range", "")
        if value.startswith("bytes="):
            try:
                first, last = value[6:].split("-", 1)
                if first:
                    start = int(first)
                    end = min(int(last), len(data) - 1) if last else len(data) - 1
                else:
                    suffix = int(last)
                    start = max(0, len(data) - suffix)
                if start > end or start >= len(data):
                    raise ValueError("invalid range")
                status = 206
            except (ValueError, TypeError):
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%s" % len(data))
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        chunk = data[start:end + 1]
        self.send_response(status)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(chunk)))
        self.send_header("Accept-Ranges", "bytes")
        if status == 206:
            self.send_header("Content-Range", "bytes %s-%s/%s" % (start, end, len(data)))
        self.end_headers()
        self.wfile.write(chunk)

    def do_GET(self):
        parsed = urlsplit(self.path)
        path = unquote(parsed.path)
        if path in ("/", "/index.html"):
            self.send_body(200, GAME_HTML, "text/html")
        elif path == "/api/scores":
            self.send_body(200, json.dumps({"scores": load_scores()}))
        elif path == "/api/saves":
            token = self.headers.get("X-Save-Token", "")
            if not re.fullmatch(r"[a-f0-9]{32}", token):
                return self.send_body(400, '{"error":"bad save token"}')
            save_id = hashlib.sha256(token.encode("ascii")).hexdigest()
            self.send_body(200, json.dumps({"data": load_saves().get(save_id, {})}))
        elif path == "/MATADORA (Sped Up).mp3":
            try:
                audio_path = Path(__file__).resolve().with_name("MATADORA (Sped Up).mp3")
                self.send_audio(audio_path.read_bytes())
            except OSError:
                self.send_body(404, '{"error":"audio not found"}')
        else:
            self.send_body(404, '{"error":"not found"}')

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == "/api/saves":
            return self.save_browser_data()
        if path != "/api/scores":
            return self.send_body(404, '{"error":"not found"}')
        ip, now = self.client_address[0], time.time()
        if now - LAST_POST.get(ip, 0) < 3:
            return self.send_body(429, '{"error":"slow down"}')
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 1024:
                raise ValueError("bad size")
            data = json.loads(self.rfile.read(size))
            name = re.sub(r"[^\w -]", "", str(data["name"]))[:12].strip() or "Player"
            score = int(data["score"])
            if not 0 < score <= 9_007_199_254_740_991:
                raise ValueError("bad score")
        except (ValueError, KeyError, TypeError, AttributeError):
            return self.send_body(400, '{"error":"bad request"}')
        LAST_POST[ip] = now
        with LOCK:
            rows = load_scores()
            rows.append({"n": name, "s": score})
            rows = sorted(rows, key=lambda r: -int(r.get("s", 0)))[:10]
            save_scores(rows)
        self.send_body(200, json.dumps({"scores": rows}))

    def save_browser_data(self):
        ip, now = self.client_address[0], time.time()
        if now - LAST_SAVE_POST.get(ip, 0) < 1:
            return self.send_body(429, '{"error":"slow down"}')
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 8192:
                raise ValueError("bad size")
            payload = json.loads(self.rfile.read(size))
            token, data = payload["token"], payload["data"]
            if not isinstance(token, str) or not re.fullmatch(r"[a-f0-9]{32}", token):
                raise ValueError("bad save token")
            save_id = hashlib.sha256(token.encode("ascii")).hexdigest()
            if not isinstance(data, dict) or not set(data).issubset(SAVE_KEYS):
                raise ValueError("bad save data")
            if any(not isinstance(value, (dict, list)) for value in data.values()):
                raise ValueError("bad save value")
            if any(len(json.dumps(value)) > 4096 for value in data.values()):
                raise ValueError("save value too large")
        except (ValueError, KeyError, TypeError, AttributeError):
            return self.send_body(400, '{"error":"bad request"}')
        LAST_SAVE_POST[ip] = now
        try:
            with LOCK:
                rows = load_saves()
                if save_id not in rows and len(rows) >= 1000:
                    return self.send_body(503, '{"error":"save capacity reached"}')
                rows[save_id] = data
                save_saves(rows)
        except (OSError, ValueError):
            return self.send_body(500, '{"error":"could not save data"}')
        self.send_body(200, '{"ok":true}')

    def log_message(self, fmt, *args):
        print(f"[HTTP] {self.client_address[0]} - {fmt % args}", flush=True)


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # sends nothing; just picks the outbound interface
            return s.getsockname()[0]
    except OSError:
        return None


def create_server(host, start_port):
    for port in range(start_port, start_port + 20):
        try:
            return ThreadingHTTPServer((host, port), Handler), port
        except OSError:
            continue
    raise SystemExit(f"No free port found. Try: python neon_swarm.py --port {start_port + 20}")


def run_gui(host, start_port, gui_smoke_test=False):
    import tkinter as tk

    server, port = create_server(host, start_port)
    server_thread = threading.Thread(
        target=server.serve_forever,
        name="neon-swarm-server",
        daemon=True,
    )
    server_thread.start()
    url = f"http://127.0.0.1:{port}"

    print("[startup] Neon Swarm desktop launcher starting.", flush=True)
    print(f"[startup] Game server listening at {url}", flush=True)
    print(f"[startup] Leaderboard file: {DB}", flush=True)
    if host == "0.0.0.0":
        ip = lan_ip()
        if ip:
            print(f"[startup] Local network link: http://{ip}:{port}", flush=True)

    root = tk.Tk()
    root.title("Neon Swarm - Loading")
    root.configure(bg="#0d0524")
    root.resizable(False, False)
    width, height = 560, 390
    root.geometry(f"{width}x{height}")
    root.eval("tk::PlaceWindow . center")

    title = tk.Label(
        root,
        text="NEON SWARM",
        bg="#0d0524",
        fg="#f4eaff",
        font=("Segoe UI", 24, "bold"),
    )
    title.pack(pady=(28, 8))
    status = tk.StringVar(value="Connecting to the local game server...")
    tk.Label(
        root,
        textvariable=status,
        bg="#0d0524",
        fg="#a592d6",
        font=("Segoe UI", 11),
    ).pack(pady=(0, 12))

    canvas = tk.Canvas(root, width=112, height=112, bg="#0d0524", highlightthickness=0)
    canvas.pack()
    canvas.create_oval(12, 12, 100, 100, outline="#35205b", width=8)
    progress_arc = canvas.create_arc(
        12,
        12,
        100,
        100,
        start=90,
        extent=0,
        style="arc",
        outline="#3df5ff",
        width=8,
    )
    progress_text = canvas.create_text(
        56,
        56,
        text="0%",
        fill="#f4eaff",
        font=("Segoe UI", 16, "bold"),
    )
    tk.Label(
        root,
        text="DESKTOP EDITION  |  LOCAL CONNECTION",
        bg="#0d0524",
        fg="#3df5ff",
        font=("Segoe UI", 9, "bold"),
    ).pack(pady=(16, 0))

    started_at = time.monotonic()
    def stop_server():
        print("[shutdown] Stopping the game server.", flush=True)
        server.shutdown()
        server.server_close()

    def show_fallback(message):
        print(f"[gui] {message}", flush=True)
        fallback = tk.Tk()
        fallback.title("Neon Swarm")
        fallback.configure(bg="#0d0524")
        fallback.resizable(False, False)
        fallback.geometry(f"{width}x{height}")
        fallback.eval("tk::PlaceWindow . center")
        tk.Label(
            fallback,
            text="The embedded game window could not start",
            bg="#0d0524",
            fg="#f4eaff",
            font=("Segoe UI", 17, "bold"),
        ).pack(pady=(28, 16))
        tk.Label(
            fallback,
          text="The embedded desktop browser could not start. Open the game in your browser:",
            bg="#0d0524",
            fg="#a592d6",
            font=("Segoe UI", 10),
            wraplength=width - 48,
        ).pack(pady=(0, 10))
        link = tk.Label(
            fallback,
            text=url,
            bg="#0d0524",
            fg="#3df5ff",
            cursor="hand2",
            font=("Segoe UI", 12, "underline"),
        )
        link.pack(pady=4)
        link.bind("<Button-1>", lambda _event: webbrowser.open(url))
        tk.Button(
            fallback,
            text="Open game",
            command=lambda: webbrowser.open(url),
            bg="#17334a",
            fg="#f4eaff",
            activebackground="#23516a",
            activeforeground="#ffffff",
            relief="flat",
            padx=20,
            pady=8,
        ).pack(pady=18)
        tk.Label(
            fallback,
            text="Close this window to stop the game server.",
            bg="#0d0524",
            fg="#a592d6",
            font=("Segoe UI", 9),
        ).pack(pady=(8, 0))
        fallback.protocol("WM_DELETE_WINDOW", fallback.destroy)
        fallback.mainloop()

    def open_game_window():
        print("[gui] Opening the game in its app window.", flush=True)
        root.destroy()
        try:
            import webview

            window = webview.create_window(
                "Neon Swarm",
                url,
                width=1100,
                height=760,
                min_size=(640, 480),
            )

            def on_loaded():
              print("[gui] Embedded game page loaded.", flush=True)
              if gui_smoke_test:
                window.destroy()

            webview.start(func=on_loaded, gui="qt", debug=False)
            print("[gui] Game window closed.", flush=True)
        except Exception as exc:
            traceback.print_exc()
            if not gui_smoke_test:
              webbrowser.open(url)
            show_fallback(
                f"Embedded game window could not start ({type(exc).__name__}: {exc}). "
                f"Open {url} in a browser."
            )
        finally:
            stop_server()

    def update_loading():
      elapsed = time.monotonic() - started_at
      try:
        with urlopen(url, timeout=0.4) as response:
          ready = response.status == 200
      except (OSError, URLError):
        ready = False
      if ready:
        canvas.itemconfigure(progress_arc, start=90, extent=-360)
        canvas.itemconfigure(progress_text, text="READY")
        status.set("Opening the desktop game window...")
        print("[loading] Local game server is ready; opening the desktop window.", flush=True)
        root.after(250, open_game_window)
        return
      canvas.itemconfigure(progress_arc, start=90 - elapsed * 240, extent=-110)
      canvas.itemconfigure(progress_text, text="...")
      if elapsed >= 15:
        root.destroy()
        show_fallback("The local game server did not become ready.")
        stop_server()
        return
      root.after(100, update_loading)

    root.protocol("WM_DELETE_WINDOW", lambda: (root.destroy(), stop_server()))
    root.after(0, update_loading)
    root.mainloop()


def main():
    ap = argparse.ArgumentParser(description="Neon Swarm game server")
    ap.add_argument("--port", type=int, default=8000, help="first port to try (default 8000)")
    ap.add_argument("--lan", action="store_true", help="listen on your network so phones can play")
    ap.add_argument("--no-browser", action="store_true", help="do not open a browser tab")
    ap.add_argument("--gui", action="store_true", help="open the desktop game window")
    ap.add_argument("--gui-smoke-test", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--server", action="store_true", help="run only the game server")
    args = ap.parse_args()

    host = "0.0.0.0" if args.lan else "127.0.0.1"
    is_executable = bool(getattr(sys, "frozen", False)) or Path(sys.argv[0]).suffix.lower() == ".exe"
    if not args.server and (args.gui or args.gui_smoke_test or is_executable):
        run_gui(host, args.port, args.gui_smoke_test)
        return

    server, port = create_server(host, args.port)

    url = f"http://localhost:{port}"
    print("\n  Neon Swarm is running")
    print(f"  Play on this computer:  {url}")
    if args.lan:
        ip = lan_ip()
        if ip:
            print(f"  Play on your phone:     http://{ip}:{port}   (same Wi-Fi)")
    else:
        print("  Phones: restart with --lan to let devices on your Wi-Fi join")
    print(f"  Leaderboard file:       {DB}")
    print("  Press Ctrl+C to stop\n")
    if not args.no_browser:
        threading.Timer(0.6, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped. Thanks for playing!")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
