#!/usr/bin/env python3
"""Neon Swarm game server.

Run:  python neon_swarm.py            (opens http://localhost:8000)
      python neon_swarm.py --lan      (also reachable from phones on your Wi-Fi)

Standard library only (Python 3.7+). The game page is embedded below, and the
server adds a shared leaderboard saved next to this file in neon_swarm_scores.json.
Scores are reported by the browser, so treat the leaderboard as friendly, not tamper-proof.
"""
import argparse
import json
import re
import socket
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DB = Path(__file__).resolve().with_name("neon_swarm_scores.json")
LOCK = threading.Lock()
LAST_POST = {}  # client ip -> time of last score submission (simple rate limit)

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
#pb{position:absolute;top:10px;right:10px;display:none;padding:6px 16px}
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
#skins{display:flex;gap:10px;align-items:center;justify-content:center;min-height:42px}
#photo-controls{display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px}
#photo-preview{width:38px;height:38px;border:2px solid var(--cyan);border-radius:50%;object-fit:cover}
#photo-status{min-height:1em;font-size:13px}
.skin{width:36px;height:36px;min-width:36px;padding:0;border:2px solid rgba(255,255,255,.45);border-radius:50%;background:var(--swatch);box-shadow:none}
.skin.selected{border-color:#fff;outline:2px solid var(--swatch);outline-offset:3px}
.skin:disabled{opacity:.35;filter:grayscale(1);cursor:not-allowed}
</style>
</head>
<body>
<canvas id="c"></canvas>
<button id="pb" aria-label="Pause">Pause</button>
<section class="panel on" id="menu">
<h1>Neon<br>Swarm</h1>
<p>Survive 30 fixed formations. Bosses guard waves 5–10, then return for the wave-30 finale. Collect health to reach 500 HP; the final wave grants 10,000 HP and 10,000 damage shots.</p>
<p>Move with WASD, arrow keys or by dragging. Dash with Space, Shift or a quick tap. P pauses and M mutes.</p>
<p id="profile"></p><div id="skins" aria-label="Ship skins"></div>
<div id="photo-controls"><img id="photo-preview" alt="Uploaded player photo" hidden><button class="alt" id="upload-photo" type="button">Upload photo</button><button class="alt" id="remove-photo" type="button" hidden>Remove</button><input id="photo-file" type="file" accept=".png,.jpg,.jpeg,.heic,.heif,image/png,image/jpeg,image/heic,image/heif" hidden></div>
<p id="photo-status" role="status" aria-live="polite"></p>
<ol class="board" id="b0"></ol>
<button id="play">Start run</button>
</section>
<section class="panel" id="pause"><h2>Paused</h2><button id="resume">Resume</button><button class="alt" id="quit">Quit to menu</button></section>
<section class="panel" id="over"><h2 id="ovt">Signal lost</h2><div id="sc"></div><ol class="board" id="b1"></ol><div id="sv" hidden><input id="nm" maxlength="12" placeholder="Your name" autocomplete="off"><button class="alt" id="sub">Submit score</button></div><button id="again">Play again</button><button class="alt" id="home">Menu</button></section>
<script>
'use strict';
/* ================= CONFIG & HELPERS ================= */
const VIEW=560,TAU=Math.PI*2,FONT='"Syne","Trebuchet MS",system-ui,sans-serif'; // VIEW = logical units on the short screen side
const COL={cyan:'#3df5ff',pink:'#ff3d9a',gold:'#ffc23d',vio:'#9b5cff',mint:'#6dffb0'};
const MAX_WAVE=30;
const BOSS_HP={5:4500,6:25000,7:50000,8:75000,9:100000,10:100000,30:1000000};
const SKINS=[{id:'cyan',name:'Neon',color:COL.cyan,cost:0},{id:'gold',name:'Solar',color:COL.gold,cost:250},{id:'mint',name:'Mint',color:COL.mint,cost:650},{id:'pink',name:'Pulse',color:COL.pink,cost:1100},{id:'nova',name:'Nova',color:'#ff3df5',cost:0,winOnly:true}];
const TYPES={drone:{hp:1,r:9,spd:95,pts:10,col:COL.pink,n:4,gems:1},shooter:{hp:5,r:12,spd:78,pts:45,col:COL.gold,n:3,gems:2},tank:{hp:9,r:19,spd:42,pts:70,col:COL.vio,n:8,gems:4},lancer:{hp:2,r:10,spd:70,pts:25,col:'#ff7a1a',n:3,gems:2},spinner:{hp:7,r:15,spd:55,pts:60,col:'#5b8cff',n:6,gems:3},bomber:{hp:2,r:11,spd:120,pts:30,col:'#ff4d4d',n:5,gems:2},boss:{hp:1000000,r:52,spd:0,pts:50000,col:'#ff3df5',n:10,gems:80}};
const PAT=[[0],[-.07,.07],[-.17,0,.17],[-.22,-.08,.08,.22],[-.32,-.16,0,.16,.32]]; // shot spread per weapon level
const $=id=>document.getElementById(id),rnd=(a,b)=>a+Math.random()*(b-a),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const cv=$('c'),ctx=cv.getContext('2d');
let view={cw:1,ch:1,dpr:1,s:1,w:VIEW,h:VIEW},bg;

/* ================= STORAGE (top 5 scores) ================= */
const Store={key:'neonswarm.scores',
  load(){try{const a=JSON.parse(localStorage.getItem(this.key));return Array.isArray(a)?a.slice(0,5):[]}catch(e){return[]}},
  save(a){try{localStorage.setItem(this.key,JSON.stringify(a))}catch(e){}}};
const Profile={key:'neonswarm.profile',data:null,image:null,
  init(){let saved={};try{saved=JSON.parse(localStorage.getItem(this.key))||{}}catch(e){}
    this.data={credits:Number.isFinite(saved.credits)?Math.max(0,saved.credits):0,unlocked:Array.isArray(saved.unlocked)?saved.unlocked.filter(id=>SKINS.some(s=>s.id===id)):['cyan'],skin:SKINS.some(s=>s.id===saved.skin)?saved.skin:'cyan',photo:typeof saved.photo==='string'&&saved.photo.startsWith('data:image/png;base64,')?saved.photo:''};
    if(!this.data.unlocked.includes('cyan'))this.data.unlocked.push('cyan');this.render();if(this.data.photo)this.loadSavedPhoto()},
  save(){try{localStorage.setItem(this.key,JSON.stringify(this.data));return true}catch(e){return false}},
  color(){return SKINS.find(s=>s.id===this.data.skin)?.color||COL.cyan},
  render(){const host=$('skins');if(!host)return;host.replaceChildren();
    for(const skin of SKINS){const owned=this.data.unlocked.includes(skin.id),button=document.createElement('button');button.type='button';button.className='skin'+(this.data.skin===skin.id?' selected':'');button.style.setProperty('--swatch',skin.color);button.disabled=!owned&&(skin.winOnly||this.data.credits<skin.cost);button.title=owned?skin.name:skin.winOnly?'Win the campaign to unlock':skin.name+' costs '+skin.cost+' credits';button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(this.data.skin===skin.id));
      button.onclick=()=>{if(!owned){if(skin.winOnly||this.data.credits<skin.cost)return;this.data.credits-=skin.cost;this.data.unlocked.push(skin.id)}this.data.skin=skin.id;this.save();this.render()};host.append(button)}
    $('profile').textContent='Credits '+this.data.credits+' | '+SKINS.find(s=>s.id===this.data.skin).name+' ship';this.renderPhoto()},
  renderPhoto(){const preview=$('photo-preview');if(!preview)return;const hasPhoto=Boolean(this.data.photo);if(hasPhoto){preview.src=this.data.photo;preview.hidden=false}else{preview.removeAttribute('src');preview.hidden=true}$('remove-photo').hidden=!hasPhoto},
  decodeImage(source){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Image decode failed'));image.src=source})},
  async decodeFile(file){if(typeof createImageBitmap==='function'){try{return await createImageBitmap(file)}catch(e){}}
    const url=URL.createObjectURL(file);try{return await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Image format is not supported by this browser'));image.src=url})}finally{URL.revokeObjectURL(url)}},
  async loadHeicConverter(){if(window.heic2any)return;await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';script.onload=resolve;script.onerror=()=>reject(new Error('HEIC converter unavailable'));document.head.append(script)});if(!window.heic2any)throw new Error('HEIC converter unavailable')},
  async loadSavedPhoto(){try{this.image=await this.decodeImage(this.data.photo)}catch(e){this.data.photo='';this.save();this.renderPhoto()}},
  async setPhoto(file){if(!file)return;const status=$('photo-status'),extension=file.name.split('.').pop().toLowerCase(),heic=extension==='heic'||extension==='heif'||file.type==='image/heic'||file.type==='image/heif';
    if(!['png','jpg','jpeg','heic','heif'].includes(extension)&&!['image/png','image/jpeg','image/heic','image/heif'].includes(file.type)){status.textContent='Choose a PNG, JPG, JPEG, or HEIC image.';return}
    if(file.size>12*1024*1024){status.textContent='Image must be 12 MB or smaller.';return}
    try{let image;try{image=await this.decodeFile(file)}catch(e){if(!heic)throw e;await this.loadHeicConverter();let converted=await window.heic2any({blob:file,toType:'image/png'});if(Array.isArray(converted))converted=converted[0];image=await this.decodeFile(converted)}
      const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight,side=Math.min(width,height),canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
      canvas.getContext('2d').drawImage(image,(width-side)/2,(height-side)/2,side,side,0,0,128,128);if(image.close)image.close();this.data.photo=canvas.toDataURL('image/png');this.image=await this.decodeImage(this.data.photo);const saved=this.save();this.renderPhoto();status.textContent=saved?'Photo saved in this browser.':'Photo loaded, but browser storage is full.'
    }catch(e){status.textContent=heic?'Could not decode HEIC here. Try JPEG or a browser with HEIC support.':'Could not read that image.'}},
  clearPhoto(){this.data.photo='';this.image=null;this.save();this.renderPhoto();$('photo-status').textContent=''},
  reward(wave){this.data.credits+=wave*150;this.save();this.render()},
  victory(){if(!this.data.unlocked.includes('nova'))this.data.unlocked.push('nova');this.data.credits+=750;this.save();this.render()}};
function board(el,list,mine){el.innerHTML=list.map(v=>{const o=typeof v==='object'?v:{n:'',s:v};return'<li'+(o.s===mine?' class="me"':'')+'><span>'+String(o.n).replace(/[^\w -]/g,'')+'</span><b>'+o.s.toLocaleString()+'</b></li>'}).join('')}

/* ================= AUDIO (Web Audio synth, no assets) ================= */
const Sfx={ctx:null,muted:false,
  init(){if(this.ctx){if(this.ctx.state==='suspended')this.ctx.resume();return}
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    try{const c=this.ctx=new AC();this.out=c.createDynamicsCompressor();this.out.connect(c.destination);
      const n=c.sampleRate>>1,b=c.createBuffer(1,n,c.sampleRate),d=b.getChannelData(0);for(let i=0;i<n;i++)d[i]=Math.random()*2-1;this.nb=b}catch(e){this.ctx=null}},
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

/* ================= FX: particles, rings, floating text, shake ================= */
const FX={parts:[],texts:[],rings:[],shake:0,flash:0,
  burst(x,y,col,n,spd,life,size){if(this.parts.length>700)return;for(let i=0;i<n;i++){const a=rnd(0,TAU),s=rnd(.2,1)*spd;this.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:life*rnd(.5,1),max:life,size:size*rnd(.6,1.4),col})}},
  text(x,y,s,col,size){this.texts.push({x,y,s,col,size,life:.9,max:.9})},
  ring(x,y,max,col){this.rings.push({x,y,r:4,max,col,life:.5,max_t:.5})},
  hit(m){this.shake=Math.max(this.shake,reduce?m*.4:m)},
  update(dt){const f=Math.pow(.02,dt);
    for(const p of this.parts){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=f;p.vy*=f}
    for(const t of this.texts){t.life-=dt;t.y-=45*dt}
    for(const r of this.rings){r.life-=dt;r.r+=(r.max-r.r)*Math.min(1,dt*7)}
    this.parts=this.parts.filter(p=>p.life>0);this.texts=this.texts.filter(t=>t.life>0);this.rings=this.rings.filter(r=>r.life>0);
    this.shake=Math.max(0,this.shake-dt*40);this.flash=Math.max(0,this.flash-dt*2.2)},
  draw(c,S){c.shadowBlur=0;c.globalCompositeOperation='lighter'; // additive blending = glow
    for(const p of this.parts){const a=p.life/p.max;c.globalAlpha=a;c.fillStyle=p.col;c.beginPath();c.arc(p.x,p.y,p.size*(.4+a*.6),0,TAU);c.fill()}
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
    addEventListener('keydown',e=>{const k=e.code;if(e.target.tagName==='INPUT'){if(k==='Enter')$('sub').click();return}if(k.startsWith('Arrow')||k==='Space')e.preventDefault();this.keys[k]=true;Sfx.init();
      if(k==='Space'||k.startsWith('Shift'))this.dash=true;
      if(k==='KeyP'||k==='Escape')Game.state==='play'?Game.pause():Game.resume();
      if(k==='Enter'&&(Game.state==='menu'||Game.state==='over'))Game.start();
      if(k==='KeyM')Sfx.muted=!Sfx.muted});
    addEventListener('keyup',e=>{this.keys[e.code]=false});
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
    cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up)}};

/* ================= GAME STATE & RULES ================= */
const Game={state:'menu',time:0,best:0,p:null,
  reset(){Object.assign(this,{score:0,combo:0,comboT:0,mult:1,wave:1,betweenWaves:false,waveDelay:0,xp:0,need:8,lvl:1,timeScale:1,dieT:0,hitT:0,enemies:[],bullets:[],eb:[],gems:[],pu:[],won:false});
    this.p={x:view.w/2,y:view.h*.82,vx:0,vy:0,r:11,hp:200,maxHp:200,fireT:.12,dashT:0,dashCd:0,inv:1,aim:-1.57,face:-1.57,dx:0,dy:-1,dead:false,shield:0,rapid:0};
    FX.parts=[];FX.texts=[];FX.rings=[];FX.shake=0;FX.flash=0},
  set(s){this.state=s;for(const id of['menu','pause','over'])$(id).classList.toggle('on',id===s);$('pb').style.display=s==='play'?'block':'none';
    if(document.activeElement&&document.activeElement.blur)document.activeElement.blur()},
  start(){Sfx.init();Input.dash=false;Input.ptr=null;this.reset();this.spawnWave();Sfx.play('start');FX.text(view.w/2,view.h*.3,'Wave 1 / '+MAX_WAVE,COL.cyan,34);this.set('play')},
  pause(){if(this.state==='play'){Input.ptr=null;this.set('pause')}},
  resume(){if(this.state==='pause'){Input.dash=false;this.set('play')}},
  goMenu(){this.p=null;board($('b0'),Store.load(),-1);Net.get().then(s=>s&&board($('b0'),s,-1));this.set('menu')},
  over(){const list=Store.load(),hi=this.score>0&&this.score>(list[0]||0);
    list.push(this.score);list.sort((a,b)=>b-a);list.length=Math.min(list.length,5);Store.save(list);this.best=list[0];
    $('ovt').textContent=this.won?'Campaign complete!':hi?'New best score!':'Signal lost';$('sc').textContent='Score '+this.score.toLocaleString()+', reached wave '+this.wave+' / '+MAX_WAVE;
    board($('b1'),list,this.score);Sfx.play(hi?'win':'lose');$('sv').hidden=!Net.on||this.score<=0;$('sub').disabled=false;try{$('nm').value=localStorage.getItem('neonswarm.name')||$('nm').value}catch(e){}this.set('over')},
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
    if(this.comboT>0&&(this.comboT-=dt)<=0){this.combo=0;this.mult=1}
    for(const e of this.enemies){const dx=p.x-e.x,dy=p.y-e.y,a=Math.atan2(dy,dx);e.flash-=dt;e.ang+=dt*(e.k==='tank'?1:3);if(dying||!this.onScreen(e))continue;
      if(e.k==='boss'){const bossDamage=this.wave===30?100:10;e.t+=dt;e.sa+=dt*.9;if((e.fireT-=dt)<=0){e.fireT=.2;for(let i=0;i<3;i++){const shot=e.sa+i*TAU/3;this.eb.push({x:e.x,y:e.y,vx:Math.cos(shot)*205,vy:Math.sin(shot)*205,life:6,damage:bossDamage})}}if(e.t>2.6){e.t=0;for(let i=-4;i<=4;i++){const shot=a+i*.13;this.eb.push({x:e.x,y:e.y,vx:Math.cos(shot)*265,vy:Math.sin(shot)*265,life:6,damage:bossDamage})}}}
      else if((e.fireT-=dt)<=0){let shots=1,spread=0,speed=190,interval=2.4;
        if(e.k==='shooter'){shots=this.wave>=4?5:this.wave>=2?3:1;spread=.18;speed=260;interval=Math.max(.75,1.65-this.wave*.12)}
        else if(e.k==='spinner'){shots=5;spread=TAU/5;speed=175;interval=1.45;e.sa+=.37}
        else if(e.k==='lancer'){speed=330;interval=1.7}
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
      if((b.x-e.x)**2+(b.y-e.y)**2<r*r){b.life=0;this.damage(e,this.wave===30?10000:Math.min(500,20*this.lvl*this.lvl));FX.burst(b.x,b.y,TYPES[e.k].col,3,150,.25,2)}}
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
    if(Math.hypot(p.vx,p.vy)>40)FX.burst(p.x-Math.cos(p.face)*10,p.y-Math.sin(p.face)*10,COL.cyan,1,30,.3,2.4);
    let near=null,nd=1e9;for(const e of this.enemies){const d=(e.x-p.x)**2+(e.y-p.y)**2;if(d<nd&&this.onScreen(e)){nd=d;near=e}}
    p.aim=near?Math.atan2(near.y-p.y,near.x-p.x):p.face;
    if((p.fireT-=dt)<=0&&near){p.fireT=Math.max(.045,.18-this.lvl*.022-(p.rapid>0?.07:0));Sfx.play('shoot');
      for(const o of PAT[this.lvl-1])this.bullets.push({x:p.x,y:p.y,vx:Math.cos(p.aim+o)*650,vy:Math.sin(p.aim+o)*650,life:1.1})}},
  add(k,x,y,hp){const T=TYPES[k],health=hp||T.hp;this.enemies.push({k,x,y,hp:health,mhp:health,r:T.r,fireT:rnd(.4,1.5),t:0,sa:rnd(0,TAU),flash:0,ang:rnd(0,TAU)})},
  spawnWave(){const W=view.w,cols=Math.min(5,Math.max(3,Math.floor((W-80)/100)));
    const formations=[[],['drone','drone','drone','drone','drone'],['drone','shooter','drone','shooter','drone','drone'],['drone','shooter','spinner','shooter','lancer','drone','bomber','drone'],['shooter','tank','bomber','spinner','shooter','bomber','lancer','shooter','tank'],[],['shooter','spinner','tank','bomber','lancer','shooter','spinner','tank','bomber','drone','lancer','shooter'],['tank','shooter','spinner','bomber','lancer','tank','shooter','spinner','bomber','lancer','tank','shooter','bomber','spinner'],['spinner','tank','bomber','shooter','lancer','spinner','tank','bomber','shooter','lancer','spinner','tank','bomber','shooter','lancer','tank'],['tank','spinner','bomber','shooter','lancer','tank','spinner','bomber','shooter','lancer','tank','spinner','bomber','shooter','lancer','tank','spinner','bomber']];
    const healthDrops=this.wave===5?20:this.wave===29?30:0;
    for(let i=0;i<healthDrops;i++){const row=Math.floor(i/6);this.pu.push({x:W*(.1+(i%6)*.16),y:view.h*(.57+row*.065),k:'life',t:45,a:0})}
    const bossHealth=BOSS_HP[this.wave];if(bossHealth){const final=this.wave===30;this.add('boss',W/2,view.h*.22,bossHealth);if(final){this.enemies[this.enemies.length-1].r=88;this.p.maxHp=10000;this.p.hp=10000}this.p.shield=10;FX.text(W/2,view.h*.31,'BOSS SHIELD 10s',COL.cyan,24);
      const guards=final?['shooter','spinner','tank','bomber','shooter','spinner','tank','bomber']:this.wave>=6&&this.wave<=9?['shooter','spinner','tank','bomber','shooter','spinner']:['shooter','spinner','shooter','spinner'];guards.forEach((k,i)=>this.add(k,W/2+(i-(guards.length-1)/2)*Math.min(105,(W-90)/Math.max(1,guards.length-1)),view.h*.43));
      FX.text(W/2,view.h*.38,final?'FINAL BOSS':'WAVE '+this.wave+' BOSS',COL.pink,30);return}
    const enemyKinds=['drone','shooter','spinner','tank','bomber','lancer'];
    const kinds=this.wave>=11?Array.from({length:Math.min(30,this.wave+5)},(_,i)=>enemyKinds[(i*3+this.wave)%enemyKinds.length]):formations[this.wave];
    const rows=Math.ceil(kinds.length/cols),rowGap=Math.min(88,(view.h-140)/Math.max(1,rows-1)),startY=Math.max(48,(view.h-rowGap*(rows-1))*.22);
    kinds.forEach((k,i)=>{const row=Math.floor(i/cols),rowKinds=Math.min(cols,kinds.length-row*cols),col=i%cols,gap=Math.min(110,(W-100)/Math.max(1,rowKinds-1));this.add(k,W/2+(col-(rowKinds-1)/2)*gap,startY+row*rowGap)})},
  clearWave(){this.betweenWaves=true;this.waveDelay=2;const reward=this.wave*150;this.score+=this.wave*250;Profile.reward(this.wave);FX.text(view.w/2,view.h*.32,'WAVE CLEAR  +'+reward+' CREDITS',COL.gold,25)},
  victory(){this.won=true;this.score+=2500;Profile.victory();this.over()},
  damage(e,n){e.hp-=n;e.flash=.08;if(this.time-this.hitT>.05){this.hitT=this.time;Sfx.play('hit')}if(e.hp<=0&&!e.dead)this.kill(e)},
  kill(e){e.dead=true;const T=TYPES[e.k],old=this.mult;
    this.combo++;this.comboT=2.6;this.mult=Math.min(8,1+Math.floor(this.combo/5));
    const pts=T.pts*this.mult;this.score+=pts;
    FX.burst(e.x,e.y,T.col,T.n*5,300,.7,3.2);FX.burst(e.x,e.y,'#fff',6,200,.35,2);FX.hit(e.k==='tank'?9:4);Sfx.play('boom');
    FX.text(e.x,e.y-12,'+'+pts,T.col,e.k==='tank'?24:16);
    if(this.mult>old)FX.text(this.p.x,this.p.y-32,'Combo x'+this.mult,COL.pink,20);
    if(e.k==='tank'){FX.ring(e.x,e.y,90,T.col);for(let i=0;i<3;i++)this.add('drone',e.x+rnd(-14,14),e.y+rnd(-14,14))} // tanks split into drones
    for(let i=0;i<T.gems;i++)this.gems.push({x:e.x,y:e.y,vx:rnd(-130,130),vy:rnd(-130,130),a:rnd(0,TAU)});
    if(e.k==='bomber')for(let i=0;i<8;i++){const a=i*TAU/8;this.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*170,vy:Math.sin(a)*170,life:5})} // bombers burst into a bullet ring
    if(e.k==='boss'){this.eb.length=0;FX.flash=.6;FX.hit(22);FX.ring(e.x,e.y,Math.max(view.w,view.h),T.col);Sfx.play('win')}
    if(e.k==='boss'||Math.random()<.07)this.pu.push({x:e.x,y:e.y,k:e.k==='boss'?'life':['shield','bomb','life','rapid'][Math.floor(rnd(0,4))],t:12,a:0})},
  gem(g){this.score+=5*this.mult;Sfx.play('gem',this.combo);FX.burst(g.x,g.y,COL.mint,4,120,.3,2);
    if(++this.xp>=this.need){this.xp=0;this.need+=4;this.levelUp()}},
  levelUp(){const p=this.p;
    if(this.lvl<5){this.lvl++;FX.text(p.x,p.y-30,'Weapon up!',COL.gold,22)}else{const bonus=200*this.mult;this.score+=bonus;FX.text(p.x,p.y-30,'+'+bonus,COL.gold,22)}
    this.blast(2,COL.gold);Sfx.play('up');
    
    },
  blast(n,col){FX.ring(this.p.x,this.p.y,Math.max(view.w,view.h)*.7,col);FX.hit(8); // shockwave: damage first so bomber rings get wiped too
    for(const e of this.enemies)if(!e.dead)this.damage(e,n);
    for(const b of this.eb)FX.burst(b.x,b.y,COL.pink,2,80,.3,2);this.eb.length=0},
  power(u){const p=this.p,m={shield:['Shield',COL.cyan],bomb:['Nova bomb',COL.gold],life:['Health +25',COL.pink],rapid:['Rapid fire',COL.mint]}[u.k];
    if(u.k==='shield')p.shield=Math.max(p.shield,8);else if(u.k==='bomb')this.blast(8,COL.gold);else if(u.k==='rapid')p.rapid=Math.max(p.rapid,8);else{p.maxHp=Math.min(this.wave===30?10000:500,p.maxHp+25);p.hp=p.maxHp}
    FX.text(p.x,p.y-34,m[0],m[1],20);FX.burst(p.x,p.y,m[1],18,260,.5,3);Sfx.play('up')},
  hurt(amount=5){const p=this.p;if(p.shield>0){p.inv=.25;FX.ring(p.x,p.y,110,COL.cyan);FX.burst(p.x,p.y,COL.cyan,8,160,.3,2);FX.hit(3);Sfx.play('hit');for(const b of this.eb)b.life=0;return}p.hp=Math.max(0,p.hp-amount);p.inv=1.1;this.combo=0;this.mult=1;this.comboT=0;
    FX.hit(14);FX.flash=1;FX.burst(p.x,p.y,COL.pink,26,320,.7,3.5);FX.ring(p.x,p.y,130,COL.pink);Sfx.play('hurt');
    for(const b of this.eb)b.life=0;if(p.hp<=0)this.die()},
  die(){const p=this.p;p.dead=true;this.state='dying';this.dieT=0;$('pb').style.display='none';
    FX.burst(p.x,p.y,COL.cyan,70,430,1.1,4);FX.hit(18);Sfx.play('boom')}};

