(() => {
  'use strict';

  const core = window.NeonSwarmCore;
  if (!core) return;

  const { Game, Profile, Input, FX, Sfx, TYPES, MAX_WAVE, canvas } = core;
  const STORAGE_KEY = 'neonswarm.features';
  const MODE_NAMES = {
    campaign: 'Campaign', daily: 'Daily challenge', endless: 'Endless survival',
    boss: 'Boss rush', coop: 'Local co-op', timeattack: 'Time attack',
    bullethell: 'Bullet hell', survival: 'Veteran survival', hardcore: 'Hardcore'
  };
  const WEAPONS = {
    standard: 'Standard', scatter: 'Scatter', rapid: 'Rapid pulse', lance: 'Lance'
  };
  const LOADOUTS = {
    balanced: 'Balanced', agile: 'Agile', guardian: 'Guardian', salvage: 'Salvager'
  };
  const ACCESSIBILITY = {
    standard: 'Standard', calm: 'Reduced flashes', contrast: 'High contrast', large: 'Large HUD'
  };
  const DAILY_RULES = [
    { title: 'Hot Core', detail: 'Enemies hit harder. Scores are worth 1.5x.', damage: 1.5, score: 1.5 },
    { title: 'Iron Swarm', detail: 'Enemies have more armor. Every kill earns bonus score.', health: 1.35, score: 1.25 },
    { title: 'Supply Blackout', detail: 'Fewer safe moments. Incoming damage is increased.', damage: 1.25, health: 1.15 }
  ];
  const BOSS_WAVES = [5, 10, 30, 50, 60];
  const ACHIEVEMENTS = [
    { id: 'first-blood', title: 'First Blood', description: 'Defeat your first enemy.', stat: 'kills', goal: 1, reward: 100 },
    { id: 'swarm-breaker', title: 'Swarm Breaker', description: 'Defeat 100 enemies across all runs.', stat: 'kills', goal: 100, reward: 250 },
    { id: 'crystal-collector', title: 'Crystal Collector', description: 'Collect 50 gems.', stat: 'gems', goal: 50, reward: 300 },
    { id: 'wave-runner', title: 'Wave Runner', description: 'Clear 10 waves.', stat: 'waves', goal: 10, reward: 500 },
    { id: 'boss-hunter', title: 'Boss Hunter', description: 'Defeat five bosses.', stat: 'bosses', goal: 5, reward: 1000 },
    { id: 'score-machine', title: 'Score Machine', description: 'Earn 25,000 score across all runs.', stat: 'totalScore', goal: 25000, reward: 500 },
    { id: 'veteran-pilot', title: 'Veteran Pilot', description: 'Complete 10 runs.', stat: 'runs', goal: 10, reward: 350 }
  ];
  const STAT_LABELS = [
    ['runs', 'Runs completed'], ['kills', 'Enemies defeated'], ['gems', 'Gems collected'],
    ['waves', 'Waves cleared'], ['bosses', 'Bosses defeated'], ['totalScore', 'Lifetime score'],
    ['bestScore', 'Personal best score'], ['bestWave', 'Best wave reached']
  ];

  function utcDate() {
    return new Date().toISOString().slice(0, 10);
  }

  function dailyRule(date = utcDate()) {
    const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
    return DAILY_RULES[((day % DAILY_RULES.length) + DAILY_RULES.length) % DAILY_RULES.length];
  }

  function seededRandom(date) {
    let seed = 2166136261;
    for (const character of date) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
    return () => {
      seed += 0x6d2b79f5;
      let value = seed;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      const mission = saved.mission && saved.mission.date === utcDate() ? saved.mission : null;
      const dailyScores = saved.dailyScores && typeof saved.dailyScores === 'object' ? saved.dailyScores : {};
      for (const date of Object.keys(dailyScores)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(dailyScores[date])) delete dailyScores[date];
        else dailyScores[date] = dailyScores[date].filter(Number.isSafeInteger).filter(score => score >= 0).sort((a, b) => b - a).slice(0, 5);
      }
      return {
        mode: MODE_NAMES[saved.mode] ? saved.mode : 'campaign',
        autopilot: saved.autopilot === true,
        weapon: WEAPONS[saved.weapon] ? saved.weapon : 'standard',
        loadout: LOADOUTS[saved.loadout] ? saved.loadout : 'balanced',
        accessibility: ACCESSIBILITY[saved.accessibility] ? saved.accessibility : 'standard',
        endlessBest: Number.isSafeInteger(saved.endlessBest) ? Math.max(0, saved.endlessBest) : 0,
        dailyScores: Object.fromEntries(Object.keys(dailyScores).sort().slice(-7).map(date => [date, dailyScores[date]])),
        mission: mission || makeMission(),
        lastReplay: saved.lastReplay && Array.isArray(saved.lastReplay.samples) ? saved.lastReplay : null,
        stats: normalizeStats(saved.stats),
        achievements: Array.isArray(saved.achievements) ? saved.achievements : []
      };
    } catch (_) {
      return {
        mode: 'campaign', weapon: 'standard', loadout: 'balanced', accessibility: 'standard',
        endlessBest: 0, dailyScores: {}, mission: makeMission(), lastReplay: null, autopilot: false
      };
    }
  }

  function makeMission() {
    const day = Math.floor(Date.parse(`${utcDate()}T00:00:00Z`) / 86400000);
    const options = [
      { type: 'kills', goal: 30, label: 'Eliminate 30 enemies' },
      { type: 'waves', goal: 4, label: 'Clear 4 waves' },
      { type: 'gems', goal: 25, label: 'Collect 25 gems' }
    ];
    const goal = options[((day % options.length) + options.length) % options.length];
    return { date: utcDate(), type: goal.type, goal: goal.goal, label: goal.label, progress: 0, claimed: false };
  }

  let state = loadState();
  state.stats = normalizeStats(state.stats);
  state.achievements = Array.isArray(state.achievements)
    ? [...new Set(state.achievements.filter(id => ACHIEVEMENTS.some(item => item.id === id)))]
    : [];
  let runRecorded = false;
  let runMode = state.mode;
  let runDate = utcDate();
  const nativeRandom = Math.random;
  let runSamples = [];
  let sampleClock = 0;
  let bossRushIndex = 0;
  let replayFrame = 0;
  let replayPlaying = false;
  let pilot2Element;

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (core.savedData) core.savedData.schedule();
    } catch (_) {}
  }

  function addStyle() {
    const style = document.createElement('style');
    style.textContent = `
      .feature-panel{gap:10px;padding:14px;}
      .feature-tabs{display:flex;gap:6px;max-width:min(720px,96vw);overflow:auto;padding:3px;}
      .feature-tabs button{padding:8px 11px;font-size:12px;white-space:nowrap;}
      .feature-content{width:min(720px,96vw);max-height:62vh;overflow:auto;display:flex;flex-direction:column;align-items:center;gap:12px;padding:4px;}
      .feature-content[hidden]{display:none!important}
      .feature-row{display:flex;gap:9px;justify-content:center;flex-wrap:wrap;width:min(620px,94vw);}
      .feature-choice{min-width:145px;max-width:210px;flex:1;padding:12px;border:1px solid rgba(61,245,255,.35);border-radius:8px;background:rgba(17,8,43,.9);color:var(--ink);text-align:left;}
      .feature-choice.selected{border-color:var(--cyan);box-shadow:inset 0 0 14px rgba(61,245,255,.15);}
      .feature-choice strong,.feature-choice small{display:block}
      .feature-choice small{margin-top:5px;color:var(--dim);font-size:11px}
      .feature-note{color:var(--dim);font-size:12px;max-width:52ch}
      .feature-daily-scores{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin:0;padding:0;list-style:none;color:var(--gold);font-size:11px}
      .feature-meter{width:min(520px,90vw);height:8px;background:#1a2340;border-radius:8px;overflow:hidden}
      .feature-meter i{display:block;height:100%;background:var(--cyan)}
      #feature-replay{width:min(620px,92vw);height:200px;background:#080c17;border:1px solid rgba(61,245,255,.4);border-radius:8px}
      .feature-stat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:min(620px,94vw)}
      .feature-stat{padding:10px;border:1px solid rgba(61,245,255,.2);border-radius:8px;background:rgba(17,8,43,.72);text-align:left}
      .feature-stat span,.feature-stat strong{display:block}
      .feature-stat span{color:var(--dim);font-size:10px}
      .feature-stat strong{color:var(--cyan);font-size:18px;margin-top:3px}
      .feature-achievement-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:min(620px,94vw)}
      .feature-achievement{padding:10px;border:1px solid rgba(61,245,255,.2);border-radius:8px;background:rgba(17,8,43,.72);text-align:left}
      .feature-achievement.unlocked{border-color:rgba(255,215,90,.7);box-shadow:inset 0 0 12px rgba(255,215,90,.08)}
      .feature-achievement strong,.feature-achievement small,.feature-achievement span{display:block}
      .feature-achievement small{color:var(--dim);font-size:10px;margin:4px 0 8px}
      .feature-achievement span{font-size:10px;color:var(--gold)}
      .feature-achievement-meter{height:5px;background:#1a2340;border-radius:6px;overflow:hidden;margin-top:7px}
      .feature-achievement-meter i{display:block;height:100%;background:var(--cyan)}
      .feature-pilot{position:fixed;z-index:6;width:24px;height:30px;display:none;background:#79ffad;clip-path:polygon(50% 0,100% 100%,50% 78%,0 100%);filter:drop-shadow(0 0 9px #79ffad);pointer-events:none;transform:translate(-50%,-50%)}
      body.access-contrast{--ink:#fff;--dim:#e3efff;--cyan:#00ffff;--pink:#ff4d00;}
      body.access-contrast canvas{filter:contrast(1.28) saturate(1.18)}
      body.access-large #fps-counter{font-size:17px;padding:8px 11px}
      body.access-large #pb{font-size:19px;min-height:44px}
      body.access-large .panel p,body.access-large .panel button{font-size:19px}
      body.access-calm *{scroll-behavior:auto!important}
      #desktop-update-overlay{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:rgba(3,4,16,.86);backdrop-filter:blur(12px);font-family:inherit}
      #desktop-update-card{width:min(470px,94vw);padding:26px;border:1px solid rgba(61,245,255,.45);border-radius:16px;background:linear-gradient(145deg,#111a35,#130824);box-shadow:0 22px 90px rgba(0,0,0,.55),inset 0 0 28px rgba(61,245,255,.06);text-align:left}
      #desktop-update-card h2{margin:0 0 8px;color:#f4eaff;font-size:22px}
      #desktop-update-card p{color:#a592d6;font-size:12px}
      #desktop-update-track{height:12px;margin:20px 0 9px;overflow:hidden;border-radius:10px;background:#202943}
      #desktop-update-fill{height:100%;width:0;background:linear-gradient(90deg,#3df5ff,#79ffad);box-shadow:0 0 18px #3df5ff;transition:width .2s}
      #desktop-update-footer{display:flex;justify-content:space-between;align-items:center;color:#3df5ff;font-size:13px;font-weight:800}
      #desktop-update-card button{margin-top:18px}
      @media(max-width:720px){.feature-tabs{max-width:94vw}.feature-content{max-height:58vh}.feature-choice{min-width:130px}}
    `;
    document.head.append(style);
  }

  function createPanel() {
    const panel = document.createElement('section');
    panel.id = 'feature-panel';
    panel.className = 'panel feature-panel';
    panel.innerHTML = `
      <h2>Mission Control</h2>
      <div class="feature-tabs" role="tablist" aria-label="Mission control views">
        <button type="button" data-feature-tab="modes">Modes</button>
        <button type="button" data-feature-tab="gear">Weapons &amp; loadouts</button>
        <button type="button" data-feature-tab="mission">Mission board</button>
        <button type="button" data-feature-tab="replay">Flight recorder</button>
        <button type="button" data-feature-tab="access">Accessibility</button>
        <button type="button" data-feature-tab="records">Records &amp; achievements</button>
      </div>
      <div class="feature-content" data-feature-view="modes">
        <p id="feature-daily" class="feature-note"></p>
        <ol id="feature-daily-scores" class="feature-daily-scores" aria-label="Today's daily challenge leaderboard"></ol>
        <div class="feature-row" id="feature-modes"></div>
        <p id="feature-mode-note" class="feature-note"></p>
        <div class="feature-row" id="feature-autopilot"></div>
        <button id="feature-launch" type="button">Launch selected run</button>
      </div>
      <div class="feature-content" data-feature-view="gear" hidden>
        <p class="feature-note">Choose a firing system and flight package. Both persist between sessions.</p>
        <div class="feature-row" id="feature-weapons"></div>
        <div class="feature-row" id="feature-loadouts"></div>
      </div>
      <div class="feature-content" data-feature-view="mission" hidden>
        <p class="feature-note">Daily objective · reward: 300 credits</p>
        <strong id="feature-mission-title"></strong>
        <div class="feature-meter"><i id="feature-mission-fill"></i></div>
        <span id="feature-mission-progress" class="feature-note"></span>
        <button id="feature-mission-claim" type="button">Claim 300 credits</button>
      </div>
      <div class="feature-content" data-feature-view="replay" hidden>
        <p id="feature-replay-summary" class="feature-note">No recorded sortie yet.</p>
        <canvas id="feature-replay" width="620" height="200" aria-label="Last run flight path"></canvas>
        <button id="feature-replay-play" class="alt" type="button" disabled>Play flight path</button>
      </div>
      <div class="feature-content" data-feature-view="access" hidden>
        <p class="feature-note">Reduce visual intensity or enlarge key interface elements.</p>
        <div class="feature-row" id="feature-accessibility"></div>
      </div>
      <div class="feature-content" data-feature-view="records" hidden>
        <p id="feature-achievement-summary" class="feature-note"></p>
        <div id="feature-stat-grid" class="feature-stat-grid"></div>
        <h3>Achievement collection</h3>
        <div id="feature-achievement-list" class="feature-achievement-list"></div>
        <p class="feature-note">Credits are awarded automatically the first time each achievement unlocks.</p>
      </div>
      <button id="feature-close" class="alt" type="button">Back</button>
    `;
    document.body.append(panel);

    const pilot = document.createElement('div');
    pilot.className = 'feature-pilot';
    pilot.setAttribute('aria-label', 'Second co-op pilot');
    document.body.append(pilot);
    pilot2Element = pilot;

    const menuButton = document.createElement('button');
    menuButton.className = 'alt';
    menuButton.type = 'button';
    menuButton.textContent = 'Modes & features';
    menuButton.onclick = () => openPanel('menu');
    const playButton = document.getElementById('play');
    playButton?.parentNode.insertBefore(menuButton, playButton);

    const pauseButton = document.createElement('button');
    pauseButton.className = 'alt';
    pauseButton.type = 'button';
    pauseButton.textContent = 'Modes & features';
    pauseButton.onclick = () => openPanel('pause');
    const quitButton = document.getElementById('quit');
    quitButton?.parentNode.insertBefore(pauseButton, quitButton);
    return panel;
  }

  function openPanel(from) {
    state.returnTo = from;
    renderAll();
    Game.set('features');
    showTab('modes');
  }

  function showTab(tab) {
    document.querySelectorAll('[data-feature-view]').forEach(view => {
      view.hidden = view.dataset.featureView !== tab;
    });
    document.querySelectorAll('[data-feature-tab]').forEach(button => {
      const selected = button.dataset.featureTab === tab;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    if (tab === 'replay') drawReplay(false);
    if (tab === 'records') renderRecords();
  }

  function buttonChoice(host, key, label, detail, selected, choose) {
    const button = document.createElement('button');
    button.className = 'feature-choice' + (selected === key ? ' selected' : '');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(selected === key));
    const title = document.createElement('strong');
    title.textContent = label;
    const description = document.createElement('small');
    description.textContent = detail;
    button.append(title, description);
    button.onclick = () => { choose(key); renderAll(); };
    host.append(button);
  }

  function renderAll() {
    const modes = [
      ['campaign', 'Campaign', 'The original 60-wave operation.'],
      ['daily', 'Daily challenge', 'One rotating rule set, shared by date.'],
      ['endless', 'Endless survival', 'Keep fighting after wave 60.'],
      ['boss', 'Boss rush', 'Five major bosses, one continuous run.'],
      ['coop', 'Local co-op', 'Arrow keys pilot a second support ship.'],
      ['timeattack', 'Time attack', 'Score as much as possible before 90 seconds run out.'],
      ['bullethell', 'Bullet hell', 'Dodge extra incoming projectile volleys.'],
      ['survival', 'Veteran survival', 'Start at wave 10 and fight endless escalating waves.'],
      ['hardcore', 'Hardcore', 'Waves 1–20: 25,000 HP enemies. +10,000 damage on every wave. 100,000 player HP and a 30-orb final-wave barrage.']
    ];
    const modeHost = document.getElementById('feature-modes');
    modeHost.replaceChildren();
    for (const [key, title, detail] of modes) {
      buttonChoice(modeHost, key, title, detail, state.mode, value => {
        state.mode = value;
        saveState();
      });
    }
    const rule = dailyRule();
    const dailyScores = state.dailyScores[utcDate()] || [];
    const dailyList = document.getElementById('feature-daily-scores');
    dailyList.replaceChildren();
    if (!dailyScores.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No scores yet today';
      dailyList.append(empty);
    } else {
      dailyScores.forEach((entry, index) => {
        const score = document.createElement('li');
        score.textContent = `${index + 1}. ${entry.toLocaleString()}`;
        dailyList.append(score);
      });
    }
    document.getElementById('feature-daily').textContent = `DAILY ${utcDate()} · ${rule.title}: ${rule.detail}`;
    document.getElementById('feature-mode-note').textContent = state.mode === 'endless' || state.mode === 'survival'
      ? `Endless best: wave ${state.endlessBest}. ${state.mode === 'survival' ? 'Veteran survival begins at wave 10.' : ''}`
      : state.mode === 'boss'
        ? 'Bosses: waves 5, 10, 30, 50, and 60.'
        : state.mode === 'coop'
          ? 'Pilot 1: WASD / touch. Pilot 2: arrow keys; weapon auto-fires.'
          : state.mode === 'timeattack'
            ? '90 seconds. Your final score is the target.'
            : state.mode === 'bullethell'
              ? 'Watch for extra incoming volleys from above.'
              : state.mode === 'hardcore'
                ? '100,000 player HP. +10,000 damage on every wave. Every wave 1–20 has a boss; enemies and bosses have 25,000 HP. Wave 60 fires 30 orbs dealing 100 damage each every 2.4 seconds.'
                : 'Select a mode, then launch it from here or the main menu.';
    const autopilotHost = document.getElementById('feature-autopilot');
    autopilotHost.replaceChildren();
    buttonChoice(autopilotHost, 'autopilot', state.autopilot ? 'Autopilot: ON' : 'Autopilot: OFF', 'AI steering avoids enemies and incoming shots, and collects nearby supplies. Toggle during a run too.', state.autopilot ? 'autopilot' : '', () => {
      state.autopilot = !state.autopilot;
      saveState();
      renderAll();
    });

    const weaponHost = document.getElementById('feature-weapons');
    weaponHost.replaceChildren();
    for (const [key, label, detail] of [
      ['standard', 'Standard', 'Balanced auto-fire.'],
      ['scatter', 'Scatter', 'Adds a wider side volley.'],
      ['rapid', 'Rapid pulse', 'Faster shots with reduced damage.'],
      ['lance', 'Lance', 'Slower, stronger shots.']
    ]) buttonChoice(weaponHost, key, label, detail, state.weapon, value => {
      state.weapon = value;
      saveState();
    });

    const loadoutHost = document.getElementById('feature-loadouts');
    loadoutHost.replaceChildren();
    for (const [key, label, detail] of [
      ['balanced', 'Balanced', 'No penalties or bonuses.'],
      ['agile', 'Agile', 'Higher movement speed.'],
      ['guardian', 'Guardian', 'Start each run with a shield.'],
      ['salvage', 'Salvager', 'Earn more credits from cleared waves.']
    ]) buttonChoice(loadoutHost, key, label, detail, state.loadout, value => {
      state.loadout = value;
      saveState();
    });

    const mission = state.mission;
    const completed = mission.progress >= mission.goal;
    document.getElementById('feature-mission-title').textContent = mission.label;
    document.getElementById('feature-mission-fill').style.width = `${Math.min(100, mission.progress / mission.goal * 100)}%`;
    document.getElementById('feature-mission-progress').textContent = `${Math.min(mission.progress, mission.goal)} / ${mission.goal}${mission.claimed ? ' · REWARD CLAIMED' : ''}`;
    const claim = document.getElementById('feature-mission-claim');
    claim.disabled = !completed || mission.claimed;
    claim.textContent = mission.claimed ? 'Reward claimed' : 'Claim 300 credits';

    const accessHost = document.getElementById('feature-accessibility');
    accessHost.replaceChildren();
    for (const [key, label, detail] of [
      ['standard', 'Standard', 'Original effects and interface.'],
      ['calm', 'Reduced flashes', 'Dampen screen shake and impact flashes.'],
      ['contrast', 'High contrast', 'Boost important HUD and control contrast.'],
      ['large', 'Large HUD', 'Enlarge status and menu text.']
    ]) buttonChoice(accessHost, key, label, detail, state.accessibility, value => {
      state.accessibility = value;
      saveState();
      applyAccessibility();
    });

    const replay = state.lastReplay;
    document.getElementById('feature-replay-summary').textContent = replay
      ? `${MODE_NAMES[replay.mode] || 'Run'} · wave ${replay.wave} · score ${Number(replay.score).toLocaleString()} · ${replay.samples.length} flight samples`
      : 'No recorded sortie yet. Finish a run to record its flight path.';
    document.getElementById('feature-replay-play').disabled = !replay || replay.samples.length < 2;
    if (document.querySelector('[data-feature-view="replay"]:not([hidden])')) drawReplay(false);
    renderRecords();
  }

  function applyAccessibility() {
    document.body.classList.toggle('access-calm', state.accessibility === 'calm');
    document.body.classList.toggle('access-contrast', state.accessibility === 'contrast');
    document.body.classList.toggle('access-large', state.accessibility === 'large');
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (core.savedData) core.savedData.schedule();
    } catch (_) {}
  }

  function updateMission(type, amount = 1) {
    if (state.mission.type !== type || state.mission.claimed) return;
    state.mission.progress = Math.min(state.mission.goal, state.mission.progress + amount);
    saveState();
    renderMission();
  }

  function renderMission() {
    if (!document.getElementById('feature-mission-title')) return;
    const mission = state.mission;
    const completed = mission.progress >= mission.goal;
    document.getElementById('feature-mission-title').textContent = mission.label;
    document.getElementById('feature-mission-fill').style.width = `${Math.min(100, mission.progress / mission.goal * 100)}%`;
    document.getElementById('feature-mission-progress').textContent = `${Math.min(mission.progress, mission.goal)} / ${mission.goal}${mission.claimed ? ' · REWARD CLAIMED' : ''}`;
    const claim = document.getElementById('feature-mission-claim');
    claim.disabled = !completed || mission.claimed;
    claim.textContent = mission.claimed ? 'Reward claimed' : 'Claim 300 credits';
  }

  function captureSample(dt) {
    if (Game.state !== 'play' || !Game.p) return;
    sampleClock += dt;
    if (sampleClock < .35) return;
    sampleClock = 0;
    const view = core.getView();
    const pilot2 = runMode === 'coop' && Game.pilot2 ? Game.pilot2 : null;
    const sample = [
      Math.round(clamp(Game.p.x / view.w, 0, 1) * 255),
      Math.round(clamp(Game.p.y / view.h, 0, 1) * 255),
      pilot2 ? Math.round(clamp(pilot2.x / view.w, 0, 1) * 255) : -1,
      pilot2 ? Math.round(clamp(pilot2.y / view.h, 0, 1) * 255) : -1
    ];
    runSamples.push(sample);
    if (runSamples.length > 80) runSamples.shift();
  }

  function saveReplay() {
    if (!runSamples.length && Game.p) {
      const view = core.getView();
      if (view.w && view.h) runSamples.push([Math.round(Game.p.x / view.w * 255), Math.round(Game.p.y / view.h * 255), -1, -1]);
    }
    state.lastReplay = {
      mode: runMode,
      score: Game.score || 0,
      wave: Game.wave || 1,
      date: utcDate(),
      samples: runSamples.slice(-80)
    };
    if (runMode === 'endless') state.endlessBest = Math.max(state.endlessBest, Game.wave || 1);
    saveState();
  }

  function drawReplay(animate) {
    const canvasElement = document.getElementById('feature-replay');
    if (!canvasElement) return;
    const context = canvasElement.getContext('2d');
    const samples = state.lastReplay?.samples || [];
    const width = canvasElement.width;
    const height = canvasElement.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#080c17';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(61,245,255,.14)';
    context.lineWidth = 1;
    for (let x = 20; x < width; x += 40) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    }
    for (let y = 20; y < height; y += 40) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
    if (samples.length < 2) return;
    const limit = animate ? replayFrame : samples.length;
    context.strokeStyle = '#3df5ff';
    context.lineWidth = 3;
    context.shadowColor = '#3df5ff';
    context.shadowBlur = 9;
    context.beginPath();
    samples.slice(0, limit).forEach((sample, index) => {
      const x = 20 + sample[0] / 255 * (width - 40);
      const y = 18 + sample[1] / 255 * (height - 36);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
    if (state.lastReplay.mode === 'coop') {
      context.strokeStyle = '#79ffad';
      context.beginPath();
      samples.slice(0, limit).forEach((sample, index) => {
        if (sample[2] < 0) return;
        const x = 20 + sample[2] / 255 * (width - 40);
        const y = 18 + sample[3] / 255 * (height - 36);
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();
    }
    const current = samples[Math.min(limit - 1, samples.length - 1)];
    if (current) {
      context.fillStyle = '#fff';
      context.beginPath();
      context.arc(20 + current[0] / 255 * (width - 40), 18 + current[1] / 255 * (height - 36), 5, 0, Math.PI * 2);
      context.fill();
    }
    context.shadowBlur = 0;
    if (animate && replayPlaying) {
      replayFrame++;
      if (replayFrame >= samples.length) replayPlaying = false;
      else requestAnimationFrame(() => drawReplay(true));
    }
  }

  function stepCoop(dt) {
    if (runMode !== 'coop' || Game.state !== 'play' || !Game.pilot2) return;
    const pilot = Game.pilot2;
    const keys = Input.keys;
    const dx = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    const dy = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
    const view = core.getView();
    const speed = state.loadout === 'agile' ? 330 : 255;
    pilot.x = clamp(pilot.x + dx * speed * dt, 12, view.w - 12);
    pilot.y = clamp(pilot.y + dy * speed * dt, 12, view.h - 12);
    pilot.cooldown -= dt;
    if (pilot.cooldown <= 0) {
      const target = Game.enemies.find(enemy => !enemy.dead && Game.onScreen(enemy));
      if (target) {
        const angle = Math.atan2(target.y - pilot.y, target.x - pilot.x);
        Game.bullets.push({x:pilot.x,y:pilot.y,vx:Math.cos(angle)*610,vy:Math.sin(angle)*610,life:1.2,coPilot:true});
        pilot.cooldown = state.weapon === 'rapid' ? .12 : .22;
      }
    }
    for (const gem of Game.gems) {
      if (!gem.dead && Math.hypot(gem.x - pilot.x, gem.y - pilot.y) < 18) {
        gem.dead = true;
        Game.gem(gem);
      }
    }
  }

  function positionCoopPilot() {
    if (!pilot2Element) return;
    const active = runMode === 'coop' && Game.state === 'play' && Game.pilot2;
    pilot2Element.style.display = active ? 'block' : 'none';
    if (active) {
      const rect = canvas.getBoundingClientRect();
      const view = core.getView();
      pilot2Element.style.left = `${rect.left + Game.pilot2.x / view.w * rect.width}px`;
      pilot2Element.style.top = `${rect.top + Game.pilot2.y / view.h * rect.height}px`;
    }
    requestAnimationFrame(positionCoopPilot);
  }

  function showDesktopUpdateDemo() {
    if (document.getElementById('desktop-update-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'desktop-update-overlay';
    const card = document.createElement('section');
    card.id = 'desktop-update-card';
    const heading = document.createElement('h2');
    heading.textContent = 'NEON SWARM · UPDATE CENTER';
    const message = document.createElement('p');
    message.textContent = 'Downloading new version… (simulated)';
    const disclosure = document.createElement('p');
    disclosure.textContent = 'DEMO ONLY — no files are downloaded or changed.';
    const track = document.createElement('div');
    track.id = 'desktop-update-track';
    const fill = document.createElement('div');
    fill.id = 'desktop-update-fill';
    track.append(fill);
    const footer = document.createElement('div');
    footer.id = 'desktop-update-footer';
    const status = document.createElement('span');
    status.textContent = 'Preparing demo…';
    const percent = document.createElement('strong');
    percent.textContent = '0%';
    footer.append(status, percent);
    const close = document.createElement('button');
    close.className = 'alt';
    close.type = 'button';
    close.textContent = 'Cancel demo';
    card.append(heading, message, disclosure, track, footer, close);
    overlay.append(card);
    document.body.append(overlay);
    let progress = 0, timer = null, finished = false;
    const finish = () => {
      finished = true;
      if (timer) clearInterval(timer);
      close.textContent = 'Close';
    };
    close.addEventListener('click', () => {
      if (!finished && timer) clearInterval(timer);
      overlay.remove();
    });
    timer = setInterval(() => {
      progress = Math.min(100, progress + 1);
      fill.style.width = progress + '%';
      percent.textContent = progress + '%';
      status.textContent = progress < 100 ? 'Downloading new version…' : 'Demo complete';
      if (progress >= 100) {
        finish();
        message.textContent = 'Update demo completed.';
        disclosure.textContent = 'No update package was downloaded. Restarting the desktop app…';
        close.textContent = 'Restarting…';
        close.disabled = true;
        setTimeout(async () => {
          try {
            if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.restart_demo) {
              throw new Error('Desktop restart bridge is unavailable.');
            }
            await window.pywebview.api.restart_demo();
          } catch (error) {
            disclosure.textContent = 'Demo finished, but automatic restart failed. Close and reopen Neon Swarm manually.';
            status.textContent = 'Restart unavailable';
            close.disabled = false;
            close.textContent = 'Close';
          }
        }, 900);
      }
    }, 350);
  }

  function installDesktopUpdater() {
    const attach = () => {
      if (!window.pywebview || !window.pywebview.api) return;
      const menu = document.getElementById('menu');
      const launch = document.getElementById('play');
      if (!menu || document.getElementById('desktop-update-button')) return;
      const button = document.createElement('button');
      button.id = 'desktop-update-button';
      button.className = 'alt';
      button.type = 'button';
      button.textContent = 'Check for updates';
      button.title = 'Open the simulated update demo; no files are downloaded.';
      button.addEventListener('click', showDesktopUpdateDemo);
      menu.insertBefore(button, launch || menu.firstChild);
      console.info('[desktop] Update demo button installed.');
    };
    window.addEventListener('pywebviewready', attach);
    attach();
  }

  function installHooks() {
    const autopilotButton = document.createElement('button');
    autopilotButton.type = 'button';
    autopilotButton.id = 'feature-autopilot-toggle';
    autopilotButton.className = 'alt';
    autopilotButton.style.cssText = 'position:fixed;z-index:30;right:14px;top:calc(env(safe-area-inset-top,0px) + 14px);display:none;padding:9px 12px;font-size:11px;pointer-events:auto;';
    autopilotButton.addEventListener('click', () => { state.autopilot = !state.autopilot; saveState(); updateAutopilotButton(); });
    document.body.append(autopilotButton);
    function updateAutopilotButton() {
      autopilotButton.textContent = state.autopilot ? '✦ AUTOPILOT ON' : '✦ AUTOPILOT OFF';
      autopilotButton.style.borderColor = state.autopilot ? '#6dffb0' : 'rgba(61,245,255,.45)';
      autopilotButton.style.display = Game.state === 'play' ? 'block' : 'none';
    }
    const originalSetForAutopilot = Game.set;
    Game.set = function(nextState) { originalSetForAutopilot.call(this, nextState); updateAutopilotButton(); };
    const originalVector = Input.vec;
    Input.vec = function() {
      if (!state.autopilot || Game.state !== 'play' || !Game.p) return originalVector.call(this);
      const p = Game.p, view = core.getView();
      let x = (view.w * .5 - p.x) * .0012, y = (view.h * .58 - p.y) * .0012;
      const repel = (tx, ty, radius, weight) => {
        const dx = p.x - tx, dy = p.y - ty, d2 = dx * dx + dy * dy;
        if (d2 < radius * radius) { const d = Math.sqrt(d2) || 1; const force = (1 - d / radius) * weight; x += dx / d * force; y += dy / d * force; }
      };
      for (const enemy of Game.enemies) if (!enemy.dead && Game.onScreen(enemy)) repel(enemy.x, enemy.y, enemy.k === 'boss' ? 190 : 100, enemy.k === 'boss' ? 2.4 : 1.7);
      for (const bullet of Game.eb) repel(bullet.x + bullet.vx * .28, bullet.y + bullet.vy * .28, 78, 2.8);
      let target = null, targetDistance = Infinity;
      for (const item of [...Game.gems, ...Game.pu]) {
        if (item.dead || item.t <= 0) continue;
        const d = Math.hypot(item.x - p.x, item.y - p.y);
        if ((item.k !== 'life' || p.hp < p.maxHp * .88) && d < targetDistance) { target = item; targetDistance = d; }
      }
      if (target && targetDistance < 230) { x += (target.x - p.x) / Math.max(1, targetDistance) * .85; y += (target.y - p.y) / Math.max(1, targetDistance) * .85; }
      const margin = 54;
      if (p.x < margin) x += (margin - p.x) / margin * 1.8;
      if (p.x > view.w - margin) x -= (p.x - (view.w - margin)) / margin * 1.8;
      if (p.y < margin) y += (margin - p.y) / margin * 1.8;
      if (p.y > view.h - margin) y -= (p.y - (view.h - margin)) / margin * 1.8;
      const length = Math.hypot(x, y);
      if (length > 1) { x /= length; y /= length; }
      if (Game.eb.some(b => Math.hypot(b.x - p.x, b.y - p.y) < 46) && p.dashCd <= 0) Input.dash = true;
      return { x, y };
    };
    const originalStart = Game.start;
    Game.start = function() {
      runMode = state.mode;
      runDate = utcDate();
      if (Math.random !== nativeRandom) Math.random = nativeRandom;
      if (runMode === 'daily') Math.random = seededRandom(runDate);
      this.mode = runMode;
      this.bossRushIndex = 0;
      runSamples = [];
      sampleClock = 0;
      runRecorded = false;
      originalStart.call(this);
      if (runMode === 'hardcore') {
        this.p.maxHp = 100000;
        this.p.hp = 100000;
        FX.text(core.getView().w / 2, core.getView().h * .3, 'HARDCORE · 100,000 HP', '#ff3d5f', 24);
      }
      if (runMode === 'survival') {
        this.wave = 10;
        this.enemies.length = 0;
        this.spawnWave();
        FX.text(core.getView().w / 2, core.getView().h * .3, 'VETERAN SURVIVAL · WAVE 10', '#ff3df5', 24);
      }
      this.modeClock = 0;
      this.extraVolleyClock = 0;
      this.hardcoreFinalVolleyClock = 0;
      if (runMode === 'coop') {
        const view = core.getView();
        this.pilot2 = { x: view.w * .25, y: view.h * .82, cooldown: .1 };
      } else this.pilot2 = null;
      if (state.loadout === 'guardian') this.p.shield = Math.max(this.p.shield, 6);
    };

    const originalGoMenu = Game.goMenu;
    Game.goMenu = function() {
      Math.random = nativeRandom;
      return originalGoMenu.call(this);
    };

    const originalTick = Game.tick;
    Game.tick = function(dt) {
      if (Game.state === 'play' && Game.p) captureSample(dt);
      stepCoop(dt);
      originalTick.call(this, dt);
    };

    const originalControl = Game.control;
    Game.control = function(dt) {
      if (state.weapon === 'rapid' && this.p) this.p.rapid = Math.max(this.p.rapid, .1);
      if (state.weapon === 'lance' && this.p) this.p.fireT += dt * .45;
      if (state.loadout === 'agile' && this.p) {
        this.p.vx *= 1.08;
        this.p.vy *= 1.08;
      }
      const previousLength = this.bullets.length;
      originalControl.call(this, dt);
      const bullets = this.bullets.slice(previousLength);
      if (state.weapon === 'scatter') {
        for (const bullet of bullets) {
          const angle = Math.atan2(bullet.vy, bullet.vx);
          const speed = Math.hypot(bullet.vx, bullet.vy);
          for (const offset of [-.12, .12]) {
            this.bullets.push({x:bullet.x,y:bullet.y,vx:Math.cos(angle+offset)*speed,vy:Math.sin(angle+offset)*speed,life:bullet.life,coPilot:bullet.coPilot});
          }
        }
      }
      if (state.weapon === 'lance') {
        for (const bullet of bullets) {
          bullet.vx *= 1.2;
          bullet.vy *= 1.2;
          bullet.life *= 1.15;
        }
      }
    };

    const originalAdd = Game.add;
    Game.add = function(kind, x, y, hp) {
      const type = TYPES[kind];
      let health = hp === undefined && type ? type.hp : hp;
      if (runMode === 'daily' && state.mode === 'daily' && dailyRule(runDate).health && kind !== 'boss') {
        health = Math.ceil(health * dailyRule(runDate).health);
      }
      if ((runMode === 'endless' || runMode === 'survival') && this.wave > MAX_WAVE && Number.isFinite(health)) {
        health = Math.ceil(health * (1 + (this.wave - MAX_WAVE) * .06));
      }
      if (runMode === 'hardcore' && this.wave <= 20) health = 25000;
      return originalAdd.call(this, kind, x, y, health);
    };

    const originalSpawnWave = Game.spawnWave;
    Game.spawnWave = function() {
      if (runMode === 'boss' && state.mode === 'boss') {
        this.wave = BOSS_WAVES[Math.min(this.bossRushIndex, BOSS_WAVES.length - 1)];
      }
      if ((runMode === 'endless' || runMode === 'survival') && this.wave > MAX_WAVE && this.wave % 5 === 0) {
        const view = core.getView();
        this.add('boss', view.w / 2, view.h * .2, 1000000);
        FX.text(view.w / 2, view.h * .34, `ENDLESS BOSS · WAVE ${this.wave}`, '#ff3df5', 26);
        return;
      }
      if (runMode === 'hardcore' && this.wave >= 1 && this.wave <= 20) {
        const view = core.getView();
        originalSpawnWave.call(this);
        let boss = this.enemies.find(enemy => !enemy.dead && enemy.k === 'boss');
        if (!boss) {
          this.add('boss', view.w / 2, view.h * .2, 25000);
          boss = this.enemies[this.enemies.length - 1];
        }
        if (boss) {
          boss.hp = 25000;
          boss.mhp = 25000;
          boss.r = Math.max(boss.r, 52);
        }
        if (this.p) {
          this.p.maxHp = 100000;
          this.p.hp = 100000;
        }
        FX.text(view.w / 2, view.h * .31, `HARDCORE BOSS · WAVE ${this.wave}`, '#ff3d5f', 24);
        return;
      }
      originalSpawnWave.call(this);
    };

    const originalClearWave = Game.clearWave;
    Game.clearWave = function() {
      originalClearWave.call(this);
      updateMission('waves');
      state.stats.waves++;
      checkAchievements();
      if (runMode === 'boss' && state.mode === 'boss') this.bossRushIndex++;
    };

    const originalVictory = Game.victory;
    Game.victory = function() {
      if ((runMode === 'endless' && state.mode === 'endless') || runMode === 'survival') {
        this.wave++;
        this.betweenWaves = false;
        this.spawnWave();
        FX.text(core.getView().w / 2, core.getView().h * .3, `WAVE ${this.wave}`, '#3df5ff', 30);
        return;
      }
      originalVictory.call(this);
    };

    const originalKill = Game.kill;
    Game.kill = function(enemy) {
      updateMission('kills');
      state.stats.kills++;
      if (enemy && enemy.k === 'boss') state.stats.bosses++;
      checkAchievements();
      originalKill.call(this, enemy);
    };

    const originalGem = Game.gem;
    Game.gem = function(gem) {
      updateMission('gems');
      state.stats.gems++;
      checkAchievements();
      originalGem.call(this, gem);
    };

    const originalHurt = Game.hurt;
    Game.hurt = function(amount) {
      if (state.accessibility === 'calm') FX.flash = 0;
      if (runMode === 'daily' && state.mode === 'daily') amount = (amount || 5) * dailyRule(runDate).damage;
      originalHurt.call(this, amount);
      if (state.accessibility === 'calm') FX.flash = 0;
    };

    const originalAward = Game.awardScore;
    Game.awardScore = function(points) {
      if (runMode === 'daily' && state.mode === 'daily') points *= dailyRule(runDate).score;
      return originalAward.call(this, points);
    };

    const originalDamage = Game.damage;
    Game.damage = function(enemy, amount) {
      if (runMode === 'hardcore') amount += 10000;
      if (state.weapon === 'rapid') amount *= .8;
      if (state.weapon === 'lance') amount *= 1.35;
      originalDamage.call(this, enemy, amount);
    };

    const originalReward = Profile.reward;
    Profile.reward = function(wave) {
      originalReward.call(this, wave * (state.loadout === 'salvage' ? 1.5 : 1));
    };

    const originalOver = Game.over;
    Game.over = function() {
      if (!runRecorded) {
        runRecorded = true;
        const finalScore = Math.max(0, Number(this.score) || 0);
        const finalWave = Math.max(1, Number(this.wave) || 1);
        state.stats.runs++;
        state.stats.totalScore = Math.min(Number.MAX_SAFE_INTEGER, state.stats.totalScore + finalScore);
        state.stats.bestScore = Math.max(state.stats.bestScore, finalScore);
        state.stats.bestWave = Math.max(state.stats.bestWave, finalWave);
        checkAchievements();
        saveState();
      }
      saveReplay();
      if (runMode === 'endless') {
        state.endlessBest = Math.max(state.endlessBest, this.wave || 1);
        saveState();
      }
      if (runMode === 'daily') {
        const scores = Array.isArray(state.dailyScores[runDate]) ? state.dailyScores[runDate] : [];
        scores.push(Math.max(0, Number(this.score) || 0));
        state.dailyScores[runDate] = scores.sort((left, right) => right - left).slice(0, 5);
        const dates = Object.keys(state.dailyScores).sort().slice(-7);
        state.dailyScores = Object.fromEntries(dates.map(date => [date, state.dailyScores[date]]));
        saveState();
      }
      try {
        originalOver.call(this);
      } finally {
        Math.random = nativeRandom;
        renderAll();
      }
    };

    const originalUpdate = Game.update;
    Game.update = function(dt) {
      originalUpdate.call(this, dt);
      if (Game.state === 'play' && runMode === 'timeattack') {
        this.modeClock = (this.modeClock || 0) + dt;
        const remaining = Math.max(0, 90 - this.modeClock);
        if (!this.timeAttackHudAt || this.time - this.timeAttackHudAt > .5) {
          this.timeAttackHudAt = this.time;
          FX.text(core.getView().w / 2, 42, 'TIME ATTACK · ' + remaining.toFixed(1) + 's', '#ffc23d', 16);
        }
        if (remaining <= 0) { this.over(); return; }
      }
      if (Game.state === 'play' && runMode === 'hardcore' && this.wave >= MAX_WAVE) {
        this.hardcoreFinalVolleyClock = (this.hardcoreFinalVolleyClock || 0) + dt;
        if (this.hardcoreFinalVolleyClock >= 2.4) {
          this.hardcoreFinalVolleyClock = 0;
          const p = this.p, view = core.getView();
          const originX = view.w / 2, originY = view.h * .12;
          const aim = Math.atan2(p.y - originY, p.x - originX);
          for (let i = 0; i < 30; i++) {
            const angle = aim + (i - 14.5) * .035;
            this.eb.push({x:originX,y:originY,vx:Math.cos(angle)*285,vy:Math.sin(angle)*285,life:7,damage:100});
          }
          FX.text(view.w / 2, view.h * .22, 'FINAL WAVE · 30 INCOMING ORBS · 100 DAMAGE EACH', '#ff3d5f', 15);
        }
      }
      if (Game.state === 'play' && runMode === 'bullethell') {
        this.extraVolleyClock = (this.extraVolleyClock || 0) + dt;
        if (this.extraVolleyClock >= 1.8) {
          this.extraVolleyClock = 0;
          const view = core.getView(), originX = Math.random() * view.w;
          for (let n = -2; n <= 2; n++) {
            const angle = Math.PI / 2 + n * .19;
            this.eb.push({x:originX + n * 13,y:-8,vx:Math.cos(angle)*150,vy:Math.sin(angle)*230,life:5,damage:8});
          }
          FX.text(originX, 70, 'INCOMING!', '#ff3d9a', 12);
        }
      }
      if (state.accessibility === 'calm') {
        FX.flash = 0;
        FX.shake = Math.min(FX.shake, 3);
      }
      if (Game.state !== 'play') return;
      for (const enemy of this.enemies) {
        if (enemy.k !== 'boss' || enemy.dead) continue;
        const ratio = enemy.hp / enemy.mhp;
        const phase = ratio <= .3 ? 2 : ratio <= .65 ? 1 : 0;
        if (phase > (enemy.featurePhase || 0)) {
          enemy.featurePhase = phase;
          enemy.featureAttackClock = 0;
          FX.text(enemy.x, enemy.y - enemy.r - 22, phase === 2 ? 'FINAL PHASE' : 'PHASE TWO', '#ff3df5', 22);
          Sfx.play('up');
        }
        if (phase > 0) {
          enemy.featureAttackClock = (enemy.featureAttackClock || 0) + dt;
          const interval = phase === 2 ? .9 : 1.5;
          if (enemy.featureAttackClock >= interval) {
            enemy.featureAttackClock = 0;
            const count = phase === 2 ? 12 : 8;
            const speed = phase === 2 ? 245 : 205;
            for (let i = 0; i < count; i++) {
              const angle = i * Math.PI * 2 / count + this.time * .4;
              this.eb.push({x:enemy.x,y:enemy.y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life:5,damage:10});
            }
          }
        }
      }
    };
  }

  function normalizeStats(source) {
    const stats = {};
    for (const key of ['runs', 'kills', 'gems', 'waves', 'bosses', 'totalScore', 'bestScore', 'bestWave']) {
      const value = Number(source && source[key]);
      stats[key] = Number.isSafeInteger(value) && value > 0 ? value : 0;
    }
    return stats;
  }

  function checkAchievements() {
    const unlocked = [];
    for (const item of ACHIEVEMENTS) {
      const progress = Number(state.stats[item.stat]) || 0;
      if (progress >= item.goal && !state.achievements.includes(item.id)) {
        state.achievements.push(item.id);
        unlocked.push(item);
      }
    }
    if (!unlocked.length) return;
    if (Profile.data && typeof Profile.data === 'object') {
      const reward = unlocked.reduce((sum, item) => sum + item.reward, 0);
      Profile.data.credits = Math.max(0, Number(Profile.data.credits) || 0) + reward;
      if (typeof Profile.save === 'function') Profile.save();
      if (typeof Profile.render === 'function') Profile.render();
    }
    const view = core.getView();
    for (const item of unlocked) {
      FX.text(view.w / 2, 92, 'ACHIEVEMENT: ' + item.title + '  +' + item.reward + ' CR', '#ffd75a', 20);
    }
    saveState();
    renderRecords();
  }

  function renderRecords() {
    const statHost = document.getElementById('feature-stat-grid');
    const achievementHost = document.getElementById('feature-achievement-list');
    const summary = document.getElementById('feature-achievement-summary');
    if (!statHost || !achievementHost || !summary) return;
    statHost.replaceChildren();
    for (const [key, label] of STAT_LABELS) {
      const card = document.createElement('div');
      card.className = 'feature-stat';
      const name = document.createElement('span');
      name.textContent = label;
      const value = document.createElement('strong');
      value.textContent = Number(state.stats[key] || 0).toLocaleString();
      card.append(name, value);
      statHost.append(card);
    }
    achievementHost.replaceChildren();
    for (const item of ACHIEVEMENTS) {
      const progress = Math.min(item.goal, Number(state.stats[item.stat]) || 0);
      const unlocked = state.achievements.includes(item.id);
      const card = document.createElement('article');
      card.className = 'feature-achievement' + (unlocked ? ' unlocked' : '');
      const title = document.createElement('strong');
      title.textContent = (unlocked ? '★ ' : '◇ ') + item.title;
      const detail = document.createElement('small');
      detail.textContent = item.description;
      const status = document.createElement('span');
      status.textContent = unlocked ? 'UNLOCKED · +' + item.reward + ' CREDITS' : progress.toLocaleString() + ' / ' + item.goal.toLocaleString() + ' · ' + item.reward + ' credits';
      const meter = document.createElement('div');
      meter.className = 'feature-achievement-meter';
      const fill = document.createElement('i');
      fill.style.width = Math.min(100, progress / item.goal * 100) + '%';
      meter.append(fill);
      card.append(title, detail, status, meter);
      achievementHost.append(card);
    }
    summary.textContent = state.achievements.length + ' / ' + ACHIEVEMENTS.length + ' achievements unlocked · Lifetime pilot records';
  }

  function init() {
    const originalInit = Profile.init;
    Profile.init = function() {
      originalInit.call(this);
      renderAll();
    };
    const panel = createPanel();
    const originalSet = Game.set;
    Game.set = function(nextState) {
      originalSet.call(this, nextState);
      panel.classList.toggle('on', nextState === 'features');
      if (nextState !== 'features') replayPlaying = false;
    };
    addStyle();
    const menu = document.getElementById('menu');
    const startButton = document.getElementById('play');
    const openMenu = document.createElement('button');
    openMenu.type = 'button'; openMenu.className = 'alt'; openMenu.textContent = 'Modes & features';
    openMenu.onclick = () => openPanel('menu');
    menu.insertBefore(openMenu, startButton);
    const pause = document.getElementById('pause');
    const quit = document.getElementById('quit');
    const openPause = openMenu.cloneNode(true);
    openPause.onclick = () => openPanel('pause');
    pause.insertBefore(openPause, quit);

    document.querySelectorAll('[data-feature-tab]').forEach(button => {
      button.onclick = () => showTab(button.dataset.featureTab);
    });
    document.getElementById('feature-close').onclick = () => Game.set(state.returnTo);
    document.getElementById('feature-launch').onclick = () => Game.start();
    document.getElementById('feature-mission-claim').onclick = claimMission;
    document.getElementById('feature-replay-play').onclick = () => {
      if (!state.lastReplay) return;
      replayFrame = 1;
      replayPlaying = true;
      drawReplay(true);
    };
    installHooks();
    installDesktopUpdater();
    applyAccessibility();
    renderAll();
    requestAnimationFrame(positionCoopPilot);
    window.addEventListener('keydown', event => {
      if (Game.state === 'features' && event.code === 'Escape') Game.set(state.returnTo);
    });
  }

  function claimMission() {
    if (state.mission.claimed || state.mission.progress < state.mission.goal) return;
    state.mission.claimed = true;
    Profile.data.credits += 300;
    Profile.save();
    Profile.render();
    saveState();
    renderMission();
  }

  init();
})();