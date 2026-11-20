(() => {
  'use strict';

  const core = window.NeonSwarmCore;
  if (!core || !core.Game || window.NeonSwarmApexLoaded) return;
  window.NeonSwarmApexLoaded = true;

  const { Game, Profile, FX, Input, getView, MAX_WAVE } = core;
  const S = {
    relics: Object.create(null), event: null, eventClock: 0, eventPulse: 0,
    objective: null, objectiveStarted: 0, objectiveKills: 0, objectiveGems: 0,
    objectiveDamage: 0, objectiveDashes: 0, kills: 0, gems: 0,
    caches: 0, pulseCooldown: 0, relicDraftOpen: false, chainLock: false,
    hudClock: 0, bossPatternClock: 0, runClock: 0, wave: 1,
    lastBanner: '', live: false
  };

  const EVENTS = [
    { id: 'rift', name: 'GRAVITY RIFT', detail: 'A distortion is pulling at the battle' },
    { id: 'meteor', name: 'METEOR WARNING', detail: 'Incoming meteor fragments detected' },
    { id: 'solar', name: 'SOLAR FLARE', detail: 'A solar burst is sweeping the sector' },
    { id: 'salvage', name: 'SALVAGE RUSH', detail: 'Extra crystals are drifting through the area' }
  ];

  const OBJECTIVES = [
    { id: 'swift', name: 'Rapid Response', detail: 'Clear this wave within 45 seconds' },
    { id: 'clean', name: 'Untouched Hull', detail: 'Finish without losing hull integrity' },
    { id: 'crystals', name: 'Crystal Survey', detail: 'Collect at least 3 crystals this wave' },
    { id: 'eliminate', name: 'Threat Sweep', detail: 'Defeat at least 8 enemies this wave' }
  ];

  const RELICS = [
    { id: 'kinetic', name: 'Kinetic Lens', detail: '+8% weapon damage per stack' },
    { id: 'aegis', name: 'Aegis Matrix', detail: 'Take 10% less hull damage per stack' },
    { id: 'phase', name: 'Phase Coil', detail: 'Dash cooldown recovers 18% faster per stack' },
    { id: 'magnet', name: 'Magnetar Core', detail: 'Pull crystals from much farther away' },
    { id: 'chain', name: 'Chain Reactor', detail: 'Kills arc damage into nearby enemies' },
    { id: 'nano', name: 'Nanite Swarm', detail: 'Every 8 kills repair a little hull' },
    { id: 'salvage', name: 'Salvage Protocol', detail: 'Earn bonus credits from every kill' },
    { id: 'resonance', name: 'Crystal Resonator', detail: 'Every crystal grants bonus score' },
    { id: 'echo', name: 'Echo Chamber', detail: 'Chance to echo a hit for extra damage' },
    { id: 'chrono', name: 'Chrono Shard', detail: 'Hostile projectiles move more slowly nearby' }
  ];

  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const view = () => getView();
  const count = id => Number(S.relics[id]) || 0;
  const totalRelics = () => Object.values(S.relics).reduce((sum, value) => sum + value, 0);
  const uniqueRelics = () => Object.keys(S.relics).filter(id => count(id) > 0).length;
  const synergy = () => totalRelics() >= 3 && uniqueRelics() >= 2 ? 1.05 : 1;
  function announce(message, color) {
    S.lastBanner = message;
    const v = view();
    if (FX && FX.text && v) FX.text(v.w / 2, v.h * .28, message, color || '#7df9ff', 18);
  }
  function credits(amount) {
    if (!Profile || !Profile.data) return;
    Profile.data.credits = (Number(Profile.data.credits) || 0) + amount;
    Profile.save?.();
    Profile.render?.();
  }

  function installUI() {
    if (document.getElementById('apex-hud')) return;
    const style = document.createElement('style');
    style.textContent =
      '#apex-hud{position:fixed;z-index:34;right:12px;top:calc(env(safe-area-inset-top,0px) + 54px);width:min(236px,43vw);padding:10px 12px;border:1px solid rgba(91,245,255,.38);border-radius:12px;background:rgba(5,9,29,.84);box-shadow:0 8px 28px rgba(0,0,0,.35);backdrop-filter:blur(10px);color:#eafaff;font:700 10px/1.55 ui-monospace,monospace;pointer-events:none;text-align:left}' +
      '#apex-hud strong{display:block;color:#67f5ff;font-size:11px;letter-spacing:1.2px;margin-bottom:3px}' +
      '#apex-hud .apex-muted{color:#a5bad9;font-weight:500}' +
      '#apex-pulse{position:fixed;z-index:35;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 18px);pointer-events:auto;border:1px solid #62f4ff;border-radius:10px;padding:9px 13px;background:rgba(5,15,40,.92);color:#eaffff;font:800 11px ui-monospace,monospace;box-shadow:0 0 18px rgba(61,245,255,.25)}' +
      '#apex-pulse:disabled{opacity:.48}' +
      '#apex-relic{position:fixed;z-index:1400;inset:0;display:none;align-items:center;justify-content:center;padding:14px;background:rgba(3,5,18,.9);backdrop-filter:blur(12px);color:#f4f8ff}' +
      '#apex-relic section{width:min(760px,96vw);padding:22px;border:1px solid rgba(91,245,255,.5);border-radius:18px;background:linear-gradient(145deg,#101a35,#17092c);text-align:center;box-shadow:0 20px 80px #0009}' +
      '#apex-relic h2{font-size:clamp(24px,5vw,38px);color:#fff;text-shadow:0 0 16px #3df5ff}' +
      '#apex-relic p{margin:9px auto 15px;color:#a9bbd8}' +
      '#apex-relic-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}' +
      '#apex-relic button{padding:14px 12px;border:1px solid rgba(91,245,255,.4);border-radius:12px;background:rgba(12,22,52,.95);color:#effaff;text-align:left;font:800 13px/1.4 ui-monospace,monospace}' +
      '#apex-relic button small{display:block;margin-top:7px;color:#afc4e5;font:500 11px/1.5 system-ui,sans-serif}' +
      '#apex-relic .apex-skip{display:block;margin:14px auto 0;text-align:center;background:#17352f}' +
      '@media(max-width:620px){#apex-hud{top:auto;bottom:calc(env(safe-area-inset-bottom,0px) + 82px);width:min(190px,55vw);font-size:9px}#apex-pulse{bottom:calc(env(safe-area-inset-bottom,0px) + 18px)}#apex-relic-options{grid-template-columns:1fr}#apex-relic section{max-height:90vh;overflow:auto}}';
    document.head.append(style);

    const hud = document.createElement('div');
    hud.id = 'apex-hud';
    hud.style.display = 'none';
    hud.innerHTML = '<strong>APEX PROTOCOL</strong><div id="apex-event">SECTOR STABLE</div><div id="apex-objective" class="apex-muted">Objective loading</div><div id="apex-relics" class="apex-muted">Relics: none</div><div id="apex-boss" class="apex-muted"></div>';
    document.body.append(hud);

    const pulse = document.createElement('button');
    pulse.id = 'apex-pulse';
    pulse.type = 'button';
    pulse.style.display = 'none';
    pulse.disabled = true;
    pulse.textContent = 'G · RIFT PULSE';
    pulse.addEventListener('click', activatePulse);
    document.body.append(pulse);

    const overlay = document.createElement('div');
    overlay.id = 'apex-relic';
    overlay.innerHTML = '<section><h2>APEX RELIC CACHE</h2><p>Choose one run-only relic. Relics stack, and collecting different types can unlock a synergy.</p><div id="apex-relic-options"></div><button class="apex-skip" id="apex-relic-skip" type="button">Continue without a relic</button></section>';
    document.body.append(overlay);
    document.getElementById('apex-relic-skip').addEventListener('click', closeRelicDraft);
    S.hud = hud;
    S.pulseButton = pulse;
    S.overlay = overlay;
  }

  function chooseObjective() {
    const objective = OBJECTIVES[Math.floor(Math.random() * OBJECTIVES.length)];
    S.objective = objective;
    S.objectiveStarted = Game.time || 0;
    S.objectiveKills = 0;
    S.objectiveGems = 0;
    S.objectiveDamage = 0;
    S.objectiveDashes = 0;
  }

  function startEvent(wave) {
    S.event = null;
    S.eventClock = 0;
    S.eventPulse = 0;
    if (wave % 3 !== 0 || wave >= 5 && [5, 10, 30, 50, MAX_WAVE].includes(wave)) return;
    S.event = EVENTS[(Math.floor(wave / 3) - 1) % EVENTS.length];
    const v = view();
    if (S.event.id === 'rift') {
      S.rift = { x: v.w * (.32 + Math.random() * .36), y: v.h * (.22 + Math.random() * .38), radius: Math.min(v.w, v.h) * .42 };
      FX?.ring?.(S.rift.x, S.rift.y, S.rift.radius, '#9a6cff');
    } else {
      S.rift = null;
    }
    announce(S.event.name, S.event.id === 'salvage' ? '#ffc23d' : '#7df9ff');
  }

  function spawnMeteorVolley() {
    const p = Game.p, v = view();
    if (!p || !v || !Game.eb) return;
    const amount = 5;
    for (let i = 0; i < amount; i++) {
      const x = clamp(p.x + (i - 2) * 88 + (Math.random() - .5) * 34, 12, v.w - 12);
      const y = -18 - Math.random() * 25;
      const angle = Math.atan2(p.y - y, p.x - x);
      Game.eb.push({ x, y, vx: Math.cos(angle) * 300, vy: Math.sin(angle) * 300, life: 6, damage: 22, apexHazard: true });
    }
    announce('METEOR FRAGMENTS INBOUND', '#ffb36b');
  }

  function spawnSolarBurst() {
    const v = view(), originX = v.w * (.3 + Math.random() * .4), originY = -8;
    for (let i = 0; i < 13; i++) {
      const angle = .45 + i * (Math.PI - .9) / 12;
      Game.eb.push({ x: originX, y: originY, vx: Math.cos(angle) * 245, vy: Math.sin(angle) * 245, life: 6, damage: 16, apexHazard: true });
    }
    announce('SOLAR FLARE · DODGE THE FAN', '#ff8b55');
  }

  function updateEvent(dt) {
    if (!S.event) return;
    S.eventClock += dt;
    if (S.event.id === 'rift' && S.rift) {
      const r = S.rift;
      for (const enemy of Game.enemies) {
        if (!enemy || enemy.dead || enemy.k === 'boss') continue;
        const dx = r.x - enemy.x, dy = r.y - enemy.y, d = Math.hypot(dx, dy);
        if (d > 18 && d < r.radius) {
          const pull = Math.min(25, 16 * (1 - d / r.radius));
          enemy.x += dx / d * pull * dt;
          enemy.y += dy / d * pull * dt;
        }
      }
      for (const bullet of Game.eb) {
        const dx = r.x - bullet.x, dy = r.y - bullet.y, d = Math.hypot(dx, dy);
        if (d > 12 && d < r.radius) {
          bullet.vx += dx / d * 34 * dt;
          bullet.vy += dy / d * 34 * dt;
        }
      }
      if (S.eventClock - S.eventPulse > 8) {
        S.eventPulse = S.eventClock;
        FX?.ring?.(r.x, r.y, r.radius, '#9a6cff');
      }
    } else if (S.event.id === 'meteor' && S.eventClock - S.eventPulse > 5.2) {
      S.eventPulse = S.eventClock;
      spawnMeteorVolley();
    } else if (S.event.id === 'solar' && S.eventClock - S.eventPulse > 6.4) {
      S.eventPulse = S.eventClock;
      spawnSolarBurst();
    } else if (S.event.id === 'salvage' && S.eventClock - S.eventPulse > 3.5) {
      S.eventPulse = S.eventClock;
      if (Game.gems.length < 10) {
        const v = view();
        Game.gems.push({ x: v.w * (.18 + Math.random() * .64), y: v.h * (.18 + Math.random() * .5), vx: 0, vy: 20, a: 0, apexSalvage: true });
        announce('SALVAGE CRYSTAL DETECTED', '#ffc23d');
      }
    }
  }

  function updateBossPhases(dt) {
    S.bossPatternClock += dt;
    for (const boss of Game.enemies) {
      if (!boss || boss.dead || boss.k !== 'boss') continue;
      const ratio = boss.hp / Math.max(1, boss.mhp);
      const phase = ratio <= .25 ? 3 : ratio <= .5 ? 2 : ratio <= .75 ? 1 : 0;
      if (phase > (boss.apexPhase || 0)) {
        boss.apexPhase = phase;
        boss.apexExposedUntil = Game.time + 2.7;
        FX?.ring?.(boss.x, boss.y, 180 + phase * 55, '#ff62c7');
        announce('BOSS CORE EXPOSED · PHASE ' + (phase + 1), '#ff78d5');
        const v = view(), speed = Game.wave >= 30 ? 245 : 205;
        for (let i = 0; i < 12 + phase * 2; i++) {
          const angle = i * Math.PI * 2 / (12 + phase * 2) + phase * .24;
          Game.eb.push({ x: boss.x, y: boss.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 6, damage: Game.wave >= 50 ? 35 : 22, apexBossShot: true });
        }
        if (phase >= 2) {
          for (let i = 0; i < 2; i++) {
            const x = clamp(boss.x + (i ? 1 : -1) * Math.min(130, v.w * .2), 30, v.w - 30);
            Game.add(['spinner', 'shooter'][i], x, clamp(boss.y + 105, 40, v.h * .65));
          }
        }
      }
      if (S.bossPatternClock > 7.5) {
        S.bossPatternClock = 0;
        const p = Game.p, angle = p ? Math.atan2(p.y - boss.y, p.x - boss.x) : Math.PI / 2;
        for (let i = -3; i <= 3; i++) {
          const shot = angle + i * .18 + Game.time * .32;
          const speed = Game.wave >= 50 ? 265 : 220;
          Game.eb.push({ x: boss.x, y: boss.y, vx: Math.cos(shot) * speed, vy: Math.sin(shot) * speed, life: 6, damage: Game.wave >= 50 ? 30 : 18, apexBossShot: true });
        }
        announce('BOSS SPIRAL VOLLEY', '#ff78d5');
      }
    }
  }

  function updateHud() {
    if (!S.hud || !S.live) return;
    const event = S.event ? S.event.name : 'SECTOR STABLE';
    const goal = S.objective ? S.objective.name + ' · ' + S.objective.detail : 'No active contract';
    const relicSummary = Object.entries(S.relics).filter(([, value]) => value > 0).map(([id, value]) => {
      const relic = RELICS.find(item => item.id === id);
      return (relic ? relic.name : id) + (value > 1 ? ' ×' + value : '');
    }).join(', ') || 'none';
    const boss = Game.enemies.find(enemy => enemy && !enemy.dead && enemy.k === 'boss');
    const bossLine = boss ? 'BOSS ARMOR ' + Math.ceil(Math.max(0, boss.apexArmor || 0)).toLocaleString() + ' · CORE ' + Math.ceil(boss.hp / Math.max(1, boss.mhp) * 100) + '%' : '';
    const eventNode = document.getElementById('apex-event');
    const objectiveNode = document.getElementById('apex-objective');
    const relicNode = document.getElementById('apex-relics');
    const bossNode = document.getElementById('apex-boss');
    if (eventNode) eventNode.textContent = event;
    if (objectiveNode) objectiveNode.textContent = goal;
    if (relicNode) relicNode.textContent = 'Relics: ' + relicSummary;
    if (bossNode) bossNode.textContent = bossLine;
    if (S.pulseButton) {
      const ready = S.pulseCooldown <= 0;
      S.pulseButton.disabled = !ready || Game.state !== 'play';
      S.pulseButton.textContent = ready ? 'G · RIFT PULSE' : 'RIFT PULSE · ' + Math.ceil(S.pulseCooldown) + 's';
    }
  }

  function activatePulse() {
    if (Game.state !== 'play' || S.pulseCooldown > 0 || !Game.p) return;
    S.pulseCooldown = 32;
    for (const bullet of Game.eb) bullet.life = 0;
    Game.p.shield = Math.max(Game.p.shield || 0, 4.5);
    for (const enemy of Game.enemies) {
      if (!enemy || enemy.dead) continue;
      enemy.fireT = Math.max(Number(enemy.fireT) || 0, 1.8);
    }
    const v = view();
    FX?.ring?.(Game.p.x, Game.p.y, Math.max(v.w, v.h) * .7, '#65f4ff');
    FX?.burst?.(Game.p.x, Game.p.y, '#65f4ff', 30, 360, .5, 3);
    announce('RIFT PULSE · HOSTILE FIRE PURGED', '#65f4ff');
  }

  function relicChoices() {
    const pool = RELICS.filter(item => count(item.id) < 3);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 3);
  }

  function closeRelicDraft() {
    if (!S.overlay) return;
    S.overlay.style.display = 'none';
    S.relicDraftOpen = false;
    if (Game.state === 'pause') Game.resume();
  }

  function chooseRelic(id) {
    const relic = RELICS.find(item => item.id === id);
    if (!relic || count(id) >= 3) return;
    S.relics[id] = count(id) + 1;
    announce(relic.name.toUpperCase() + ' · STACK ' + S.relics[id], '#ffc23d');
    if (synergy() > 1) announce('RELIC SYNERGY ONLINE · +5% POWER', '#7effd0');
    closeRelicDraft();
    updateHud();
  }

  function openRelicDraft() {
    if (!S.overlay || S.relicDraftOpen || Game.state !== 'play') return;
    const host = document.getElementById('apex-relic-options');
    host.innerHTML = '';
    const choices = relicChoices();
    if (!choices.length) return;
    for (const item of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = item.name + '<small>' + item.detail + '<br>Current stacks: ' + count(item.id) + '/3</small>';
      button.addEventListener('click', () => chooseRelic(item.id));
      host.append(button);
    }
    S.relicDraftOpen = true;
    S.overlay.style.display = 'flex';
    Game.pause();
  }

  const oldStart = Game.start;
  Game.start = function () {
    S.relics = Object.create(null);
    S.event = null;
    S.objective = null;
    S.kills = 0;
    S.gems = 0;
    S.caches = 0;
    S.pulseCooldown = 0;
    S.relicDraftOpen = false;
    S.chainLock = false;
    S.runClock = 0;
    S.bossPatternClock = 0;
    S.hudClock = 0;
    S.eventClock = 0;
    S.eventPulse = 0;
    S.live = true;
    S.lastBanner = '';
    if (S.hud) S.hud.style.display = 'block';
    if (S.pulseButton) S.pulseButton.style.display = 'block';
    if (S.overlay) S.overlay.style.display = 'none';
    oldStart.call(this);
    installUI();
    chooseObjective();
    updateHud();
  };

  const oldSpawnWave = Game.spawnWave;
  Game.spawnWave = function () {
    oldSpawnWave.call(this);
    S.wave = this.wave;
    startEvent(this.wave);
    chooseObjective();
    if (this.wave > 1 && this.wave % 6 === 0) {
      const v = view();
      this.pu.push({ x: v.w / 2, y: v.h * .62, k: 'shield', t: 35, a: 0, apexCache: true });
      announce('SUPPLY CACHE DEPLOYED', '#ffc23d');
    }
    for (const boss of this.enemies) {
      if (boss && boss.k === 'boss') {
        boss.apexArmor = Math.min(50000, Math.max(450, Math.round(boss.mhp * .04)));
        boss.apexArmorMax = boss.apexArmor;
        boss.apexPhase = 0;
      }
    }
    updateHud();
  };

  const oldDamage = Game.damage;
  Game.damage = function (enemy, amount) {
    if (!enemy || enemy.dead) return oldDamage.call(this, enemy, amount);
    let damage = Math.max(0, Number(amount) || 0);
    damage *= 1 + count('kinetic') * .08;
    damage *= synergy();
    if (count('echo') && Math.random() < Math.min(.28, count('echo') * .08)) {
      damage *= 1.75;
      FX?.text?.(enemy.x, enemy.y - 24, 'ECHO HIT!', '#80f5ff', 13);
    }
    if (enemy.k === 'boss') {
      if (enemy.apexArmor > 0) {
        const absorbed = Math.min(enemy.apexArmor, damage);
        enemy.apexArmor -= absorbed;
        damage -= absorbed;
        if (enemy.apexArmor <= 0) {
          enemy.apexArmor = 0;
          announce('BOSS ARMOR BREACHED · CORE EXPOSED', '#ffc23d');
          FX?.ring?.(enemy.x, enemy.y, 160, '#ffc23d');
        }
      }
      if (enemy.apexExposedUntil && this.time < enemy.apexExposedUntil) damage *= 1.5;
    }
    if (damage > 0) oldDamage.call(this, enemy, damage);
  };

  const oldKill = Game.kill;
  Game.kill = function (enemy) {
    if (!enemy || enemy.dead) return oldKill.call(this, enemy);
    oldKill.call(this, enemy);
    S.kills++;
    S.objectiveKills++;
    if (count('salvage')) credits(count('salvage') * 2);
    if (count('nano') && S.kills % 8 === 0 && this.p && !this.p.dead) {
      const repair = 6 * count('nano');
      this.p.hp = Math.min(this.p.maxHp, this.p.hp + repair);
      FX?.text?.(this.p.x, this.p.y - 28, '+' + repair + ' NANITES', '#7effd0', 13);
    }
    if (count('chain') && !S.chainLock) {
      const nearby = this.enemies.filter(target => target && !target.dead && target !== enemy)
        .map(target => ({ target, d: Math.hypot(target.x - enemy.x, target.y - enemy.y) }))
        .filter(item => item.d < 145).sort((a, b) => a.d - b.d).slice(0, 2);
      if (nearby.length) {
        S.chainLock = true;
        for (const item of nearby) this.damage(item.target, 24 * count('chain'));
        S.chainLock = false;
        FX?.ring?.(enemy.x, enemy.y, 145, '#76f7ff');
      }
    }
  };

  const oldGem = Game.gem;
  Game.gem = function (gem) {
    oldGem.call(this, gem);
    S.gems++;
    S.objectiveGems++;
    if (count('resonance')) {
      const bonus = 100 * count('resonance');
      this.awardScore(bonus);
      FX?.text?.(this.p.x, this.p.y - 38, '+' + bonus + ' RESONANCE', '#7effd0', 12);
    }
  };

  const oldHurt = Game.hurt;
  Game.hurt = function (amount) {
    const player = this.p;
    const before = player ? player.hp : 0;
    let damage = Math.max(0, Number(amount) || 0);
    damage *= Math.max(.55, 1 - count('aegis') * .1);
    oldHurt.call(this, damage);
    if (player && player.hp < before) S.objectiveDamage += before - player.hp;
  };

  const oldControl = Game.control;
  Game.control = function (dt) {
    const dashRequested = Input && Input.dash;
    oldControl.call(this, dt);
    if (dashRequested && this.p && this.p.dashCd > 0) S.objectiveDashes++;
    if (count('phase') && this.p && this.p.dashCd > 0) {
      this.p.dashCd = Math.max(0, this.p.dashCd - dt * count('phase') * .18);
    }
  };

  const oldPower = Game.power;
  Game.power = function (pickup) {
    if (pickup && pickup.apexCache) {
      S.caches++;
      const roll = Math.random();
      const player = this.p;
      if (player) {
        if (roll < .34) {
          player.hp = Math.min(player.maxHp, player.hp + Math.max(30, player.maxHp * .12));
          FX?.text?.(player.x, player.y - 32, 'CACHE · HULL REPAIRED', '#7effd0', 14);
        } else if (roll < .67) {
          player.shield = Math.max(player.shield, 9);
          FX?.text?.(player.x, player.y - 32, 'CACHE · SHIELD 9s', '#65f4ff', 14);
        } else {
          player.rapid = Math.max(player.rapid, 10);
          FX?.text?.(player.x, player.y - 32, 'CACHE · RAPID FIRE', '#ffc23d', 14);
        }
      }
      credits(35);
      return;
    }
    return oldPower.call(this, pickup);
  };

  const oldClearWave = Game.clearWave;
  Game.clearWave = function () {
    const objective = S.objective;
    const elapsed = Math.max(0, (this.time || 0) - S.objectiveStarted);
    const complete = objective && (
      objective.id === 'swift' && elapsed <= 45 ||
      objective.id === 'clean' && S.objectiveDamage <= 0 ||
      objective.id === 'crystals' && S.objectiveGems >= 3 ||
      objective.id === 'eliminate' && S.objectiveKills >= 8
    );
    const wave = this.wave;
    oldClearWave.call(this);
    if (complete) {
      const reward = 1200 * Math.max(1, this.mult || 1);
      const earned = this.awardScore(reward);
      credits(40 + Math.min(100, wave * 2));
      FX?.text?.(view().w / 2, view().h * .39, 'CONTRACT COMPLETE · +' + earned, '#ffc23d', 18);
    }
    if (wave > 0 && wave % 5 === 0 && wave < MAX_WAVE) openRelicDraft();
    updateHud();
  };

  function hideApexUI() {
    S.live = false;
    S.relicDraftOpen = false;
    if (S.hud) S.hud.style.display = 'none';
    if (S.pulseButton) {
      S.pulseButton.disabled = true;
      S.pulseButton.style.display = 'none';
    }
    if (S.overlay) S.overlay.style.display = 'none';
  }

  const oldOver = Game.over;
  Game.over = function () {
    oldOver.call(this);
    hideApexUI();
  };

  const oldGoMenu = Game.goMenu;
  Game.goMenu = function () {
    oldGoMenu.call(this);
    hideApexUI();
  };

  const oldUpdate = Game.update;
  Game.update = function (dt) {
    const bullets = this.eb ? this.eb.slice() : [];
    const slowed = [];
    const chronoScale = .84;
    if (count('chrono') && this.p) {
      const v = view(), radius = Math.min(v.w, v.h) * .42;
      for (const bullet of bullets) {
        if (!bullet || bullet.life <= 0) continue;
        const d = Math.hypot(bullet.x - this.p.x, bullet.y - this.p.y);
        if (d < radius) {
          bullet.vx *= chronoScale;
          bullet.vy *= chronoScale;
          slowed.push(bullet);
        }
      }
    }
    oldUpdate.call(this, dt);
    for (const bullet of slowed) {
      bullet.vx /= chronoScale;
      bullet.vy /= chronoScale;
    }
    if (this.state !== 'play' || !this.p || this.p.dead) {
      updateHud();
      return;
    }
    S.runClock += dt;
    S.pulseCooldown = Math.max(0, S.pulseCooldown - dt);
    updateEvent(dt);
    updateBossPhases(dt);
    if (count('magnet')) {
      const range = 120 + count('magnet') * 115;
      for (const gem of this.gems) {
        if (!gem || gem.dead) continue;
        const dx = this.p.x - gem.x, dy = this.p.y - gem.y, d = Math.hypot(dx, dy) || 1;
        if (d > 80 && d < range) {
          const speed = 190 + 280 * (1 - d / range);
          gem.x += dx / d * speed * dt;
          gem.y += dy / d * speed * dt;
        }
      }
    }
    S.hudClock += dt;
    if (S.hudClock > .3) {
      S.hudClock = 0;
      updateHud();
    }
  };

  window.addEventListener('keydown', event => {
    if (event.code === 'KeyG' && !event.repeat && Game.state === 'play') {
      event.preventDefault();
      activatePulse();
    }
  });

  installUI();
  window.NeonSwarmApex = { version: 1, features: 20, state: S, activatePulse };
})();