/* ================= RENDERING ================= */
function poly(c,x,y,r,n,a){for(let i=0;i<n;i++){const t=a+i*TAU/n,px=x+Math.cos(t)*r,py=y+Math.sin(t)*r;i?c.lineTo(px,py):c.moveTo(px,py)}c.closePath()}
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
      const shipColor=Profile.color();
      if(Profile.image){c.save();c.translate(p.x,p.y);c.beginPath();c.arc(0,0,14,0,TAU);c.clip();c.drawImage(Profile.image,-14,-14,28,28);c.restore();gl(shipColor,22);c.strokeStyle=shipColor;c.lineWidth=3;c.beginPath();c.arc(p.x,p.y,14,0,TAU);c.stroke()}
      else{c.save();c.translate(p.x,p.y);c.rotate(p.aim);c.beginPath();c.moveTo(17,0);c.lineTo(-11,-11);c.lineTo(-5,0);c.lineTo(-11,11);c.closePath();gl(shipColor,22);c.fillStyle='#0d0524';c.strokeStyle=shipColor;c.lineWidth=3;c.fill();c.stroke();c.restore()}
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
    const hpw=Math.min(180,view.cw*.48),hpy=view.ch-17;c.shadowBlur=0;c.textAlign='left';c.font='700 '+fs*.72+'px '+FONT;c.fillStyle=p.hp/p.maxHp<.3?COL.pink:COL.mint;c.fillText('HP  '+Math.ceil(p.hp)+' / '+p.maxHp,16,hpy-10);c.fillStyle='rgba(255,255,255,.16)';c.fillRect(16,hpy-7,hpw,7);c.fillStyle=p.hp/p.maxHp<.3?COL.pink:COL.mint;c.fillRect(16,hpy-7,hpw*clamp(p.hp/p.maxHp,0,1),7);
    if(p.shield>0){c.textAlign='right';c.fillStyle=COL.cyan;c.font='700 '+fs*.72+'px '+FONT;c.fillText('SHIELD '+Math.ceil(p.shield)+'s',view.cw-16,view.ch-10)}
    const q=Input.ptr;if(q&&G.state==='play'){c.shadowBlur=0;c.strokeStyle='rgba(255,255,255,.22)';c.lineWidth=2;c.beginPath();c.arc(q.x0,q.y0,60,0,TAU);c.stroke();
      c.fillStyle='rgba(61,245,255,.35)';c.beginPath();c.arc(q.x,q.y,22,0,TAU);c.fill()}}
}

