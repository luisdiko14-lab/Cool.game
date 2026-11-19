(() => {
  'use strict';
  const core = window.NeonSwarmCore;
  if (!core || !core.Game || window.NeonSwarmExpansionLoaded) return;
  window.NeonSwarmExpansionLoaded = true;
  const { Game, FX, Profile, Input } = core;
  const S = {
    bounty:null, bountyClock:12, chain:0, chainClock:0, focus:0, noHit:0,
    barrierUsed:false, dodgeWindow:0, dodgeReady:0, repairClock:0,
    bossPhases:new WeakSet(), bossAdds:new WeakSet(), bossFinal:new WeakSet(),
    traits:new WeakSet(), medicClock:0, commanderClock:0, sniperClock:0,
    mastery:{standard:0,scatter:0,rapid:0,lance:0}, masteryRank:0,
    gems:0, cacheWave:0, draft:null, upgrades:{damage:0,hull:0,fire:0,shield:0},
    survival:0, challenge:null, challengeDone:false, lastWave:0, lastKill:0,
    hud:null, draftEl:null, stats:null, perfectDodges:0, runStarted:false
  };
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const view=()=>core.getView();
  const text=(x,y,msg,color='#8ffcff',size=14)=>FX.text(x,y,msg,color,size);
  function addCredits(n,reason){
    if(Profile&&Profile.data){Profile.data.credits=(Number(Profile.data.credits)||0)+n;Profile.save?.();Profile.render?.();}
    text(view().w/2,view().h*.38,'+'+n+' CREDITS · '+reason,'#ffc23d',13);
  }
  function ui(){
    const style=document.createElement('style');
    style.textContent='#nsx-hud{position:fixed;z-index:26;left:12px;top:calc(env(safe-area-inset-top,0px) + 158px);display:none;max-width:190px;padding:8px 10px;border:1px solid rgba(255,194,61,.35);border-radius:9px;background:rgba(7,10,28,.86);color:#eaf8ff;font:700 10px/1.55 ui-monospace,monospace;pointer-events:none;backdrop-filter:blur(8px)}#nsx-draft{position:fixed;inset:0;z-index:1200;display:none;align-items:center;justify-content:center;padding:14px;background:rgba(3,5,18,.88);backdrop-filter:blur(12px)}#nsx-draft>section{width:min(680px,96vw);padding:20px;border:1px solid rgba(61,245,255,.5);border-radius:15px;background:linear-gradient(145deg,#101a35,#17092c);color:#f4f8ff;text-align:center}#nsx-draft-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:14px}#nsx-draft button{padding:13px;border:1px solid rgba(61,245,255,.35);border-radius:9px;background:#130d2c;color:#f4f8ff;font-weight:800;text-align:left}#nsx-draft button small{display:block;margin-top:6px;color:#b2c5e4;font-weight:500}#nsx-draft .nsx-sub{margin-top:12px;text-align:center;background:#17352f}@media(max-width:560px){#nsx-draft-options{grid-template-columns:1fr}#nsx-hud{top:auto;bottom:calc(env(safe-area-inset-bottom,0px) + 18px)}}';
    document.head.append(style);
    const hud=document.createElement('div');hud.id='nsx-hud';document.body.append(hud);S.hud=hud;
    const overlay=document.createElement('div');overlay.id='nsx-draft';
    overlay.innerHTML='<section><h2>WAVE CLEAR · FIELD REQUISITION</h2><p>Choose one permanent upgrade for this run.</p><div id="nsx-draft-options"></div></section>';
    document.body.append(overlay);S.draftEl=overlay;
  }
  function openDraft(){
    if(!S.draftEl||S.draftEl.style.display==='flex')return;
    const options=[
      ['damage','Calibrated ammunition','+7% weapon damage per stack.'],
      ['hull','Reinforced plating','+30 maximum hull and repair 30 HP.'],
      ['fire','Cycling capacitor','Fire 6% faster per stack.'],
      ['shield','Shield reserve','Gain 5 seconds of shield immediately.']
    ];
    const host=document.getElementById('nsx-draft-options');host.innerHTML='';
    options.forEach(([id,name,desc])=>{
      const b=document.createElement('button');b.type='button';b.innerHTML=name+'<small>'+desc+'</small>';
      b.addEventListener('click',()=>{
        const p=Game.p;if(!p)return;
        S.upgrades[id]++;
        if(id==='hull'){p.maxHp+=30;p.hp=Math.min(p.maxHp,p.hp+30);}
        if(id==='shield')p.shield=Math.max(p.shield,5);
        text(p.x,p.y-38,name.toUpperCase(),'#ffc23d',15);
        S.draftEl.style.display='none';
      });
      host.append(b);
    });
    const close=document.createElement('button');close.type='button';close.className='nsx-sub';close.textContent='Continue without upgrade';close.onclick=()=>{S.draftEl.style.display='none';};host.append(close);
    S.draftEl.style.display='flex';
  }
  function tagWave(){
    const enemies=Game.enemies.filter(e=>!e.dead&&e.k!=='boss');
    if(!enemies.length)return;
    const target=enemies[Math.floor(Math.random()*enemies.length)];
    S.bounty=target;target.nsxBounty=true;
    text(target.x,target.y-(target.r||15)-28,'◆ CONTRACT TARGET ◆','#ffc23d',13);
  }
  function selectedWeapon(){try{return JSON.parse(localStorage.getItem('neonswarm.features')||'{}').weapon||'standard';}catch(_){return 'standard';}}
  function install(){
    ui();
    const oldStart=Game.start;
    Game.start=function(){Object.assign(S,{bounty:null,bountyClock:12,chain:0,chainClock:0,focus:0,noHit:0,barrierUsed:false,dodgeWindow:0,dodgeReady:0,repairClock:0,wasDashing:false,medicClock:0,commanderClock:0,sniperClock:0,gems:0,cacheWave:0,survival:0,perfectDodges:0,runStarted:true,lastWave:0,lastKill:0});S.mastery={standard:0,scatter:0,rapid:0,lance:0};S.masteryRank=0;S.upgrades={damage:0,hull:0,fire:0,shield:0};oldStart.call(this);};
    const oldDamage=Game.damage;
    Game.damage=function(enemy,amount){
      if(!enemy||enemy.dead)return;
      let n=Number(amount)||0;
      if(enemy.nsxArmor)n*=.72;
      const weapon=selectedWeapon();
      S.mastery[weapon]=(S.mastery[weapon]||0)+n;
      const total=Object.values(S.mastery).reduce((a,b)=>a+b,0);
      const rank=Math.floor(total/2500);
      if(rank>S.masteryRank){S.masteryRank=rank;text(view().w/2,view().h*.28,'WEAPON MASTERY RANK '+rank,'#7effd0',18);addCredits(20*rank,'MASTERY');}
      const masteryBonus=1+Math.min(.2,(S.mastery[weapon]||0)/25000);
      const perkDamage=1+(S.upgrades.damage||0)*.07;
      oldDamage.call(this,enemy,n*masteryBonus*perkDamage);
    };
    const oldKill=Game.kill;
    Game.kill=function(enemy){
      if(!enemy||enemy.dead)return;
      const wasBounty=enemy.nsxBounty===true;
      const volatile=enemy.nsxVolatile===true;
      const isMedic=enemy.nsxMedic===true;
      const isCommander=enemy.nsxCommander===true;
      const isArmored=enemy.nsxArmor===true;
      oldKill.call(this,enemy);
      const now=Number(this.time)||0;
      S.chain=now-S.lastKill<2.6?S.chain+1:1;S.lastKill=now;S.chainClock=2.6;
      if(S.chain>1&&S.chain%5===0){this.awardScore(180*S.chain);text(enemy.x,enemy.y-20,S.chain+' KILL CHAIN','#ffc23d',14);}
      if(S.chain>=12&&S.chain%12===0&&this.p)this.p.shield=Math.max(this.p.shield,2.5);
      if(wasBounty){this.awardScore(1200);addCredits(75,'CONTRACT COMPLETE');S.bounty=null;}
      if(isMedic)addCredits(18,'MEDIC ELIMINATED');
      if(isCommander)addCredits(25,'COMMANDER ELIMINATED');
      if(isArmored)this.awardScore(600);
      if(enemy.k==='boss'){
        this.pu.push({x:enemy.x-28,y:enemy.y,k:'life',t:24,a:0,nsxBossCache:true});
        this.pu.push({x:enemy.x+28,y:enemy.y,k:'shield',t:24,a:0,nsxBossCache:true});
        addCredits(150,'BOSS CLEAR CACHE');
      }
      if(volatile){
        for(const other of this.enemies){if(other!==enemy&&!other.dead&&Math.hypot(other.x-enemy.x,other.y-enemy.y)<105)this.damage(other,Math.max(25,this.lvl*30));}
        FX.ring(enemy.x,enemy.y,105,'#ff795f');FX.burst(enemy.x,enemy.y,'#ff795f',18,220,.5,3);
      }
    };
    const oldHurt=Game.hurt;
    Game.hurt=function(amount){
      S.noHit=0;S.focus=0;S.repairClock=0;
      S.dodgeWindow=.42;
      oldHurt.call(this,amount);
      if(this.p&&this.p.hp>0&&this.p.hp<=this.p.maxHp*.25&&!S.barrierUsed){
        S.barrierUsed=true;this.p.shield=Math.max(this.p.shield,5);this.p.inv=Math.max(this.p.inv,1.1);
        text(this.p.x,this.p.y-42,'LAST STAND BARRIER','#7dfcff',16);FX.ring(this.p.x,this.p.y,150,'#7dfcff');
      }
    };
    const oldGem=Game.gem;
    Game.gem=function(gem){
      oldGem.call(this,gem);S.gems++;
      if(S.gems%12===0&&this.p){this.p.shield=Math.max(this.p.shield,2);addCredits(30,'CRYSTAL RESONANCE');}
    };
    const oldClear=Game.clearWave;
    Game.clearWave=function(){
      const completedWave=this.wave;
      oldClear.call(this);
      if(completedWave>0&&completedWave%2===0)openDraft();
      if(completedWave%5===0&&S.cacheWave!==completedWave){
        S.cacheWave=completedWave;
        const p=this.p;if(p)this.pu.push({x:p.x,y:Math.max(50,p.y-95),k:'life',t:25,a:0,nsxCache:true});
        addCredits(40+completedWave*4,'SUPPLY CACHE');
      }
    };
    const oldUpdate=Game.update;
    Game.update=function(dt){
      oldUpdate.call(this,dt);
      if(this.state!=='play'||!this.p||this.p.dead)return;
      const p=this.p,now=Number(this.time)||0,v=view();
      S.noHit+=dt;S.survival+=dt;S.bountyClock-=dt;S.chainClock-=dt;
      if(S.chainClock<=0)S.chain=0;
      if(S.bountyClock<=0){S.bountyClock=24;tagWave();}
      if(S.noHit>=12){S.focus=Math.min(5,S.focus+dt);if(S.focus>0&&Math.random()<.035)FX.burst(p.x,p.y,'#7effd0',1,30,.2,2);}
      if(S.noHit>=8){S.repairClock+=dt;if(S.repairClock>=5){S.repairClock=0;p.hp=Math.min(p.maxHp,p.hp+Math.max(1,p.maxHp*.004));}}
      if(S.dodgeWindow>0)S.dodgeWindow=Math.max(0,S.dodgeWindow-dt);
      if(p.dashT>0&&!S.wasDashing){
        for(const b of this.eb){if(Math.hypot(b.x-p.x,b.y-p.y)<105)b.life=0;}
        for(const enemy of this.enemies){if(!enemy.dead&&enemy.k!=='boss'&&Math.hypot(enemy.x-p.x,enemy.y-p.y)<82)this.damage(enemy,Math.max(18,this.lvl*12));}
        FX.ring(p.x,p.y,105,'#7dfcff');
      }
      S.wasDashing=p.dashT>0;
      if(p.dashT>0)S.dodgeReady=Math.max(S.dodgeReady,.16);
      if(S.dodgeReady>0){S.dodgeReady-=dt;for(const b of this.eb){if(b.life>0&&Math.hypot(b.x-p.x,b.y-p.y)<58){b.life=0;S.perfectDodges++;this.awardScore(250);text(p.x,p.y-30,'PERFECT DODGE +250','#7dfcff',13);FX.ring(p.x,p.y,78,'#7dfcff');}}}
      if(S.focus>=5&&p.rapid<1){p.rapid=Math.max(p.rapid,1.2);S.focus=0;text(p.x,p.y-35,'FOCUS OVERDRIVE','#7effd0',14);}
      if(S.survival>=60){S.survival=0;this.awardScore(500);addCredits(35,'SURVIVAL PAYOUT');}
      if(this.wave!==S.lastWave){
        S.lastWave=this.wave;
        const boss=this.enemies.find(e=>e.k==='boss'&&!e.dead);
        if(boss){S.bossPhases=new WeakSet();S.bossAdds=new WeakSet();S.bossFinal=new WeakSet();}
        for(const e of this.enemies){
          if(e.dead||e.k==='boss'||S.traits.has(e))continue;
          S.traits.add(e);
          const roll=Math.random();
          if(roll<.13){e.nsxArmor=true;e.hp*=1.45;e.mhp=e.hp;e.nsxTrait='ARMORED';}
          else if(roll<.23){e.nsxVolatile=true;e.nsxTrait='VOLATILE';}
          else if(roll<.31){e.nsxMedic=true;e.nsxTrait='MEDIC';}
          else if(roll<.39){e.nsxCommander=true;e.nsxTrait='COMMANDER';}
          else if(roll<.47){e.nsxSniper=true;e.nsxTrait='SNIPER';}
          if(e.nsxTrait)text(e.x,e.y-(e.r||14)-17,e.nsxTrait,e.nsxArmor?'#ffc23d':'#ff8da8',11);
        }
      }
      this.medicClock+=dt;this.commanderClock+=dt;this.sniperClock+=dt;
      if(this.medicClock>=3.5){this.medicClock=0;for(const medic of this.enemies.filter(e=>e.nsxMedic&&!e.dead)){const ally=this.enemies.filter(e=>e!==medic&&!e.dead&&e.hp<e.mhp&&Math.hypot(e.x-medic.x,e.y-medic.y)<170).sort((a,b)=>(a.hp/a.mhp)-(b.hp/b.mhp))[0];if(ally){ally.hp=Math.min(ally.mhp,ally.hp+ally.mhp*.035);FX.ring(ally.x,ally.y,35,'#7effd0');}}}
      if(this.commanderClock>=4){this.commanderClock=0;for(const e of this.enemies.filter(x=>x.nsxCommander&&!x.dead)){for(const b of this.eb){if(Math.hypot(b.x-e.x,b.y-e.y)<190){b.vx*=1.08;b.vy*=1.08;}}}}
      if(this.sniperClock>=2.8){this.sniperClock=0;for(const e of this.enemies.filter(x=>x.nsxSniper&&!x.dead)){const a=Math.atan2(p.y-e.y,p.x-e.x);this.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*410,vy:Math.sin(a)*410,life:5,damage:18,nsxSniperShot:true});FX.ring(e.x,e.y,25,'#ff718c');}}
      for(const boss of this.enemies.filter(e=>e.k==='boss'&&!e.dead)){
        const ratio=boss.hp/Math.max(1,boss.mhp);
        const phase=ratio<=.25?3:ratio<=.5?2:ratio<=.75?1:0;
        if(phase>0&&!S.bossPhases.has(boss)){S.bossPhases.add(boss);text(boss.x,boss.y-100,'BOSS PHASE '+(phase+1),'#ff79dd',20);FX.ring(boss.x,boss.y,210,'#ff79dd');}
        if(phase>=2&&!S.bossAdds.has(boss)){S.bossAdds.add(boss);for(let i=0;i<4;i++)this.add(['shooter','spinner','lancer','bomber'][i],clamp(boss.x+(i-1.5)*70,35,v.w-35),boss.y+95);}
        if(phase>=3&&!S.bossFinal.has(boss)){S.bossFinal.add(boss);for(let i=0;i<18;i++){const a=i*Math.PI*2/18;this.eb.push({x:boss.x,y:boss.y,vx:Math.cos(a)*250,vy:Math.sin(a)*250,life:6,damage:25});}text(boss.x,boss.y-120,'CORE BREACH · FINAL PHASE','#ff4f9a',16);}
      }
      const hud=this.hud;
      if(hud){hud.style.display='block';hud.innerHTML='◆ '+(S.bounty&&!S.bounty.dead?'BOUNTY ACTIVE':'SCANNING TARGETS')+'<br>CHAIN '+S.chain+' · DODGES '+S.perfectDodges+'<br>MASTERY '+S.masteryRank+' · FOCUS '+Math.floor(S.focus*20)+'%<br>TRAITS '+this.enemies.filter(e=>e.nsxTrait&&!e.dead).length+' · GEMS '+S.gems;}
    };
  }
  install();
  window.NeonSwarmExpansion={version:1,features:25,stats:S};
})();
