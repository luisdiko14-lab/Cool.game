(() => {
'use strict';
const core = window.NeonSwarmCore;
if (!core || !core.Game || window.NeonSwarmRound2Loaded) return;
window.NeonSwarmRound2Loaded = true;
const Game = core.Game, Profile = core.Profile, FX = core.FX;
const KEY = 'neonswarm.round2.v1';
const $ = (id) => document.getElementById(id);
const safe = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base = {
  campaign:{unlocked:0,completed:[],active:null},
  map:{seed:0,theme:'NEON RUINS',obstacles:[],secrets:[],found:[]},
  drones:[],materials:{scrap:0,crystal:0,core:0},mods:{damage:0,armor:0,rate:0},
  mutations:{seen:0},season:{id:'',xp:0,claimed:[]},
  replays:[],customs:[],tradeInventory:[],event:{id:'',kills:0,contributed:0,claimed:false}
};
function loadState(){
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {...base,...value,
      campaign:{...base.campaign,...value.campaign},
      map:{...base.map,...value.map},
      materials:{...base.materials,...value.materials},
      mods:{...base.mods,...value.mods},
      mutations:{...base.mutations,...value.mutations},
      season:{...base.season,...value.season},
      event:{...base.event,...value.event}};
  } catch (_) { return JSON.parse(JSON.stringify(base)); }
}
const S = loadState();
const dateKey = () => new Date().toISOString().slice(0,10);
const monthKey = () => new Date().toISOString().slice(0,7);
if (S.season.id !== monthKey()) S.season = {id:monthKey(),xp:0,claimed:[]};
function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(_){}}
function credits(){return Math.max(0,Number(Profile.data && Profile.data.credits)||0)}
function pay(amount){if(!Profile.data||credits()<amount)return false;Profile.data.credits-=amount;Profile.save&&Profile.save();Profile.render&&Profile.render();return true}
function reward(amount){if(!Profile.data)return;Profile.data.credits=(Number(Profile.data.credits)||0)+amount;Profile.save&&Profile.save();Profile.render&&Profile.render()}
function shout(text,color){if(Game.p&&FX&&FX.text)FX.text(Game.p.x,Game.p.y-34,text,color||'#55f3ff',15)}
const missions = [
  {id:'signal',title:'01 · LOST SIGNAL',subtitle:'Find the source of the distress beacon.',wave:2,lines:['Pilot, this is Command. We lost contact with Outpost N-7.','The swarm is already inside the perimeter. Clear the landing zone.'],done:'Outpost N-7 is secure. The survivors found your beacon.'},
  {id:'relay',title:'02 · BROKEN RELAY',subtitle:'Destroy the relay guard and restore the uplink.',wave:5,lines:['The relay is guarded by an armoured signal carrier.','Keep moving. Its cannon tracks the last known position.'],done:'Relay restored. A strange signal is coming from below the city.'},
  {id:'vault',title:'03 · THE HIDDEN VAULT',subtitle:'Push through the vault defenders.',wave:12,lines:['The map data points to a vault beneath the Neon Ruins.','Something has been manufacturing the mutated swarm here.'],done:'The vault is open. You recovered a fragment of the Swarm Core.'},
  {id:'citadel',title:'04 · FALL OF THE CITADEL',subtitle:'Break the Citadel siege line.',wave:30,lines:['The Citadel shields are failing. You are our last pilot.','The swarm is adapting. Expect elite mutations.'],done:'The Citadel is quiet. The core has moved to the central hive.'},
  {id:'core',title:'05 · HEART OF THE SWARM',subtitle:'Defeat the final storyline boss.',wave:60,lines:['This is it. The signal is the hive mind.','Destroy the Heart of the Swarm and end the invasion.'],done:'The Heart has gone dark. The Neon Swarm is over.'}
];
let activeTab='story',panel=null,dialog=null,dialogDone=null,serverRows=[],marketRows=[],eventInfo=null;
let pendingRun=null,runStartAt=0,remoteChallenges=[],replayFrames=[],replayAccumulator=0,replayTimer=null,replayIndex=0,replaySpeed=1,replayCamera='follow';
let droneClocks={},mutationClock=0,lastEventSend=0,room=null,roomTimer=null,remotePlayers=[],marketToken=localStorage.getItem('neonswarm.market-token')||'';
let round2Overlay=null,overlayCtx=null,overlayScale=1,overlayWidth=0,overlayHeight=0,overlayRaf=0;
const themes=['NEON RUINS','FROST GRID','VOID GARDEN','SOLAR FOUNDRY','ABYSSAL LAB'];
function rng(seed){let x=(seed>>>0)||1;return()=>{x=(x*1664525+1013904223)>>>0;return x/4294967296}}
function generateMap(seed){
  const rand=rng(seed||Math.floor(Math.random()*0xffffffff)),theme=themes[Math.floor(rand()*themes.length)],view=core.getView();
  const obstacles=[];
  for(let i=0;i<12;i++){
    const w=26+rand()*55,h=22+rand()*50,x=42+rand()*Math.max(1,view.w-84-w),y=70+rand()*Math.max(1,view.h-140-h);
    obstacles.push({x,y,w,h,kind:rand()>.5?'crystal':'wall'});
  }
  const secrets=[];
  for(let i=0;i<3;i++)secrets.push({x:55+rand()*Math.max(1,view.w-110),y:70+rand()*Math.max(1,view.h-140),found:false});
  S.map={seed:seed||Math.floor(Math.random()*0xffffffff),theme,obstacles,secrets,found:[]};
  save();
}
function ensureMap(){
  const view=core.getView();
  if(!S.map.seed||!Array.isArray(S.map.obstacles)||!S.map.obstacles.length)generateMap();
  if(view.w>0&&view.h>0&&S.map.obstacles.length&&S.map.obstacles.some(o=>o.x>view.w||o.y>view.h))generateMap(S.map.seed);
}
function clampPlayerOffWalls(){
  const p=Game.p;if(!p||!S.map.obstacles)return;
  for(const o of S.map.obstacles){
    const nx=Math.max(o.x,Math.min(p.x,o.x+o.w)),ny=Math.max(o.y,Math.min(p.y,o.y+o.h));
    const dx=p.x-nx,dy=p.y-ny,d=Math.hypot(dx,dy);
    if(d<p.r+5){const angle=d?Math.atan2(dy,dx):Math.random()*Math.PI*2;p.x=nx+Math.cos(angle)*(p.r+6);p.y=ny+Math.sin(angle)*(p.r+6)}
  }
  S.map.secrets.forEach((secret,i)=>{
    if(!S.map.found.includes(i)&&Math.hypot(secret.x-p.x,secret.y-p.y)<28){
      S.map.found.push(i);S.materials.crystal+=2;S.tradeInventory.push({id:'secret-'+Date.now()+'-'+i,name:'Vault Relic',rarity:'RARE',kind:'collectible'});
      shout('SECRET CACHE FOUND · +2 CRYSTALS','#ffc34d');save();
    }
  });
}
function openDialog(title,lines,onDone){
  if(!dialog){
    dialog=document.createElement('div');dialog.id='ns2-dialog';
    dialog.innerHTML='<div class="ns2-dialog-box"><div class="ns2-dialog-tag">NEON SWARM // STORY TRANSMISSION</div><div class="ns2-dialog-title"></div><div class="ns2-dialog-text"></div><div class="ns2-dialog-actions"><span class="ns2-dialog-step"></span><button id="ns2-dialog-next">CONTINUE</button></div></div>';
    document.body.append(dialog);dialog.querySelector('#ns2-dialog-next').onclick=()=>nextDialog();
  }
  dialog._lines=Array.isArray(lines)?lines:[String(lines)];dialog._index=0;dialogDone=onDone||null;
  dialog.querySelector('.ns2-dialog-title').textContent=title;
  dialog.classList.add('open');renderDialogLine();
  if(Game.state==='play')Game.pause();
}
function renderDialogLine(){
  if(!dialog)return;
  const i=dialog._index,n=dialog._lines.length;
  dialog.querySelector('.ns2-dialog-text').textContent=dialog._lines[i]||'';
  dialog.querySelector('.ns2-dialog-step').textContent=(i+1)+' / '+n;
  dialog.querySelector('#ns2-dialog-next').textContent=i+1>=n?'CONTINUE TO MISSION':'NEXT';
}
function nextDialog(){
  if(!dialog)return;
  if(dialog._index+1<dialog._lines.length){dialog._index++;renderDialogLine();return}
  dialog.classList.remove('open');const cb=dialogDone;dialogDone=null;if(cb)cb();else if(Game.state==='pause')Game.resume();
}
function completeMission(mission){
  if(!mission||S.campaign.completed.includes(mission.id))return;
  S.campaign.completed.push(mission.id);S.campaign.unlocked=Math.max(S.campaign.unlocked,missions.findIndex(x=>x.id===mission.id)+1);
  S.campaign.active=null;reward(350+missions.findIndex(x=>x.id===mission.id)*150);
  if(mission.id==='signal'&&!S.drones.includes('scout'))S.drones.push('scout');
  save();
  openDialog('MISSION COMPLETE · '+mission.title,[mission.done,'Command has transferred your mission reward.'],()=>{if(Game.state==='pause'||Game.state==='over')Game.goMenu();render()});
}
function startMission(mission){
  S.campaign.active=mission.id;pendingRun={kind:'story',mission:mission};save();
  Game.start();pendingRun=null;
  openDialog(mission.title,mission.lines,()=>{if(Game.state==='pause')Game.resume()});render();
}
function activeMission(){return missions.find(x=>x.id===S.campaign.active)||null}
function seededMutation(enemy){
  if(!enemy||enemy.k==='boss'||Game.wave<6)return;
  const chance=Math.min(.5,.08+(Game.wave-6)*.008);
  if(Math.random()>chance)return;
  const kinds=['ARMOURED','RIFT RUNNER','VOLATILE','REGENERATOR'];
  const kind=kinds[Math.floor(Math.random()*kinds.length)];
  enemy.nsMutation=kind;enemy.nsArmor=kind==='ARMOURED'?.48:0;enemy.nsSpeed=kind==='RIFT RUNNER'?1.55:1;
  enemy.nsRegen=kind==='REGENERATOR'?8:0;enemy.nsExplode=kind==='VOLATILE';
  enemy.hp*=1.45;enemy.mhp*=1.45;enemy.r+=2;S.mutations.seen++;save();
}
function recordFrame(){
  if(!Game.p||Game.state!=='play')return;
  const v=core.getView(),p=Game.p;
  replayFrames.push({t:Math.round((performance.now()-runStartAt)/100),x:p.x/Math.max(1,v.w),y:p.y/Math.max(1,v.h),hp:p.hp,score:Game.score,wave:Game.wave,enemies:(Game.enemies||[]).slice(0,60).map(e=>({x:e.x/Math.max(1,v.w),y:e.y/Math.max(1,v.h),k:e.k,hp:e.hp,mhp:e.mhp,mutation:e.nsMutation||''}))});
  if(replayFrames.length>360)replayFrames.shift();
}
function saveReplay(){
  if(replayFrames.length<3)return;
  const replay={id:'run-'+Date.now(),date:new Date().toISOString(),score:Number(Game.score)||0,wave:Number(Game.wave)||1,frames:replayFrames.slice(-360)};
  S.replays.unshift(replay);S.replays=S.replays.slice(0,5);save();replayFrames=[];
}
function tickDrones(dt){
  const p=Game.p;if(!p||!S.drones.length)return;
  const v=core.getView();
  S.drones.forEach((id,index)=>{
    const angle=(Game.time*1.45)+(index*Math.PI*2/S.drones.length),orbit=34+index*11;
    const dx=p.x+Math.cos(angle)*orbit,dy=p.y+Math.sin(angle)*orbit;
    if(id==='medic'){
      droneClocks[id]=(droneClocks[id]||0)+dt;
      if(droneClocks[id]>8&&p.hp<p.maxHp){droneClocks[id]=0;p.hp=Math.min(p.maxHp,p.hp+18);shout('MEDIC DRONE · +18 HULL','#6dffb0')}
    }else{
      droneClocks[id]=(droneClocks[id]||0)+dt;
      if(droneClocks[id]>1.1){droneClocks[id]=0;let target=null,dist=170*170;
        (Game.enemies||[]).forEach(e=>{if(e.dead)return;const d=(e.x-dx)**2+(e.y-dy)**2;if(d<dist){dist=d;target=e}});
        if(target)Game.damage(target,id==='striker'?Math.max(10,26+Game.wave*2):16);
      }
    }
    (Game.gems||[]).forEach(g=>{if(!g.dead&&Math.hypot(g.x-p.x,g.y-p.y)<115){g.x+=(p.x-g.x)*Math.min(1,dt*2);g.y+=(p.y-g.y)*Math.min(1,dt*2)}});
    if(id==='guardian'){
      const close=(Game.enemies||[]).find(e=>!e.dead&&Math.hypot(e.x-p.x,e.y-p.y)<45);
      if(close&&Math.random()<dt*1.8)Game.damage(close,12);
    }
  });
}
function updateSeason(kills){
  S.season.xp+=kills*(Game.enemies&&Game.enemies.some(e=>e.k==='boss')?15:5);
  save();
}
function seasonRewards(){
  const tiers=[{xp:100,label:'Neon Credits',amount:150,premium:false},{xp:250,label:'Prism Trail',amount:0,premium:true},{xp:400,label:'Neon Credits',amount:250,premium:false},{xp:650,label:'Vault Relic',amount:0,premium:true},{xp:900,label:'Neon Credits',amount:400,premium:false},{xp:1200,label:'Heartbreaker Skin',amount:0,premium:true}];
  return tiers;
}
function startCustom(index){
  const challenge=S.customs[index];if(!challenge)return;
  generateMap(challenge.seed);pendingRun={kind:'custom',challenge:challenge};Game.start();pendingRun=null;render();
}
function replayOverlay(replay){
  if(!replay)return;
  activeTab='replay';render();
  const content=$('ns2-content');if(!content)return;
  content.innerHTML='<div class="ns2-card"><strong>REPLAY THEATER</strong><p>Scrub the captured flight path, change playback speed and choose the camera.</p><canvas id="ns2-replay-canvas" width="960" height="420" style="display:block;width:100%;height:auto;max-height:42vh;background:#040617;border:1px solid #42dff766;border-radius:10px"></canvas><input id="ns2-replay-range" type="range" min="0" max="'+Math.max(0,replay.frames.length-1)+'" value="0"><div class="ns2-row"><button data-action="replay-play">PLAY</button><button data-action="replay-stop">PAUSE</button><select id="ns2-replay-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select><select id="ns2-replay-camera"><option value="follow">Follow pilot</option><option value="overview">Overview</option></select></div><p id="ns2-replay-meta"></p></div>';
  $('ns2-replay-range').oninput=(e)=>{replayIndex=Number(e.target.value);drawReplayPreview();drawOverlay()};
  $('ns2-replay-speed').onchange=(e)=>{replaySpeed=Number(e.target.value)||1};
  $('ns2-replay-camera').onchange=(e)=>{replayCamera=e.target.value;drawOverlay()};
  $('ns2-replay-meta').textContent='Score '+replay.score+' · Wave '+replay.wave+' · '+replay.frames.length+' frames';
  window._neonRound2Replay=replay;drawReplayPreview();
}
function drawReplayPreview(){
  const canvas=$('ns2-replay-canvas'),replay=window._neonRound2Replay;if(!canvas||!replay)return;
  const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  c.fillStyle='#040617';c.fillRect(0,0,w,h);
  for(let x=0;x<w;x+=48){c.strokeStyle='#17264a';c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke()}
  for(let y=0;y<h;y+=48){c.strokeStyle='#17264a';c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}
  const start=Math.max(0,Math.floor(replayIndex)-32),end=Math.min(replay.frames.length,Math.floor(replayIndex)+1);
  c.beginPath();for(let i=start;i<end;i++){const f=replay.frames[i],x=f.x*w,y=f.y*h;if(i===start)c.moveTo(x,y);else c.lineTo(x,y)}
  c.strokeStyle='#48eaff';c.lineWidth=3;c.stroke();
  const f=replay.frames[Math.max(0,Math.min(replay.frames.length-1,Math.floor(replayIndex)))];if(!f)return;
  c.beginPath();c.arc(f.x*w,f.y*h,11,0,Math.PI*2);c.fillStyle='#fff';c.shadowBlur=18;c.shadowColor='#45eaff';c.fill();c.shadowBlur=0;
  f.enemies.forEach(e=>{c.beginPath();c.arc(e.x*w,e.y*h,e.k==='boss'?15:6,0,Math.PI*2);c.fillStyle=e.mutation?'#ffae52':'#ff409c';c.fill()});
  c.fillStyle='#fff';c.font='bold 15px system-ui';c.fillText('WAVE '+f.wave+'  ·  SCORE '+f.score+'  ·  HULL '+Math.round(f.hp),18,26);
}
function marketHeaders(){return marketToken?{'Content-Type':'application/json','X-Market-Token':marketToken}:{'Content-Type':'application/json'}}
async function ensureMarketSession(){
  if(marketToken)return true;
  const name=(localStorage.getItem('neonswarm.name')||'Pilot').slice(0,16);
  const response=await fetch('/api/market/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name})});
  if(!response.ok)throw new Error('Marketplace service unavailable');
  const data=await response.json();marketToken=data.token;localStorage.setItem('neonswarm.market-token',marketToken);return true;
}
async function refreshMarket(){
  await ensureMarketSession();
  const [a,b]=await Promise.all([fetch('/api/market/account',{headers:marketHeaders()}),fetch('/api/market/listings')]);
  if(!a.ok||!b.ok)throw new Error('Marketplace service unavailable');
  const account=await a.json(),listings=await b.json();
  if(Array.isArray(account.deliveries)&&account.deliveries.length){
    account.deliveries.forEach(item=>S.tradeInventory.push(item));
    save();
    await fetch('/api/market/account/claim',{method:'POST',headers:marketHeaders(),body:'{}'});
  }
  if(account.balance>0){reward(account.balance);await fetch('/api/market/account/withdraw',{method:'POST',headers:marketHeaders(),body:'{}'});}
  marketRows=listings.listings||[];render();
}
async function createMarketListing(index){
  const item=S.tradeInventory[index];if(!item)throw new Error('No tradable item selected');
  await ensureMarketSession();
  const price=Math.max(1,Math.min(100000,Number(prompt('Set a credit price for '+item.name, '100'))||0));
  if(!price)return;
  const response=await fetch('/api/market/listings',{method:'POST',headers:marketHeaders(),body:JSON.stringify({item:item,price:price})});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not list item');
  S.tradeInventory.splice(index,1);save();await refreshMarket();
}
async function buyMarketListing(id){
  await ensureMarketSession();
  const response=await fetch('/api/market/listings/'+encodeURIComponent(id)+'/buy',{method:'POST',headers:marketHeaders(),body:'{}'});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Purchase failed');
  await refreshMarket();
}
async function discoverServerBase(){
  let value=($('ns2-server-url')&&$('ns2-server-url').value.trim())||localStorage.getItem('neonswarm.server-url')||location.origin;
  let url;try{url=new URL(value)}catch(_){url=new URL(location.origin)}
  if((url.hostname==='127.0.0.1'||url.hostname==='localhost')&&url.origin===location.origin){
    try{
      const response=await fetch('/api/health',{cache:'no-store'});
      if(response.ok){const info=await response.json();if(info.lanAddress&&info.port){
        url=new URL(location.protocol==='https:'?'https://'+location.host:'http://'+info.lanAddress+':'+info.port);
        if($('ns2-server-url'))$('ns2-server-url').value=url.origin;
      }}
    }catch(_){}
  }
  return url.origin;
}
async function refreshChallenges(){
  const response=await fetch('/api/challenges',{cache:'no-store'});
  if(!response.ok)throw new Error('Challenge sharing service is unavailable');
  const data=await response.json();remoteChallenges=data.challenges||[];render();
}
async function shareChallenge(index){
  const challenge=S.customs[index];if(!challenge)throw new Error('Custom challenge not found');
  const response=await fetch('/api/challenges',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...challenge,author:localStorage.getItem('neonswarm.name')||'Pilot'})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not share challenge');
  alert('Challenge shared! Code: '+data.challenge.shareCode);
  await refreshChallenges();
}
async function refreshServers(){
  const baseUrl=await discoverServerBase();
  let url;
  try{url=new URL(baseUrl);if(!['http:','https:'].includes(url.protocol))throw new Error('Use an HTTP or HTTPS server URL')}catch(e){throw new Error('Enter a valid server address')}
  localStorage.setItem('neonswarm.server-url',url.origin);
  const response=await fetch(url.origin+'/api/rooms',{cache:'no-store'});
  if(!response.ok)throw new Error('Server directory did not respond');
  const data=await response.json();serverRows=data.rooms||[];render();
}
async function createServerRoom(){
  const baseUrl=await discoverServerBase();
  const url=new URL(baseUrl);
  const name=($('ns2-room-name')&&$('ns2-room-name').value.trim())||'Neon squad';
  const player=localStorage.getItem('neonswarm.name')||'Pilot';
  const response=await fetch(url.origin+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,playerName:player,maxPlayers:4,mode:'co-op'})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not host server');
  room={url:url.origin,id:data.room.id,token:data.token,playerId:data.playerId,name:player};
  localStorage.setItem('neonswarm.room',JSON.stringify(room));startRoomHeartbeat();render();
}
async function joinServerRoom(id){
  const baseUrl=await discoverServerBase();
  const url=new URL(baseUrl),player=localStorage.getItem('neonswarm.name')||'Pilot';
  const response=await fetch(url.origin+'/api/rooms/'+encodeURIComponent(id)+'/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerName:player})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not join server');
  room={url:url.origin,id:data.room.id,token:data.token,playerId:data.playerId,name:player};
  localStorage.setItem('neonswarm.room',JSON.stringify(room));startRoomHeartbeat();render();
}
function startRoomHeartbeat(){
  if(roomTimer)clearInterval(roomTimer);
  roomTimer=setInterval(async()=>{
    if(!room)return;
    try{
      const p=Game.p,v=core.getView();
      const response=await fetch(room.url+'/api/rooms/'+encodeURIComponent(room.id)+'/heartbeat',{method:'POST',headers:{'Content-Type':'application/json','X-Player-Token':room.token},body:JSON.stringify({x:p?p.x/Math.max(1,v.w):.5,y:p?p.y/Math.max(1,v.h):.5,hp:p?p.hp:0,score:Game.score||0})});
      if(response.status===401||response.status===404){leaveRoom(false);return}
      if(response.ok){const data=await response.json();remotePlayers=(data.players||[]).filter(x=>x.id!==room.playerId);const status=$('ns2-room-status');if(status)status.textContent='CONNECTED · '+(data.players||[]).length+' PILOTS · '+room.id}
    }catch(_){const status=$('ns2-room-status');if(status)status.textContent='CONNECTION LOST · RETRYING'}
  },1200);
}
async function leaveRoom(notify){
  if(roomTimer){clearInterval(roomTimer);roomTimer=null}
  if(room&&notify!==false){try{await fetch(room.url+'/api/rooms/'+encodeURIComponent(room.id)+'/leave',{method:'POST',headers:{'X-Player-Token':room.token}})}catch(_){}}
  room=null;remotePlayers=[];localStorage.removeItem('neonswarm.room');render();
}
function currentEventName(){return eventInfo&&eventInfo.event&&eventInfo.event.id||dateKey()}
async function refreshEvent(){
  try{const r=await fetch('/api/events',{cache:'no-store'});if(r.ok){eventInfo=await r.json();if(S.event.id!==currentEventName())S.event={id:currentEventName(),kills:0,contributed:0,claimed:false};save();render()}}catch(_){}
}
async function contributeEvent(){
  if(!eventInfo||!eventInfo.event)return;
  const now=Date.now();if(now-lastEventSend<8000)return;lastEventSend=now;
  try{const r=await fetch('/api/events/contribute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kills:5})});if(r.ok)eventInfo=await r.json()}catch(_){}
}
function claimEvent(){
  if(!eventInfo||!eventInfo.event||S.event.kills<20||S.event.claimed)return;
  S.event.claimed=true;reward(500);save();render();
}
function css(){
  const s=document.createElement('style');
  s.textContent=[
    '#ns2-panel{position:fixed;inset:0;z-index:2300;display:none;align-items:center;justify-content:center;padding:12px;background:rgba(3,5,18,.94);backdrop-filter:blur(14px);color:#effaff;font:600 14px system-ui}',
    '#ns2-panel.open{display:flex}#ns2-panel .ns2-shell{width:min(1050px,98vw);max-height:95vh;overflow:auto;padding:18px;border:1px solid #42dff788;border-radius:18px;background:linear-gradient(145deg,#10162f,#1b0b34);box-shadow:0 20px 75px #0009}',
    '#ns2-panel .ns2-head,#ns2-panel .ns2-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '#ns2-panel h2{margin:0;color:#fff;font-size:clamp(23px,4vw,34px)}#ns2-panel p{max-width:none;color:#a9b8d5;margin:8px 0}',
    '#ns2-panel .ns2-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0}#ns2-panel button{padding:9px 12px;border-radius:9px;border:1px solid #43e1f866;background:#101b38;color:#eafaff;font:700 12px system-ui;box-shadow:none}',
    '#ns2-panel button.sel{background:#164454;border-color:#42e4ff}#ns2-panel button:disabled{opacity:.38}',
    '#ns2-panel input,#ns2-panel select{max-width:100%;padding:9px;border:1px solid #6a60a7;border-radius:8px;background:#090d22;color:#effaff;font:600 13px system-ui}',
    '#ns2-panel .ns2-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:9px;margin:10px 0}',
    '#ns2-panel .ns2-card{min-width:0;padding:12px;border:1px solid #8c7bc444;border-radius:11px;background:#080e25}',
    '#ns2-panel .ns2-card strong{display:block;color:#fff;font-size:14px}#ns2-panel .ns2-card small{display:block;color:#a9b8d5;margin:6px 0}',
    '#ns2-panel .ns2-note{padding:10px;border:1px dashed #ffc34d88;border-radius:9px;color:#ffdd96;margin:10px 0}',
    '#ns2-panel .ns2-progress{height:7px;background:#ffffff16;border-radius:99px;overflow:hidden;margin:8px 0}#ns2-panel .ns2-progress i{display:block;height:100%;background:linear-gradient(90deg,#37dff5,#b36dff)}',
    '#ns2-dialog{position:fixed;inset:0;z-index:2400;display:none;align-items:flex-end;justify-content:center;padding:5vh 14px;background:linear-gradient(180deg,#03051411,#030514dd)}#ns2-dialog.open{display:flex}',
    '#ns2-dialog .ns2-dialog-box{width:min(800px,96vw);padding:22px;border:1px solid #42dff7aa;border-radius:16px;background:linear-gradient(145deg,#10172e,#21103b);box-shadow:0 0 50px #42dff733}',
    '.ns2-dialog-tag{color:#42e5ff;letter-spacing:.2em;font-size:10px;font-weight:900}#ns2-dialog .ns2-dialog-title{margin:8px 0;color:#fff;font-size:clamp(22px,4vw,34px);font-weight:900}',
    '#ns2-dialog .ns2-dialog-text{min-height:58px;color:#d8dcf5;font-size:17px;line-height:1.6}#ns2-dialog .ns2-dialog-actions{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:18px;color:#a9b8d5;font-size:11px}',
    '#ns2-world-layer{position:fixed;inset:0;z-index:4;pointer-events:none;width:100%;height:100%}#ns2-panel,#ns2-dialog{z-index:2400} .panel{z-index:10}',
    '@media(max-width:560px){#ns2-panel .ns2-shell{padding:12px}#ns2-panel .ns2-grid{grid-template-columns:1fr}#ns2-dialog .ns2-dialog-box{padding:16px}}'
  ].join('');
  document.head.append(s);
}
function card(title,desc,action,label,disabled){
  return '<div class="ns2-card"><strong>'+safe(title)+'</strong><small>'+safe(desc)+'</small><button data-action="'+safe(action)+'" data-value="'+safe(label)+'" '+(disabled?'disabled':'')+'>'+safe(label)+'</button></div>';
}
function createPanel(){
  css();panel=document.createElement('div');panel.id='ns2-panel';
  panel.innerHTML='<div class="ns2-shell"><div class="ns2-head"><div><h2>NEON SWARM · ROUND 2</h2><p id="ns2-summary"></p></div><button id="ns2-close">CLOSE ✕</button></div><div class="ns2-tabs" id="ns2-tabs"></div><div id="ns2-content"></div></div>';
  document.body.append(panel);
  const tabs=[['story','Story'],['map','World Generator'],['drones','Companions'],['craft','Crafting Lab'],['mutations','Mutations'],['market','Marketplace'],['pass','Season Pass'],['replay','Replay Theater'],['creator','Game Creator'],['events','Live Events'],['servers','Servers']];
  tabs.forEach(([id,label])=>{const b=document.createElement('button');b.textContent=label;b.dataset.tab=id;b.onclick=()=>{activeTab=id;render();if(id==='market')refreshMarket().catch(showError);if(id==='servers')refreshServers().catch(showError);if(id==='events')refreshEvent()};$('ns2-tabs')&&$('ns2-tabs').append(b)});
  $('ns2-close').onclick=closePanel;
  panel.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)runAction(b.dataset.action,b.dataset.value).catch(showError)});
  panel.addEventListener('change',e=>{if(e.target.id==='ns2-replay-range'){replayIndex=Number(e.target.value);drawOverlay()}});
}
function openPanel(tab){
  if(!panel)createPanel();activeTab=tab||'story';panel.classList.add('open');render();
  if(Game.state==='play')Game.pause();
  if(activeTab==='servers')refreshServers().catch(showError);
  if(activeTab==='market')refreshMarket().catch(showError);
  if(activeTab==='events')refreshEvent();
}
function closePanel(){
  if(panel)panel.classList.remove('open');
  if(Game.state==='pause'&&!dialog?.classList.contains('open'))Game.resume();
}
function showError(error){
  const msg=error&&error.message?error.message:String(error);
  const content=$('ns2-content');if(content){const note=document.createElement('div');note.className='ns2-note';note.textContent=msg;content.prepend(note)}
}
function render(){
  if(!panel)return;
  $('ns2-summary').textContent='Credits '+credits()+' · Scrap '+S.materials.scrap+' · Crystals '+S.materials.crystal+' · Season XP '+S.season.xp;
  panel.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('sel',b.dataset.tab===activeTab));
  let html='';
  if(activeTab==='story'){
    html='<p>Follow the five-mission campaign. Each mission has story transmissions, a dedicated wave and a finale against the Heart of the Swarm.</p><div class="ns2-grid">';
    missions.forEach((m,i)=>{const done=S.campaign.completed.includes(m.id),unlocked=i<=S.campaign.unlocked;html+=card(m.title,m.subtitle+' · Wave '+m.wave,done?'noop':'mission',m.id,done||!unlocked,done?'COMPLETED':unlocked?'START':'LOCKED')});
    html+='</div><div class="ns2-note">The final mission uses the existing wave-60 boss encounter as the campaign finale.</div>';
  }else if(activeTab==='map'){
    ensureMap();html='<p>Every sortie gets a generated environment, collision obstacles, hidden passages and searchable vault caches.</p><div class="ns2-card"><strong>'+safe(S.map.theme)+'</strong><small>Seed '+S.map.seed+' · '+S.map.obstacles.length+' obstacles · '+S.map.secrets.length+' hidden caches · '+S.map.found.length+' discovered</small><div class="ns2-row"><button data-action="new-map">GENERATE NEW MAP</button><button data-action="reveal-map">SCAN SECRETS</button></div></div>';
    html+='<div class="ns2-grid">'+card('Secret caches','Hidden caches reward crystals and a tradeable vault relic.','reveal-map','SCAN')+card('Environment','Current sector: '+S.map.theme,'new-map','REGENERATE')+'</div>';
  }else if(activeTab==='drones'){
    html='<p>Unlocked drones orbit your ship and act automatically during runs. The Scout is granted after Mission 01.</p><div class="ns2-grid">';
    [['scout','Scout Drone','Attacks nearby enemies and pulls in nearby XP shards',0],['medic','Medic Drone','Restores 18 hull every 8 seconds',18],['striker','Striker Drone','Deals heavy autonomous damage',30],['guardian','Guardian Drone','Intercepts close enemies and protects your hull',24]].forEach(d=>{const owns=S.drones.includes(d[0]);html+=card(d[1],d[2],owns?'noop':'drone',d[0],owns||S.materials.crystal<d[3],owns?'UNLOCKED':'UNLOCK · '+d[3]+' CRYSTALS')});
    html+='</div><p>Active companions: '+(S.drones.length?S.drones.join(', '):'none')+'</p>';
  }else if(activeTab==='craft'){
    html='<p>Battle drops and secret caches supply components. Crafting permanently modifies your pilot build.</p><div class="ns2-card"><strong>Materials</strong><small>Scrap '+S.materials.scrap+' · Crystals '+S.materials.crystal+' · Core fragments '+S.materials.core+'</small></div><div class="ns2-grid">';
    html+=card('Overcharge barrel','+12% weapon damage per rank · Cost 8 scrap + 2 crystals','craft','damage',S.materials.scrap<8||S.materials.crystal<2||S.mods.damage>=5,'CRAFT');
    html+=card('Aegis plating','-8% incoming contact damage per rank · Cost 10 scrap + 3 crystals','craft','armor',S.materials.scrap<10||S.materials.crystal<3||S.mods.armor>=5,'CRAFT');
    html+=card('Ion capacitor','+7% drone / shot cadence per rank · Cost 12 scrap + 1 core','craft','rate',S.materials.scrap<12||S.materials.core<1||S.mods.rate>=5,'CRAFT');
    html+='</div><p>Ranks: damage '+S.mods.damage+' · armour '+S.mods.armor+' · cadence '+S.mods.rate+'</p>';
  }else if(activeTab==='mutations'){
    html='<p>From wave 6 onward, some enemies evolve mid-battle. Mutation traits change health, armour, movement and death behaviour.</p><div class="ns2-grid">';
    [['ARMOURED','Damage is heavily reduced'],['RIFT RUNNER','Fast movement and aggressive pursuit'],['VOLATILE','Explodes near the pilot when destroyed'],['REGENERATOR','Slowly restores health while alive']].forEach(x=>{html+='<div class="ns2-card"><strong>'+x[0]+'</strong><small>'+x[1]+'</small></div>'});
    html+='</div><div class="ns2-note">Mutated enemies encountered: '+S.mutations.seen+'. Higher waves increase mutation frequency.</div>';
  }else if(activeTab==='market'){
    html='<p>Server-managed player listings for equipment, skins and collectibles. The marketplace is available when this game is connected to a running Neon Swarm Python backend.</p><div class="ns2-row"><button data-action="market-refresh">REFRESH MARKET</button></div><div class="ns2-grid">';
    S.tradeInventory.forEach((it,i)=>{html+=card(it.name,it.rarity+' · '+it.kind,'market-list',String(i),false,'LIST ITEM')});
    if(!S.tradeInventory.length)html+='<div class="ns2-card"><strong>No tradeable items yet</strong><small>Find secret caches or defeat bosses to earn collectibles.</small></div>';
    (marketRows||[]).forEach(x=>{html+='<div class="ns2-card"><strong>'+safe(x.item.name)+'</strong><small>'+safe(x.item.rarity)+' · Seller '+safe(x.seller)+' · '+x.price+' credits</small><button data-action="market-buy" data-value="'+safe(x.id)+'" '+(x.mine?'disabled':'')+'>'+(x.mine?'YOUR LISTING':'BUY')+'</button></div>'});
    html+='</div>';
  }else if(activeTab==='pass'){
    html='<p>Season '+safe(S.season.id)+' · Earn XP by eliminating enemies and bosses. Every tier is earned through play; the bonus track is premium-style, not a payment gate.</p><div class="ns2-card"><strong>Season progress · '+S.season.xp+' XP</strong><div class="ns2-progress"><i style="width:'+Math.min(100,S.season.xp/12)+'%"></i></div></div><div class="ns2-grid">';
    seasonRewards().forEach((r,i)=>{const claimed=S.season.claimed.includes(i),ready=S.season.xp>=r.xp;html+=card((r.premium?'BONUS TRACK · ':'FREE TRACK · ')+r.label,'Tier '+(i+1)+' · '+r.xp+' XP',claimed?'noop':'pass-claim',String(i),claimed||!ready,claimed?'CLAIMED':ready?'CLAIM':'LOCKED')});
    html+='</div>';
  }else if(activeTab==='replay'){
    html='<p>Saved sorties include the pilot path, enemy positions, score and wave. Scrub the timeline, switch camera mode and play at half, normal, double or quadruple speed.</p><div class="ns2-grid">';
    S.replays.forEach((r,i)=>{html+=card(new Date(r.date).toLocaleString(),'Score '+r.score+' · Wave '+r.wave+' · '+r.frames.length+' snapshots','replay-open',String(i),false,'WATCH REPLAY')});
    if(!S.replays.length)html+='<div class="ns2-card"><strong>No replays saved</strong><small>Complete or quit a run to save its flight recorder data.</small></div>';
    html+='</div>';
  }else if(activeTab==='creator'){
    html='<p>Build and play your own arena challenge. Share it to the Python server directory so other pilots can import it.</p><div class="ns2-card"><div class="ns2-row"><label>Starting wave <input id="ns2-custom-wave" type="number" min="1" max="60" value="10"></label><label>Enemy density <select id="ns2-custom-density"><option value="1">Normal</option><option value="1.5">High</option><option value="2">Extreme</option></select></label></div><div class="ns2-row"><label>Map seed <input id="ns2-custom-seed" type="number" value="'+Math.floor(Math.random()*999999)+'"></label><button data-action="custom-save">SAVE CHALLENGE</button><button data-action="challenge-refresh">FETCH SHARED</button></div></div><div class="ns2-grid">';
    S.customs.forEach((x,i)=>{html+=card(x.name,'Wave '+x.wave+' · density '+x.density+' · seed '+x.seed,'custom-play',String(i),false,'PLAY')+'<button data-action="challenge-share" data-value="'+i+'">SHARE</button>'});
    html+='</div><h3>Community challenges</h3><div class="ns2-grid">';
    remoteChallenges.forEach(x=>{html+=card(x.name,'By '+x.author+' · Wave '+x.wave+' · density '+x.density+' · code '+x.shareCode,'challenge-import',x.id,false,'IMPORT')});
    if(!remoteChallenges.length)html+='<div class="ns2-card"><strong>No shared challenges</strong><small>Publish one of your own to add the first entry.</small></div>';
    html+='</div>';
  }else if(activeTab==='events'){
    const ev=eventInfo&&eventInfo.event;
    html='<p>Live global invasion. Every pilot can contribute eliminations to the shared server event.</p>';
    html+=ev?'<div class="ns2-card"><strong>'+safe(ev.title)+'</strong><small>'+safe(ev.description)+' · Ends '+safe(ev.endsAt)+'</small><div class="ns2-progress"><i style="width:'+Math.min(100,(ev.communityKills/ev.goal)*100)+'%"></i></div><small>Community '+ev.communityKills+' / '+ev.goal+' · Your kills '+S.event.kills+' / 20</small></div>':'<div class="ns2-note">Connect to a Python backend to load the live event.</div>';
    html+='<div class="ns2-row"><button data-action="event-refresh">REFRESH EVENT</button><button data-action="event-claim" '+(!ev||S.event.kills<20||S.event.claimed?'disabled':'')+'>CLAIM 500 CREDITS</button></div>';
  }else if(activeTab==='servers'){
    const savedUrl=localStorage.getItem('neonswarm.server-url')||location.origin;
    html='<p>Join a running Neon Swarm Python server. The host must be reachable over the same Wi-Fi or through a public IP/domain with the server port exposed.</p><div class="ns2-card"><div class="ns2-row"><label>Backend address <input id="ns2-server-url" style="width:min(380px,75vw)" value="'+safe(savedUrl)+'" placeholder="http://192.168.1.20:8000"></label><button data-action="server-refresh">FETCH SERVERS</button></div><div class="ns2-row"><input id="ns2-room-name" value="Neon squad" placeholder="Server name"><button data-action="server-host">HOST SERVER</button></div><p id="ns2-room-status">'+(room?'CONNECTED · '+safe(room.id):'Not connected')+'</p></div><div class="ns2-grid">';
    (serverRows||[]).forEach(x=>{html+='<div class="ns2-card"><strong>'+safe(x.name)+'</strong><small>'+safe(x.mode)+' · '+x.players+'/'+x.maxPlayers+' pilots · '+safe(x.id)+'</small><button data-action="server-join" data-value="'+safe(x.id)+'" '+(x.players>=x.maxPlayers?'disabled':'')+'>JOIN SERVER</button></div>'});
    if(!serverRows.length)html+='<div class="ns2-card"><strong>No active rooms found</strong><small>Host a server here, then share its backend address with other pilots.</small></div>';
    html+='</div>';
    if(room)html+='<div class="ns2-note">You are connected to room '+safe(room.id)+'. Other pilots appear as neon markers in your arena. <button data-action="server-leave">LEAVE SERVER</button></div>';
    html+='<div class="ns2-note">The shared lobby synchronises player presence and pilot positions. Each client still simulates its own wave/combat locally; this is not an authoritative shared-enemy co-op session yet.</div>';
  }
  $('ns2-content').innerHTML=html;
}
async function runAction(action,value){
  if(action==='mission'){const m=missions.find(x=>x.id===value);if(m)startMission(m)}
  else if(action==='new-map'){generateMap();render()}
  else if(action==='reveal-map'){if(!S.map.found.length&&S.map.secrets.length){const i=S.map.secrets.findIndex((x,n)=>!S.map.found.includes(n));if(i>=0){S.map.found.push(i);S.materials.crystal+=2;shout('SCANNER FOUND A CACHE','#ffc34d')}}save();render()}
  else if(action==='drone'){const costs={scout:0,medic:18,striker:30,guardian:24},cost=costs[value];if(S.materials.crystal>=cost&&!S.drones.includes(value)){S.materials.crystal-=cost;S.drones.push(value);save();render()}}
  else if(action==='craft'){const costs={damage:[8,2,0],armor:[10,3,0],rate:[12,0,1]},c=costs[value];if(c&&S.materials.scrap>=c[0]&&S.materials.crystal>=c[1]&&S.materials.core>=c[2]){S.materials.scrap-=c[0];S.materials.crystal-=c[1];S.materials.core-=c[2];S.mods[value]++;save();render();shout('CRAFT COMPLETE','#6dffb0')}}
  else if(action==='pass-claim'){const index=Number(value);if(Number.isInteger(index)&&seasonRewards()[index]&&S.season.xp>=seasonRewards()[index].xp&&!S.season.claimed.includes(index)){const r=seasonRewards()[index];S.season.claimed.push(index);if(r.amount)reward(r.amount);else S.tradeInventory.push({id:'season-'+Date.now(),name:r.label,rarity:'EPIC',kind:'cosmetic'});save();render()}}
  else if(action==='replay-open')replayOverlay(S.replays[Number(value)])
  else if(action==='replay-play'){if(replayTimer)clearInterval(replayTimer);replayTimer=setInterval(()=>{const r=window._neonRound2Replay;if(!r){clearInterval(replayTimer);return}replayIndex=(replayIndex+replaySpeed)%r.frames.length;if($('ns2-replay-range'))$('ns2-replay-range').value=String(Math.floor(replayIndex));drawReplayPreview();drawOverlay()},100)}
  else if(action==='replay-stop'){if(replayTimer)clearInterval(replayTimer);replayTimer=null}
  else if(action==='custom-save'){const wave=Math.max(1,Math.min(60,Number($('ns2-custom-wave').value)||10)),density=Number($('ns2-custom-density').value)||1,seed=Math.max(1,Number($('ns2-custom-seed').value)||1);S.customs.unshift({name:'Custom challenge '+(S.customs.length+1),wave,density,seed});S.customs=S.customs.slice(0,10);save();render()}
  else if(action==='custom-play')startCustom(Number(value))
  else if(action==='challenge-share')await shareChallenge(Number(value))
  else if(action==='challenge-refresh')await refreshChallenges()
  else if(action==='challenge-import'){const item=remoteChallenges.find(x=>x.id===value);if(item){S.customs.unshift({name:item.name,wave:item.wave,density:item.density,seed:item.seed,sharedCode:item.shareCode});S.customs=S.customs.slice(0,20);save();render()}}
  else if(action==='market-refresh')await refreshMarket()
  else if(action==='market-list')await createMarketListing(Number(value))
  else if(action==='market-buy')await buyMarketListing(value)
  else if(action==='server-refresh')await refreshServers()
  else if(action==='server-host')await createServerRoom()
  else if(action==='server-join')await joinServerRoom(value)
  else if(action==='server-leave')await leaveRoom(true)
  else if(action==='event-refresh')await refreshEvent()
  else if(action==='event-claim')claimEvent()
  render();
}
function drawOverlay(){
  const c=overlayCtx;if(!c||!round2Overlay)return;
  const dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1)),w=window.innerWidth,h=window.innerHeight;
  if(round2Overlay.width!==Math.round(w*dpr)||round2Overlay.height!==Math.round(h*dpr)){round2Overlay.width=Math.round(w*dpr);round2Overlay.height=Math.round(h*dpr);overlayScale=dpr;overlayWidth=w;overlayHeight=h}
  c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
  const view=core.getView(),sx=w/Math.max(1,view.w),sy=h/Math.max(1,view.h);
  if(Game.state==='play'||Game.state==='pause'||Game.state==='dying'){
    const colors={ 'NEON RUINS':'#30dff0','FROST GRID':'#90d8ff','VOID GARDEN':'#b27cff','SOLAR FOUNDRY':'#ff9a43','ABYSSAL LAB':'#55a8d8'};
    c.fillStyle=colors[S.map.theme]||'#36e0ed';c.globalAlpha=.035;c.fillRect(0,0,w,h);c.globalAlpha=1;
    (S.map.obstacles||[]).forEach(o=>{c.fillStyle=o.kind==='crystal'?'#44eaff18':'#a76bff20';c.strokeStyle=o.kind==='crystal'?'#57e8ff88':'#b47cff77';c.lineWidth=1.4;c.fillRect(o.x*sx,o.y*sy,o.w*sx,o.h*sy);c.strokeRect(o.x*sx,o.y*sy,o.w*sx,o.h*sy)});
    (S.map.secrets||[]).forEach((q,i)=>{if(S.map.found.includes(i))return;c.beginPath();c.arc(q.x*sx,q.y*sy,8,0,Math.PI*2);c.strokeStyle='#ffc34d99';c.lineWidth=2;c.stroke()});
    if(Game.p&&S.drones.length)S.drones.forEach((id,i)=>{const a=Game.time*1.45+i*Math.PI*2/S.drones.length,x=(Game.p.x+Math.cos(a)*(34+i*11))*sx,y=(Game.p.y+Math.sin(a)*(34+i*11))*sy;c.beginPath();c.arc(x,y,6,0,Math.PI*2);c.fillStyle=id==='medic'?'#6dffb0':'#46e9ff';c.shadowBlur=12;c.shadowColor=c.fillStyle;c.fill();c.shadowBlur=0});
    remotePlayers.forEach(p=>{const x=Math.max(0,Math.min(1,p.x))*w,y=Math.max(0,Math.min(1,p.y))*h;c.beginPath();c.arc(x,y,8,0,Math.PI*2);c.fillStyle='#ff56b7';c.shadowBlur=15;c.shadowColor='#ff56b7';c.fill();c.shadowBlur=0;c.fillStyle='#fff';c.font='11px system-ui';c.fillText(p.name||'Pilot',x+10,y-8)});
  }
  const replay=window._neonRound2Replay;
  if(replay&&panel&&panel.classList.contains('open')&&activeTab==='replay'){
    const f=replay.frames[Math.max(0,Math.min(replay.frames.length-1,Math.floor(replayIndex)))];
    if(f){
      c.fillStyle='#040617';c.globalAlpha=.88;c.fillRect(0,0,w,h);c.globalAlpha=1;
      const px=f.x*w,py=f.y*h;c.beginPath();c.arc(px,py,10,0,Math.PI*2);c.fillStyle='#56f2ff';c.shadowBlur=22;c.shadowColor='#56f2ff';c.fill();c.shadowBlur=0;
      f.enemies.forEach(e=>{c.beginPath();c.arc(e.x*w,e.y*h,e.k==='boss'?15:5,0,Math.PI*2);c.fillStyle=e.mutation?'#ff9b4d':'#ff3e9c';c.fill()});
      c.fillStyle='#fff';c.font='bold 13px system-ui';c.fillText('REPLAY · WAVE '+f.wave+' · SCORE '+f.score,18,28);
    }
  }
}
function animateOverlay(){
  drawOverlay();overlayRaf=requestAnimationFrame(animateOverlay);
}
function installOverlay(){
  round2Overlay=document.createElement('canvas');round2Overlay.id='ns2-world-layer';document.body.append(round2Overlay);overlayCtx=round2Overlay.getContext('2d');animateOverlay();
}
function hooks(){
  const oldStart=Game.start;
  Game.start=function(){
    runStartAt=performance.now();replayFrames=[];replayAccumulator=0;ensureMap();
    const result=oldStart.apply(this,arguments);
    if(pendingRun&&pendingRun.kind==='custom'){
      this.wave=pendingRun.challenge.wave;this.enemies=[];this.spawnWave();
    }else if(pendingRun&&pendingRun.kind==='story'){
      this.wave=pendingRun.mission.wave;this.enemies=[];this.spawnWave();
    }
    return result;
  };
  const oldAdd=Game.add;
  Game.add=function(k,x,y,hp){
    const result=oldAdd.call(this,k,x,y,hp),enemy=this.enemies&&this.enemies[this.enemies.length-1];
    if(enemy)seededMutation(enemy);
    return result;
  };
  const oldDamage=Game.damage;
  Game.damage=function(enemy,amount){
    if(!enemy||enemy.dead)return oldDamage.call(this,enemy,amount);
    const multiplier=1+S.mods.damage*.12;
    const adjusted=amount*multiplier*(enemy.nsArmor?1-enemy.nsArmor:1);
    const result=oldDamage.call(this,enemy,adjusted);
    if(enemy.dead&&!enemy.nsRound2Paid){
      enemy.nsRound2Paid=true;S.materials.scrap+=enemy.k==='boss'?12:1+(Math.random()<.35?1:0);
      if(enemy.k==='boss'){S.materials.crystal+=4;S.materials.core+=2;S.tradeInventory.push({id:'boss-'+Date.now(),name:'Swarm Core Shard',rarity:'LEGENDARY',kind:'equipment'})}
      else if(Math.random()<.025)S.tradeInventory.push({id:'drop-'+Date.now(),name:'Mutation Residue',rarity:'RARE',kind:'collectible'});
      S.season.xp+=enemy.k==='boss'?40:5;S.event.kills++;
      if(enemy.nsExplode&&this.p&&Math.hypot(this.p.x-enemy.x,this.p.y-enemy.y)<95)this.p.hp=Math.max(1,this.p.hp-18);
      save();if(S.event.kills%5===0)contributeEvent();
    }
    return result;
  };
  const oldUpdate=Game.update;
  Game.update=function(dt){
    const result=oldUpdate.call(this,dt);
    if(this.state==='play'&&this.p){
      tickDrones(dt);clampPlayerOffWalls();replayAccumulator+=dt;
      if(replayAccumulator>=.12){replayAccumulator=0;recordFrame()}
      if(S.mods.armor&&this.p.hp<this.p.maxHp&&Math.random()<dt*S.mods.armor*.025)this.p.hp=Math.min(this.p.maxHp,this.p.hp+1);
    }
    return result;
  };
  const oldClear=Game.clearWave;
  Game.clearWave=function(){
    const mission=activeMission(),wave=this.wave;
    const out=oldClear.call(this);
    if(mission&&wave>=mission.wave)completeMission(mission);
    return out;
  };
  const oldVictory=Game.victory;
  Game.victory=function(){
    const mission=activeMission();const out=oldVictory.call(this);
    if(mission)completeMission(mission);
    saveReplay();return out;
  };
  const oldOver=Game.over;
  Game.over=function(){saveReplay();return oldOver.apply(this,arguments)};
  const oldSpawn=Game.spawnWave;
  Game.spawnWave=function(){
    oldSpawn.call(this);
    const custom=pendingRun&&pendingRun.kind==='custom'?pendingRun.challenge:null;
    if(custom&&custom.density>1){const extras=Math.min(24,Math.floor((custom.density-1)*this.enemies.length));for(let i=0;i<extras;i++){const v=core.getView();this.add(['drone','shooter','spinner','bomber'][i%4],Math.random()*v.w,v.h*(.15+Math.random()*.5))}}
  };
}
function injectButtons(){
  const host=document.querySelector('.menu-actions');
  if(host&&!$('ns2-open')){const b=document.createElement('button');b.className='alt';b.id='ns2-open';b.textContent='Round 2 · Command Center';b.onclick=()=>openPanel('story');host.append(b)}
  const pause=$('pause');
  if(pause&&!$('ns2-pause')){const b=document.createElement('button');b.className='alt';b.id='ns2-pause';b.textContent='Round 2 · Command Center';b.onclick=()=>openPanel('story');pause.insertBefore(b,pause.querySelector('#quit'))}
}
function boot(){
  createPanel();installOverlay();injectButtons();
  new MutationObserver(injectButtons).observe(document.body,{childList:true,subtree:true});
  const stored=localStorage.getItem('neonswarm.room');
  if(stored){try{room=JSON.parse(stored);startRoomHeartbeat()}catch(_){localStorage.removeItem('neonswarm.room')}}
  refreshEvent();
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&room)fetch(room.url+'/api/rooms/'+encodeURIComponent(room.id)+'/heartbeat',{method:'POST',headers:{'Content-Type':'application/json','X-Player-Token':room.token},body:JSON.stringify({x:.5,y:.5,hp:0,score:0})}).catch(()=>{})});
  window.addEventListener('beforeunload',()=>{if(room&&navigator.sendBeacon){const blob=new Blob(['{}'],{type:'application/json'});navigator.sendBeacon(room.url+'/api/rooms/'+encodeURIComponent(room.id)+'/leave?token='+encodeURIComponent(room.token),blob)}if(replayTimer)clearInterval(replayTimer);cancelAnimationFrame(overlayRaf)});
}
hooks();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
window.NeonSwarmRound2={state:S,open:openPanel,close:closePanel,refreshServers:refreshServers,leaveServer:leaveRoom,generateMap:generateMap};
})();