/* ================= BOOT: resize + delta-time loop ================= */
function resize(){const cw=cv.clientWidth||innerWidth,ch=cv.clientHeight||innerHeight,dpr=Math.min(devicePixelRatio||1,2),s=Math.min(cw,ch)/VIEW;
  cv.width=Math.round(cw*dpr);cv.height=Math.round(ch*dpr);view={cw,ch,dpr,s,w:cw/s,h:ch/s};
  bg=ctx.createRadialGradient(cv.width/2,cv.height/2,0,cv.width/2,cv.height/2,Math.max(cv.width,cv.height)*.7);bg.addColorStop(0,'#220c52');bg.addColorStop(1,'#07021a');
  const p=Game.p;if(p){p.x=clamp(p.x,p.r,view.w-p.r);p.y=clamp(p.y,p.r,view.h-p.r)}}
let last=0;
function frame(t){requestAnimationFrame(frame);const dt=Math.min((t-last)/1000||0,.05);last=t;Game.tick(dt);draw()} // dt-based, any refresh rate
addEventListener('resize',resize);
$('play').onclick=()=>Game.start();$('again').onclick=()=>Game.start();$('resume').onclick=()=>Game.resume();
$('quit').onclick=()=>Game.goMenu();$('home').onclick=()=>Game.goMenu();$('pb').onclick=()=>Game.pause();
$('upload-photo').onclick=()=> $('photo-file').click();
$('photo-file').onchange=async e=>{await Profile.setPhoto(e.target.files[0]);e.target.value=''};
$('remove-photo').onclick=()=>Profile.clearPhoto();
const Net={on:false, // optional Python leaderboard: only present when served by neon_swarm.py
  async get(){try{const r=await fetch('api/scores');if(!r.ok)throw 0;const j=await r.json();this.on=true;return j.scores}catch(e){this.on=false;return null}},
  async post(n,s){try{const r=await fetch('api/scores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,score:s})});return r.ok?(await r.json()).scores:null}catch(e){return null}}};
$('sub').onclick=async()=>{const n=$('nm').value.trim().slice(0,12)||'Player';$('sub').disabled=true;try{localStorage.setItem('neonswarm.name',n)}catch(e){}
  const s=await Net.post(n,Game.score);$('sub').disabled=false;if(s){board($('b1'),s,Game.score);$('sv').hidden=true}};
Profile.init();Input.bind();resize();Game.best=Store.load()[0]||0;board($('b0'),Store.load(),-1);Net.get().then(s=>s&&board($('b0'),s,-1));requestAnimationFrame(frame);
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

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            self.send_body(200, GAME_HTML, "text/html")
        elif path == "/api/scores":
            self.send_body(200, json.dumps({"scores": load_scores()}))
        else:
            self.send_body(404, '{"error":"not found"}')

    def do_POST(self):
        if self.path.split("?")[0] != "/api/scores":
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
            if not 0 < score < 10_000_000:
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

    def log_message(self, fmt, *args):
        pass  # keep the console quiet


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # sends nothing; just picks the outbound interface
            return s.getsockname()[0]
    except OSError:
        return None


def main():
    ap = argparse.ArgumentParser(description="Neon Swarm game server")
    ap.add_argument("--port", type=int, default=8000, help="first port to try (default 8000)")
    ap.add_argument("--lan", action="store_true", help="listen on your network so phones can play")
    ap.add_argument("--no-browser", action="store_true", help="do not open a browser tab")
    args = ap.parse_args()

    host = "0.0.0.0" if args.lan else "127.0.0.1"
    server = None
    for port in range(args.port, args.port + 20):  # fall back to the next free port
        try:
            server = ThreadingHTTPServer((host, port), Handler)
            break
        except OSError:
            continue
    if server is None:
        raise SystemExit("No free port found. Try: python neon_swarm.py --port 9000")

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
