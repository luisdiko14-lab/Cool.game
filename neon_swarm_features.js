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
  let combatWidgets = null;
  let reviveUsed = false;
  let killChain = 0;
  let killChainTimer = 0;
  let lastKillAt = -Infinity;
  let novaCooldown = 0;
  let nearMissRewardClock = 0;
  let combatHudClock = 0;
  let nearMissedBullets = new WeakSet();
  let hullRegenClock = 0;
  let shieldRegenClock = 0;
  let lastHurtAt = -Infinity;
  let comboShieldReadyAt = 0;
  let eliteWaveMarked = 0;
  let milestoneWaveMarked = 0;
  let bossEnraged = new WeakSet();
  let lowHullWarned = false;
  let threatHudClock = 0;
  let nearbyThreatCount = 0;
  let incomingBulletCount = 0;
  let bonusGemCount = 0;
  const featureClamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const clamp = featureClamp;
  let featurePackWidgets = null;
  const packCooldowns = { overdrive: 22, emp: 25, shield: 30, repair: 35, blink: 14 };
  let packTimers = { overdrive: 0, emp: 0, shield: 0, repair: 0, blink: 0 };
  let waveStartedAt = 0;
  let waveDamageTaken = false;
  let cleanWaveStreak = 0;
  let runKills = 0;
  let runGems = 0;
  let gemStreak = 0;
  let gemStreakTimer = 0;
  let survivalClock = 0;
  let lowHullRegenClock = 0;
  let abilityHudClock = 0;
  let lastBossAlertAt = -Infinity;
  let bossFinalPhase = new WeakSet();

  const ultimateFeatureInstallers = [];
  const ultimateState = {
    droneClock: 0, droneAngle: 0, sentry: null, sentryCooldown: 0,
    mines: [], mineCooldown: 0, gadgetDock: null, gadgetButtons: {},
    heat: 0, overheated: 0, overdriveWasActive: false,
    chainGuard: false, lifeStealClock: 0, piercingVolley: 0,
    bossTelegraph: new WeakSet(), bossPatternClock: new WeakMap(),
    eliteAffixClock: new WeakMap(), waveMutator: null,
    objective: null, treasureWave: 0, rescueClock: 0,
    cleanStreak: 0, perks: [], perkDraftOpen: false, perkQueue: 0,
    perkOverlay: null, mastery: { standard: 0, scatter: 0, rapid: 0, lance: 0 },
    previousBest: 0, bestChallengeClaimed: false, waveObjectiveClaimed: false
  };

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
      #feature-combat-hud{position:fixed;z-index:20;left:12px;top:calc(env(safe-area-inset-top,0px) + 12px);display:none;min-width:150px;padding:9px 12px;border:1px solid rgba(61,245,255,.34);border-radius:9px;background:rgba(7,10,28,.82);box-shadow:0 4px 22px rgba(0,0,0,.3);color:#e9f8ff;font:700 11px/1.55 ui-monospace,monospace;pointer-events:none;backdrop-filter:blur(8px)}
      #feature-boss-health{position:fixed;z-index:19;left:50%;top:calc(env(safe-area-inset-top,0px) + 12px);transform:translateX(-50%);display:none;width:min(390px,58vw);padding:8px 11px;border:1px solid rgba(255,61,154,.4);border-radius:9px;background:rgba(10,5,25,.88);pointer-events:none}
      #feature-boss-health-label{display:flex;justify-content:space-between;gap:12px;margin-bottom:5px;color:#fff;font:800 10px/1.2 ui-monospace,monospace}
      #feature-boss-health-track{height:8px;overflow:hidden;border-radius:8px;background:#34203e}
      #feature-boss-health-fill{height:100%;width:100%;background:linear-gradient(90deg,#ff3d9a,#ff6b55);box-shadow:0 0 12px #ff3d9a;transition:width .12s}
      #feature-nova-button{position:fixed;z-index:31;right:14px;bottom:calc(env(safe-area-inset-bottom,0px) + 76px);display:none;padding:11px 15px;border:1px solid rgba(255,194,61,.7);border-radius:10px;background:rgba(48,29,8,.92);color:#ffe4a0;font-weight:900;box-shadow:0 0 18px rgba(255,194,61,.18)}
      #feature-nova-button:disabled{opacity:.65}
      #feature-ability-dock{position:fixed;z-index:29;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 132px);display:none;width:min(210px,48vw);padding:7px;border:1px solid rgba(61,245,255,.3);border-radius:10px;background:rgba(7,10,28,.84);backdrop-filter:blur(8px);pointer-events:auto}
      #feature-ability-status{padding:2px 4px 6px;color:#b9d9f5;font:700 9px/1.4 ui-monospace,monospace;text-align:center}
      #feature-ability-buttons{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
      #feature-ability-buttons button{min-width:0;padding:7px 3px;border:1px solid rgba(61,245,255,.38);border-radius:6px;background:rgba(17,8,43,.94);color:#e9f8ff;font:800 9px/1.2 ui-monospace,monospace}
      #feature-ability-buttons button:disabled{opacity:.48}
      #feature-ability-buttons button span{display:block;margin-top:3px;color:#8ea7c9;font-size:8px}
      @media(max-width:720px){#feature-ability-dock{right:8px;bottom:calc(env(safe-area-inset-bottom,0px) + 126px);width:min(192px,54vw)}#feature-ability-buttons{gap:4px}}
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
      button.textContent = 'Check for updates (Demo)';
      button.title = 'Open the simulated update demo; no files are downloaded.';
      button.addEventListener('click', showDesktopUpdateDemo);
      menu.insertBefore(button, launch || menu.firstChild);
      console.info('[desktop] Update demo button installed.');
    };
    window.addEventListener('pywebviewready', attach);
    attach();
  }


  function createCombatWidgets() {
    const hud = document.createElement('div');
    hud.id = 'feature-combat-hud';
    const wave = document.createElement('div');
    const enemies = document.createElement('div');
    const hp = document.createElement('div');
    const score = document.createElement('div');
    const streak = document.createElement('div');
    const threat = document.createElement('div');
    const warning = document.createElement('div');
    hud.append(wave, enemies, hp, score, streak, threat, warning);
    document.body.append(hud);

    const boss = document.createElement('div');
    boss.id = 'feature-boss-health';
    const bossLabel = document.createElement('div');
    bossLabel.id = 'feature-boss-health-label';
    const bossName = document.createElement('span');
    bossName.textContent = 'BOSS';
    const bossValue = document.createElement('span');
    bossLabel.append(bossName, bossValue);
    const bossTrack = document.createElement('div');
    bossTrack.id = 'feature-boss-health-track';
    const bossFill = document.createElement('div');
    bossFill.id = 'feature-boss-health-fill';
    bossTrack.append(bossFill);
    boss.append(bossLabel, bossTrack);
    document.body.append(boss);

    const nova = document.createElement('button');
    nova.id = 'feature-nova-button';
    nova.type = 'button';
    nova.textContent = '✦ NOVA [E]';
    nova.title = 'Clear enemy bullets and damage every enemy. Standard cooldown: 25 seconds; unlocked Admin cooldown: 1 second.';
    nova.addEventListener('click', activateNova);
    document.body.append(nova);
    combatWidgets = { hud, wave, enemies, hp, score, streak, threat, warning, boss, bossValue, bossFill, nova };
  }

  function activateNova() {
    if (Game.state !== 'play' || !Game.p || novaCooldown > 0) return;
    const adminAccessed = typeof Admin !== 'undefined' && Admin.unlocked === true;
    Game.blast(12, '#ffc23d');
    novaCooldown = adminAccessed ? 1 : 25;
    FX.text(Game.p.x, Game.p.y - 38, adminAccessed ? 'ADMIN NOVA · 1s COOLDOWN' : 'NOVA BURST!', '#ffc23d', 22);
    refreshCombatWidgets();
  }

  function refreshCombatWidgets() {
    if (!combatWidgets) return;
    const active = Game.state === 'play' && !!Game.p && !Game.p.dead;
    combatWidgets.hud.style.display = active ? 'block' : 'none';
    combatWidgets.nova.style.display = active ? 'block' : 'none';
    if (!active) {
      combatWidgets.boss.style.display = 'none';
      return;
    }
    const p = Game.p;
    combatWidgets.wave.textContent = 'WAVE  ' + Game.wave + '  /  ' + MAX_WAVE;
    combatWidgets.enemies.textContent = 'HOSTILES  ' + Game.enemies.filter(enemy => !enemy.dead).length;
    combatWidgets.hp.textContent = 'HULL  ' + Math.ceil(p.hp).toLocaleString() + ' / ' + Math.ceil(p.maxHp).toLocaleString();
    combatWidgets.score.textContent = 'SCORE  ' + Math.floor(Game.score || 0).toLocaleString() + '  ·  x' + (Game.mult || 1);
    combatWidgets.streak.textContent = 'STREAK  ' + killChain + '  ·  NOVA  ' + (novaCooldown > 0 ? novaCooldown.toFixed(1) + 's' : 'READY');
    combatWidgets.threat.textContent = 'THREAT  ' + nearbyThreatCount + ' NEAR  ·  ' + incomingBulletCount + ' TOTAL';
    combatWidgets.warning.textContent = incomingBulletCount >= 15 ? '⚠ PROJECTILE STORM' : (p.hp <= p.maxHp * .25 ? '⚠ CRITICAL HULL' : '');
    combatWidgets.warning.style.color = incomingBulletCount >= 15 || p.hp <= p.maxHp * .25 ? '#ff718c' : '#e9f8ff';
    const boss = Game.enemies.find(enemy => !enemy.dead && enemy.k === 'boss');
    combatWidgets.boss.style.display = boss ? 'block' : 'none';
    if (boss) {
      const max = Math.max(1, Number(boss.mhp) || Number(boss.hp) || 1);
      const hp = featureClamp((Number(boss.hp) || 0) / max * 100, 0, 100);
      combatWidgets.bossValue.textContent = Math.max(0, Math.ceil(boss.hp)).toLocaleString() + ' / ' + max.toLocaleString();
      combatWidgets.bossFill.style.width = hp + '%';
    }
    combatWidgets.nova.disabled = novaCooldown > 0;
    combatWidgets.nova.textContent = novaCooldown > 0 ? '✦ NOVA · ' + Math.ceil(novaCooldown) + 's' : '✦ NOVA [E]';
  }

  function dashPulse() {
    const p = Game.p;
    if (!p) return;
    let cleared = 0, hit = 0;
    for (const bullet of Game.eb) {
      if (bullet.life > 0 && Math.hypot(bullet.x - p.x, bullet.y - p.y) < 118) {
        bullet.life = 0;
        cleared++;
      }
    }
    for (const enemy of Game.enemies) {
      if (!enemy.dead && Math.hypot(enemy.x - p.x, enemy.y - p.y) < 92) {
        Game.damage(enemy, 8);
        hit++;
      }
    }
    FX.ring(p.x, p.y, 230, '#3df5ff');
    if (cleared || hit) FX.text(p.x, p.y - 30, 'DASH PULSE · ' + cleared + ' SHOTS / ' + hit + ' HITS', '#3df5ff', 13);
  }


  function addFeatureCredits(amount, label) {
    if (!Profile.data || !Number.isFinite(Number(Profile.data.credits))) return;
    Profile.data.credits = Math.max(0, Number(Profile.data.credits) + amount);
    if (typeof Profile.save === 'function') Profile.save();
    if (typeof Profile.render === 'function') Profile.render();
    if (Game.p && label) FX.text(Game.p.x, Game.p.y - 52, label + '  +' + amount + ' CR', '#ffd75a', 14);
  }

  function createFeatureAbilityDock() {
    const dock = document.createElement('section');
    dock.id = 'feature-ability-dock';
    const status = document.createElement('div');
    status.id = 'feature-ability-status';
    status.textContent = 'TACTICAL SYSTEMS · Q / R / F / C / X';
    const buttons = document.createElement('div');
    buttons.id = 'feature-ability-buttons';
    const definitions = [
      ['overdrive', 'BOOST', 'Q', useOverdrive],
      ['emp', 'EMP', 'R', useEmp],
      ['shield', 'GUARD', 'F', useShieldBurst],
      ['repair', 'REPAIR', 'C', useRepairKit],
      ['blink', 'BLINK', 'X', useBlink]
    ];
    const refs = {};
    for (const [key, label, hotkey, action] of definitions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = label + '<span>' + hotkey + '</span>';
      button.title = label + ' ability · ' + hotkey;
      button.addEventListener('click', action);
      buttons.append(button);
      refs[key] = button;
    }
    dock.append(status, buttons);
    document.body.append(dock);
    featurePackWidgets = { dock, status, buttons: refs };
  }

  function updateFeatureAbilityDock() {
    if (!featurePackWidgets) return;
    const active = Game.state === 'play' && !!Game.p && !Game.p.dead;
    featurePackWidgets.dock.style.display = active ? 'block' : 'none';
    if (!active) return;
    for (const [key, button] of Object.entries(featurePackWidgets.buttons)) {
      const left = Math.max(0, packTimers[key] || 0);
      button.disabled = left > 0;
      const labels = { overdrive: 'BOOST', emp: 'EMP', shield: 'GUARD', repair: 'REPAIR', blink: 'BLINK' };
      const hotkeys = { overdrive: 'Q', emp: 'R', shield: 'F', repair: 'C', blink: 'X' };
      button.innerHTML = labels[key] + '<span>' + (left > 0 ? left.toFixed(1) + 's' : hotkeys[key] + ' READY') + '</span>';
    }
    const elapsed = Math.max(0, (Number(Game.time) || 0) - waveStartedAt);
    featurePackWidgets.status.textContent = 'WAVE ' + elapsed.toFixed(1) + 's · CLEAN ' + cleanWaveStreak + ' · GEMS ' + gemStreak;
  }

  function useOverdrive() {
    if (Game.state !== 'play' || !Game.p || packTimers.overdrive > 0) return;
    packTimers.overdrive = packCooldowns.overdrive;
    ultimateState.overdriveActive = 8;
    ultimateState.heat = 0;
    Game.p.rapid = Math.max(Game.p.rapid, 8);
    FX.ring(Game.p.x, Game.p.y, 150, '#ffc23d');
    FX.text(Game.p.x, Game.p.y - 42, 'WEAPON OVERDRIVE · 8s', '#ffc23d', 17);
    updateFeatureAbilityDock();
  }

  function useEmp() {
    if (Game.state !== 'play' || !Game.p || packTimers.emp > 0) return;
    packTimers.emp = packCooldowns.emp;
    let cleared = 0;
    for (const bullet of Game.eb) if (bullet.life > 0) { bullet.life = 0; cleared++; }
    let struck = 0;
    for (const enemy of [...Game.enemies]) {
      if (!enemy.dead) { Game.damage(enemy, 18); struck++; }
    }
    FX.ring(Game.p.x, Game.p.y, Math.max(core.getView().w, core.getView().h) * .72, '#b66bff');
    FX.text(Game.p.x, Game.p.y - 42, 'EMP · ' + cleared + ' PROJECTILES / ' + struck + ' HOSTILES', '#c99bff', 15);
    updateFeatureAbilityDock();
  }

  function useShieldBurst() {
    if (Game.state !== 'play' || !Game.p || packTimers.shield > 0) return;
    packTimers.shield = packCooldowns.shield;
    Game.p.shield = Math.max(Game.p.shield, 7);
    FX.ring(Game.p.x, Game.p.y, 125, '#3df5ff');
    FX.text(Game.p.x, Game.p.y - 42, 'GUARDIAN SHIELD · 7s', '#3df5ff', 17);
    updateFeatureAbilityDock();
  }

  function useRepairKit() {
    if (Game.state !== 'play' || !Game.p || packTimers.repair > 0 || Game.p.hp >= Game.p.maxHp) return;
    packTimers.repair = packCooldowns.repair;
    const restored = Math.min(Game.p.maxHp - Game.p.hp, Math.max(1, Math.ceil(Game.p.maxHp * .18)));
    Game.p.hp += restored;
    FX.burst(Game.p.x, Game.p.y, '#6dffb0', 18, 180, .5, 3);
    FX.text(Game.p.x, Game.p.y - 42, 'FIELD REPAIR  +' + restored, '#6dffb0', 17);
    updateFeatureAbilityDock();
  }

  function useBlink() {
    if (Game.state !== 'play' || !Game.p || packTimers.blink > 0) return;
    const p = Game.p, view = core.getView();
    let threat = null, distance = Infinity;
    for (const item of [...Game.enemies, ...Game.eb]) {
      if (!item || item.dead || item.life === 0) continue;
      const d = Math.hypot(item.x - p.x, item.y - p.y);
      if (d < distance) { distance = d; threat = item; }
    }
    let dx = threat ? p.x - threat.x : 0;
    let dy = threat ? p.y - threat.y : -1;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length; dy /= length;
    p.x = featureClamp(p.x + dx * 145, p.r, view.w - p.r);
    p.y = featureClamp(p.y + dy * 145, p.r, view.h - p.r);
    p.inv = Math.max(p.inv, 1.25);
    packTimers.blink = packCooldowns.blink;
    FX.ring(p.x, p.y, 105, '#b66bff');
    FX.text(p.x, p.y - 42, 'PHASE BLINK', '#c99bff', 17);
    updateFeatureAbilityDock();
  }

  function useTacticalScan() {
    if (Game.state !== 'play' || !Game.p) return;
    const p = Game.p;
    const threats = Game.enemies.filter(enemy => !enemy.dead)
      .map(enemy => ({ enemy, distance: Math.hypot(enemy.x - p.x, enemy.y - p.y) }))
      .sort((a, b) => a.distance - b.distance).slice(0, 3);
    FX.ring(p.x, p.y, Math.min(core.getView().w, core.getView().h) * .58, '#3df5ff');
    for (const item of threats) {
      FX.ring(item.enemy.x, item.enemy.y, 34, '#ff718c');
      FX.text(item.enemy.x, item.enemy.y - (item.enemy.r || 12) - 18, Math.round(item.distance) + 'm', '#3df5ff', 12);
    }
    FX.text(p.x, p.y + 42, 'TACTICAL SCAN · ' + threats.length + ' TARGETS', '#3df5ff', 13);
  }

  function installHooks() {
    createCombatWidgets();
    createFeatureAbilityDock();
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
    Game.set = function(nextState) { originalSetForAutopilot.call(this, nextState); updateAutopilotButton(); refreshCombatWidgets(); };
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
      reviveUsed = false;
      hullRegenClock = 0;
      shieldRegenClock = 0;
      lastHurtAt = -Infinity;
      comboShieldReadyAt = 0;
      eliteWaveMarked = 0;
      milestoneWaveMarked = 0;
      bossEnraged = new WeakSet();
      lowHullWarned = false;
      threatHudClock = 0;
      nearbyThreatCount = 0;
      incomingBulletCount = 0;
      bonusGemCount = 0;
      packTimers = { overdrive: 0, emp: 0, shield: 0, repair: 0, blink: 0 };
      waveStartedAt = Number(this.time) || 0;
      waveDamageTaken = false;
      cleanWaveStreak = 0;
      runKills = 0;
      runGems = 0;
      gemStreak = 0;
      gemStreakTimer = 0;
      survivalClock = 0;
      lowHullRegenClock = 0;
      lastBossAlertAt = -Infinity;
      bossFinalPhase = new WeakSet();
      killChain = 0;
      killChainTimer = 0;
      lastKillAt = -Infinity;
      novaCooldown = 0;
      nearMissRewardClock = 0;
      combatHudClock = 0;
      nearMissedBullets = new WeakSet();
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
      const dashBefore = this.p ? this.p.dashT : 0;
      const previousLength = this.bullets.length;
      originalControl.call(this, dt);
      if (this.p && dashBefore <= 0 && this.p.dashT > 0) dashPulse();
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
      if (runMode === 'hardcore') {
        const view = core.getView();
        originalSpawnWave.call(this);
        if (this.wave >= 1 && this.wave <= 20) {
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
          FX.text(view.w / 2, view.h * .31, `HARDCORE BOSS · WAVE ${this.wave}`, '#ff3d5f', 24);
        }
        if (this.p) {
          this.p.maxHp = 100000;
          this.p.hp = 100000;
        }
        return;
      }
      originalSpawnWave.call(this);
      if (runMode !== 'hardcore' && this.wave >= 4 && this.wave % 4 === 0 && eliteWaveMarked !== this.wave) {
        const candidate = this.enemies.find(enemy => !enemy.dead && enemy.k !== 'boss');
        if (candidate) {
          candidate.hp = Math.ceil(candidate.hp * 1.8);
          candidate.mhp = candidate.hp;
          candidate.r = Math.ceil(candidate.r * 1.18);
          candidate.featureElite = true;
          eliteWaveMarked = this.wave;
          FX.text(candidate.x, candidate.y - 24, 'ELITE TARGET', '#ff9a55', 17);
        }
      }
    };

    const originalClearWave = Game.clearWave;
    Game.clearWave = function() {
      originalClearWave.call(this);
      if (this.wave > 0 && this.wave % 5 === 0 && milestoneWaveMarked !== this.wave) {
        milestoneWaveMarked = this.wave;
        const milestone = this.awardScore(100);
        FX.text(core.getView().w / 2, core.getView().h * .42, 'MILESTONE WAVE  +' + milestone, '#ffc23d', 22);
      }
      if (this.p && this.p.hp > 0 && this.p.hp < this.p.maxHp) {
        const repair = Math.max(10, Math.ceil(this.p.maxHp * .08));
        const restored = Math.min(repair, this.p.maxHp - this.p.hp);
        this.p.hp += restored;
        FX.text(this.p.x, this.p.y - 28, 'WAVE REPAIR  +' + Math.ceil(restored) + ' HP', '#6dffb0', 16);
      }
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
      const now = Number(this.time) || 0;
      killChain = now - lastKillAt <= 3.2 ? killChain + 1 : 1;
      lastKillAt = now;
      killChainTimer = 3.2;
      checkAchievements();
      originalKill.call(this, enemy);
      if (enemy && enemy.featureElite) {
        const eliteBonus = this.awardScore(100);
        FX.text(enemy.x, enemy.y - 48, 'ELITE BONUS  +' + eliteBonus, '#ff9a55', 15);
      }
      if (enemy && enemy.k === 'boss') {
        const bossBonus = this.awardScore(200);
        FX.text(enemy.x, enemy.y - 56, 'BOSS BOUNTY  +' + bossBonus, '#ffc23d', 18);
      }
      if (this.p && this.combo >= 15 && this.time >= comboShieldReadyAt) {
        this.p.shield = Math.max(this.p.shield, 2.5);
        comboShieldReadyAt = this.time + 30;
        FX.ring(this.p.x, this.p.y, 125, '#3df5ff');
        FX.text(this.p.x, this.p.y - 40, 'COMBO SHIELD!', '#3df5ff', 18);
      }
      if (this.p && this.p.dashCd > 0 && state.stats.kills % 10 === 0) {
        this.p.dashCd = Math.max(0, this.p.dashCd - .35);
        FX.text(this.p.x, this.p.y + 30, 'DASH RECHARGED', '#3df5ff', 12);
      }
      if (killChain >= 5 && killChain % 5 === 0) {
        const bonus = 25 * Math.floor(killChain / 5);
        const earned = this.awardScore(bonus);
        FX.text(enemy.x, enemy.y - 30, killChain + ' KILL STREAK  +' + earned, '#ffc23d', 17);
      }
    };

    const originalGem = Game.gem;
    Game.gem = function(gem) {
      updateMission('gems');
      state.stats.gems++;
      checkAchievements();
      originalGem.call(this, gem);
      bonusGemCount++;
      if (bonusGemCount % 10 === 0) {
        const jackpot = this.awardScore(100);
        FX.text(gem.x, gem.y - 25, 'GEM JACKPOT  +' + jackpot, '#6dffb0', 16);
      }
    };

    const originalHurt = Game.hurt;
    Game.hurt = function(amount) {
      if (state.accessibility === 'calm') FX.flash = 0;
      if (runMode === 'daily' && state.mode === 'daily') amount = (amount || 5) * dailyRule(runDate).damage;
      const player = this.p;
      originalHurt.call(this, amount);
      lastHurtAt = Number(this.time) || 0;
      if (player && player.hp <= 0 && !reviveUsed) {
        reviveUsed = true;
        player.hp = Math.max(1, Math.ceil(player.maxHp * .35));
        player.dead = false;
        player.inv = 3;
        player.shield = Math.max(player.shield, 4);
        this.timeScale = 1;
        this.dieT = 0;
        this.eb.length = 0;
        killChain = 0;
        this.set('play');
        FX.ring(player.x, player.y, Math.max(core.getView().w, core.getView().h) * .65, '#6dffb0');
        FX.text(player.x, player.y - 42, 'EMERGENCY REVIVE · 35% HULL', '#6dffb0', 19);
      } else if (player && player.hp < player.maxHp) {
        killChain = 0;
      }
      if (state.accessibility === 'calm') FX.flash = 0;
    };

    const originalLevelUp = Game.levelUp;
    Game.levelUp = function() {
      originalLevelUp.call(this);
      if (this.p && this.p.hp > 0) {
        const restored = Math.min(this.p.maxHp - this.p.hp, Math.ceil(this.p.maxHp * .05));
        if (restored > 0) {
          this.p.hp += restored;
          FX.text(this.p.x, this.p.y - 48, 'LEVEL-UP REPAIR  +' + restored, '#6dffb0', 15);
        }
      }
    };

    const originalAward = Game.awardScore;
    Game.awardScore = function(points) {
      if (runMode === 'daily' && state.mode === 'daily') points *= dailyRule(runDate).score;
      return originalAward.call(this, points);
    };

    const originalDamage = Game.damage;
    Game.damage = function(enemy, amount) {
      if (runMode === 'hardcore') amount += 10000;
      if (Math.random() < .12) {
        amount *= 2.5;
        if (enemy && typeof enemy === 'object') enemy.featureCriticalSequence = (Number(enemy.featureCriticalSequence) || 0) + 1;
        if (enemy && Number.isFinite(enemy.x) && Number.isFinite(enemy.y)) FX.text(enemy.x, enemy.y - (enemy.r || 12) - 12, 'CRITICAL!', '#ffe36e', 15);
      }
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
      if (Game.state === 'play' && this.p && !this.p.dead) {
        const p = this.p;
        for (const item of [...this.gems, ...this.pu]) {
          if (!item || item.dead || (Number.isFinite(item.t) && item.t <= 0)) continue;
          const dx = p.x - item.x, dy = p.y - item.y, distance = Math.hypot(dx, dy) || 1;
          if (distance > 135 && distance < 270) {
            const strength = featureClamp((270 - distance) / 135, 0, 1);
            const speed = 210 + 150 * strength;
            item.x += dx / distance * speed * dt;
            item.y += dy / distance * speed * dt;
          }
        }
      }
      originalUpdate.call(this, dt);
      if (Game.state === 'play' && this.p && !this.p.dead) {
        novaCooldown = Math.max(0, novaCooldown - dt);
        nearMissRewardClock = Math.max(0, nearMissRewardClock - dt);
        killChainTimer = Math.max(0, killChainTimer - dt);
        if (killChainTimer <= 0) killChain = 0;
        const activeBoss = this.enemies.find(enemy => !enemy.dead && enemy.k === 'boss');
        if (activeBoss && !bossEnraged.has(activeBoss) && activeBoss.hp <= activeBoss.mhp * .5) {
          bossEnraged.add(activeBoss);
          activeBoss.fireT = Math.min(activeBoss.fireT, .08);
          for (let shot = 0; shot < 12; shot++) {
            const angle = shot * Math.PI * 2 / 12;
            this.eb.push({ x: activeBoss.x, y: activeBoss.y, vx: Math.cos(angle) * 245, vy: Math.sin(angle) * 245, life: 5, damage: 12 });
          }
          FX.ring(activeBoss.x, activeBoss.y, 250, '#ff3d9a');
          FX.text(activeBoss.x, activeBoss.y - 60, 'BOSS ENRAGED · PHASE 2', '#ff3d9a', 20);
        }
        hullRegenClock += dt;
        if (hullRegenClock >= 4.5) {
          hullRegenClock %= 4.5;
          if (this.p.hp > 0 && this.p.hp < this.p.maxHp) {
            const restored = Math.min(this.p.maxHp - this.p.hp, Math.max(1, Math.ceil(this.p.maxHp * .003)));
            this.p.hp += restored;
          }
        }
        if ((Number(this.time) || 0) - lastHurtAt >= 18 && this.p.shield <= 0) {
          shieldRegenClock += dt;
          if (shieldRegenClock >= 25) {
            shieldRegenClock = 0;
            this.p.shield = 2.5;
            FX.ring(this.p.x, this.p.y, 90, '#3df5ff');
            FX.text(this.p.x, this.p.y - 34, 'SHIELD RECHARGED', '#3df5ff', 14);
          }
        } else shieldRegenClock = 0;
        if (!lowHullWarned && this.p.hp > 0 && this.p.hp <= this.p.maxHp * .25) {
          lowHullWarned = true;
          FX.text(this.p.x, this.p.y - 56, 'WARNING · HULL CRITICAL', '#ff718c', 18);
        } else if (this.p.hp > this.p.maxHp * .35) lowHullWarned = false;
        threatHudClock -= dt;
        if (threatHudClock <= 0) {
          threatHudClock = .2;
          incomingBulletCount = this.eb.filter(bullet => bullet.life > 0).length;
          nearbyThreatCount = this.eb.filter(bullet => bullet.life > 0 && Math.hypot(bullet.x - this.p.x, bullet.y - this.p.y) < 140).length;
        }
        for (const bullet of this.eb) {
          if (bullet.life <= 0 || nearMissedBullets.has(bullet)) continue;
          const distance = Math.hypot(bullet.x - this.p.x, bullet.y - this.p.y);
          if (distance > 13 && distance < 38) {
            nearMissedBullets.add(bullet);
            if (nearMissRewardClock <= 0) {
              this.awardScore(2);
              nearMissRewardClock = .24;
              FX.text(this.p.x, this.p.y - 24, 'NEAR MISS  +100', '#6dffb0', 13);
            }
          }
        }
        combatHudClock -= dt;
        if (combatHudClock <= 0) {
          combatHudClock = .12;
          refreshCombatWidgets();
        }
      }
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

    // Additional tactical systems and run challenges.
    const originalSpawnWavePack = Game.spawnWave;
    Game.spawnWave = function() {
      originalSpawnWavePack.call(this);
      waveStartedAt = Number(this.time) || 0;
      waveDamageTaken = false;
      if (this.wave > 1 && this.wave % 4 === 0 && this.pu) {
        const view = core.getView();
        const supplies = ['shield', 'rapid', 'life', 'bomb'];
        const kind = supplies[(Math.floor(this.wave / 4) - 1) % supplies.length];
        this.pu.push({ x: view.w * .5, y: view.h * .28, k: kind, t: 22, a: 0 });
        FX.text(view.w * .5, view.h * .34, 'SUPPLY BEACON · WAVE ' + this.wave, '#6dffb0', 15);
      }
    };

    const originalClearWavePack = Game.clearWave;
    Game.clearWave = function() {
      const elapsed = Math.max(0, (Number(this.time) || 0) - waveStartedAt);
      if (!waveDamageTaken) {
        cleanWaveStreak++;
        const cleanBonus = this.awardScore(100 + cleanWaveStreak * 25);
        if (this.p) this.p.shield = Math.max(this.p.shield, 1.5);
        FX.text(core.getView().w / 2, core.getView().h * .25, 'FLAWLESS WAVE +' + cleanBonus, '#6dffb0', 19);
        if (cleanWaveStreak % 3 === 0) addFeatureCredits(40, 'CLEAN RUN STREAK');
      } else cleanWaveStreak = 0;
      if (elapsed > 0 && elapsed <= 22) {
        const speedBonus = this.awardScore(150);
        addFeatureCredits(15, 'SPEED CLEAR');
        FX.text(core.getView().w / 2, core.getView().h * .3, 'RAPID CLEAR +' + speedBonus, '#ffc23d', 16);
      }
      originalClearWavePack.call(this);
    };

    const originalKillPack = Game.kill;
    Game.kill = function(enemy) {
      originalKillPack.call(this, enemy);
      runKills++;
      if (runKills % 20 === 0) addFeatureCredits(30, 'ELIMINATION CONTRACT');
      if (runKills % 15 === 0 && this.p && this.p.hp > 0) {
        const restored = Math.min(this.p.maxHp - this.p.hp, Math.max(1, Math.ceil(this.p.maxHp * .03)));
        this.p.hp += restored;
        if (restored) FX.text(this.p.x, this.p.y - 28, 'FIELD SALVAGE +' + restored, '#6dffb0', 13);
      }
      if (killChain >= 10 && killChain % 10 === 0) {
        const bonus = this.awardScore(75 * Math.floor(killChain / 10));
        FX.text(enemy.x, enemy.y - 54, 'COMBO CASH +' + bonus, '#ffc23d', 14);
      }
      if (killChain >= 20 && killChain % 20 === 0 && this.p) {
        this.p.shield = Math.max(this.p.shield, 3);
        FX.ring(this.p.x, this.p.y, 105, '#3df5ff');
        FX.text(this.p.x, this.p.y - 56, 'KILL CHAIN GUARD', '#3df5ff', 14);
      }
      if (enemy && enemy.k === 'boss') {
        addFeatureCredits(150, 'BOSS CONTRACT');
        packTimers.overdrive = 0;
        packTimers.emp = 0;
        packTimers.shield = 0;
        packTimers.repair = 0;
        packTimers.blink = 0;
        if (this.p) this.p.shield = Math.max(this.p.shield, 5);
        FX.text(enemy.x, enemy.y - 78, 'BOSS CLEAR · SYSTEMS REFRESHED', '#ffd75a', 16);
      }
    };

    const originalGemPack = Game.gem;
    Game.gem = function(gem) {
      originalGemPack.call(this, gem);
      runGems++;
      gemStreakTimer = 2.6;
      gemStreak++;
      if (gemStreak % 5 === 0) {
        const bonus = this.awardScore(60);
        FX.text(gem.x, gem.y - 42, 'GEM CHAIN x' + gemStreak + '  +' + bonus, '#6dffb0', 14);
      }
      if (runGems % 12 === 0) addFeatureCredits(20, 'CRYSTAL CONTRACT');
    };

    const originalHurtPack = Game.hurt;
    Game.hurt = function(amount) {
      const player = this.p;
      const before = player ? player.hp : 0;
      originalHurtPack.call(this, amount);
      if (player && player.hp < before) {
        waveDamageTaken = true;
        gemStreak = 0;
      }
    };

    const originalDamagePack = Game.damage;
    Game.damage = function(enemy, amount) {
      if (packTimers.overdrive > 0) amount *= 1.65;
      originalDamagePack.call(this, enemy, amount);
    };

    const originalUpdatePack = Game.update;
    Game.update = function(dt) {
      const active = Game.state === 'play' && this.p && !this.p.dead;
      if (active) {
        for (const key of Object.keys(packTimers)) packTimers[key] = Math.max(0, packTimers[key] - dt);
        gemStreakTimer = Math.max(0, gemStreakTimer - dt);
        if (gemStreakTimer <= 0) gemStreak = 0;
        if (packTimers.overdrive > 0) this.p.rapid = Math.max(this.p.rapid, .12);
        if (this.p.hp <= this.p.maxHp * .25) {
          lowHullRegenClock += dt;
          if (lowHullRegenClock >= 4) {
            lowHullRegenClock = 0;
            this.p.hp = Math.min(this.p.maxHp, this.p.hp + Math.max(1, Math.ceil(this.p.maxHp * .006)));
          }
        } else lowHullRegenClock = 0;
        survivalClock += dt;
        if (survivalClock >= 30) {
          survivalClock %= 30;
          const bonus = this.awardScore(100);
          addFeatureCredits(10, 'SURVIVAL STIPEND');
          FX.text(this.p.x, this.p.y - 64, '30s SURVIVED +' + bonus, '#3df5ff', 14);
        }
      }
      originalUpdatePack.call(this, dt);
      if (Game.state === 'play' && this.p && !this.p.dead) {
        for (const boss of this.enemies) {
          if (!boss || boss.dead || boss.k !== 'boss') continue;
          const ratio = boss.hp / Math.max(1, boss.mhp || boss.hp || 1);
          if (ratio <= .2 && !bossFinalPhase.has(boss)) {
            bossFinalPhase.add(boss);
            boss.featureFinalClock = 0;
            for (let i = 0; i < 16; i++) {
              const angle = i * Math.PI * 2 / 16;
              this.eb.push({ x: boss.x, y: boss.y, vx: Math.cos(angle) * 275, vy: Math.sin(angle) * 275, life: 5, damage: 14 });
            }
            FX.ring(boss.x, boss.y, 290, '#ff718c');
            FX.text(boss.x, boss.y - 80, 'BOSS FINAL PHASE · 20%', '#ff718c', 20);
          }
          if (bossFinalPhase.has(boss)) {
            boss.featureFinalClock = (boss.featureFinalClock || 0) + dt;
            if (boss.featureFinalClock >= 1.25) {
              boss.featureFinalClock = 0;
              for (let i = 0; i < 16; i++) {
                const angle = i * Math.PI * 2 / 16 + this.time * .18;
                this.eb.push({ x: boss.x, y: boss.y, vx: Math.cos(angle) * 265, vy: Math.sin(angle) * 265, life: 5, damage: 14 });
              }
            }
          }
          if (Math.hypot(boss.x - this.p.x, boss.y - this.p.y) < 190 && this.time - lastBossAlertAt > 4) {
            lastBossAlertAt = this.time;
            FX.text(this.p.x, this.p.y - 76, 'DANGER · BOSS IN CLOSE RANGE', '#ff718c', 14);
          }
        }
        abilityHudClock -= dt;
        if (abilityHudClock <= 0) {
          abilityHudClock = .15;
          updateFeatureAbilityDock();
        }
      } else updateFeatureAbilityDock();
    };
    for (const installUltimateFeature of ultimateFeatureInstallers) {
      try { installUltimateFeature(); }
      catch (error) { console.error('Neon Swarm feature installation failed:', error); }
    }
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
      if (event.code === 'KeyP' && !event.repeat) {
        if (Game.state === 'play') Game.pause();
        else if (Game.state === 'pause') Game.resume();
      }
      if (Game.state === 'play' && event.code === 'KeyA' && !event.repeat) {
        state.autopilot = !state.autopilot;
        saveState();
        FX.text(Game.p.x, Game.p.y - 55, state.autopilot ? 'AUTOPILOT ENABLED' : 'AUTOPILOT DISABLED', '#3df5ff', 14);
        const button = document.getElementById('feature-autopilot-toggle');
        if (button) {
          button.textContent = state.autopilot ? '✦ AUTOPILOT ON' : '✦ AUTOPILOT OFF';
          button.style.borderColor = state.autopilot ? '#6dffb0' : 'rgba(61,245,255,.45)';
        }
      }
      if (Game.state === 'play' && event.code === 'KeyE' && !event.repeat) {
        event.preventDefault();
        activateNova();
      }
      if (Game.state === 'play' && !event.repeat) {
        const abilities = {
          KeyQ: useOverdrive, KeyR: useEmp, KeyF: useShieldBurst,
          KeyC: useRepairKit, KeyX: useBlink, KeyT: useTacticalScan
        };
        const ability = abilities[event.code];
        if (ability) { event.preventDefault(); ability(); }
      }
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


  ultimateFeatureInstallers.push(function installOrbitingDrone() {
    const originalUpdate = Game.update;
    Game.update = function(dt) {
      originalUpdate.call(this, dt);
      if (Game.state !== 'play' || !this.p || this.p.dead) return;
      ultimateState.droneAngle += dt * 2.35;
      ultimateState.droneClock -= dt;
      const p = this.p;
      const view = core.getView();
      const x = p.x + Math.cos(ultimateState.droneAngle) * 38;
      const y = p.y + Math.sin(ultimateState.droneAngle) * 38;
      if (Math.random() < .45) FX.burst(x, y, '#3df5ff', 1, 25, .22, 3);
      if (ultimateState.droneClock <= 0) {
        const target = this.enemies.filter(enemy => !enemy.dead && enemy.hp > 0)
          .sort((a, b) => Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
        if (target && Math.hypot(target.x-p.x,target.y-p.y) < Math.max(view.w,view.h)*.9) {
          ultimateState.droneClock = .72;
          this.damage(target, Math.max(8, 10 + this.lvl * 5));
          FX.ring(x, y, 34, '#3df5ff');
          FX.burst(target.x, target.y, '#3df5ff', 3, 85, .24, 2);
        } else ultimateState.droneClock = .2;
      }
    };
  });


  ultimateFeatureInstallers.push(function installSentryTurret() {
    function createDock() {
      if (ultimateState.gadgetDock) return;
      const dock = document.createElement('section');
      dock.id = 'feature-gadget-dock';
      dock.style.cssText = 'position:fixed;z-index:34;left:12px;top:calc(env(safe-area-inset-top,0px) + 112px);display:none;gap:6px;padding:7px;border:1px solid rgba(61,245,255,.35);border-radius:10px;background:rgba(7,10,28,.88);backdrop-filter:blur(8px);pointer-events:auto;';
      const button = document.createElement('button');
      button.type = 'button';
      button.style.cssText = 'padding:9px 10px;border:1px solid rgba(61,245,255,.55);border-radius:7px;background:#130d2c;color:#dffcff;font:800 10px ui-monospace,monospace;';
      button.textContent = 'SENTRY [G]';
      button.addEventListener('click', deploy);
      dock.append(button);
      document.body.append(dock);
      ultimateState.gadgetDock = dock;
      ultimateState.gadgetButtons.sentry = button;
    }
    function deploy() {
      if (Game.state !== 'play' || !Game.p || ultimateState.sentryCooldown > 0) return;
      const p = Game.p;
      ultimateState.sentry = { x: p.x, y: p.y, life: 11, fire: .25 };
      ultimateState.sentryCooldown = 19;
      FX.ring(p.x, p.y, 88, '#6dffb0');
      FX.text(p.x, p.y - 48, 'SENTRY DEPLOYED · 11s', '#6dffb0', 15);
    }
    createDock();
    const button = ultimateState.gadgetButtons.sentry;
    const originalUpdate = Game.update;
    Game.update = function(dt) {
      originalUpdate.call(this, dt);
      if (!ultimateState.gadgetDock) return;
      const active = Game.state === 'play' && !!this.p && !this.p.dead;
      ultimateState.gadgetDock.style.display = active ? 'flex' : 'none';
      if (!active) return;
      ultimateState.sentryCooldown = Math.max(0, ultimateState.sentryCooldown - dt);
      button.disabled = ultimateState.sentryCooldown > 0;
      button.textContent = ultimateState.sentryCooldown > 0 ? 'SENTRY '+Math.ceil(ultimateState.sentryCooldown)+'s' : 'SENTRY [G]';
      const sentry = ultimateState.sentry;
      if (!sentry) return;
      sentry.life -= dt;
      sentry.fire -= dt;
      if (sentry.life <= 0) {
        FX.ring(sentry.x, sentry.y, 105, '#6dffb0');
        ultimateState.sentry = null;
        return;
      }
      if (Math.random() < .22) FX.burst(sentry.x, sentry.y, '#6dffb0', 1, 16, .2, 2);
      if (sentry.fire <= 0) {
        const target = this.enemies.filter(enemy => !enemy.dead && enemy.hp > 0)
          .sort((a,b)=>Math.hypot(a.x-sentry.x,a.y-sentry.y)-Math.hypot(b.x-sentry.x,b.y-sentry.y))[0];
        if (target && Math.hypot(target.x-sentry.x,target.y-sentry.y) < 620) {
          sentry.fire = .46;
          this.damage(target, Math.max(12, 11 + this.lvl * 6));
          FX.burst(target.x, target.y, '#6dffb0', 2, 65, .2, 2);
        } else sentry.fire = .18;
      }
    };
    window.addEventListener('keydown', event => {
      if (Game.state === 'play' && event.code === 'KeyG' && !event.repeat) {
        event.preventDefault();
        deploy();
      }
    });
  });


  ultimateFeatureInstallers.push(function installProximityMines() {
    function deployMine() {
      if (Game.state !== 'play' || !Game.p || ultimateState.mineCooldown > 0) return;
      const p = Game.p;
      ultimateState.mines.push({ x: p.x - Math.cos(p.face || 0) * 24, y: p.y - Math.sin(p.face || 0) * 24, life: 18 });
      if (ultimateState.mines.length > 3) ultimateState.mines.shift();
      ultimateState.mineCooldown = 12;
      FX.ring(p.x, p.y, 55, '#ffc23d');
      FX.text(p.x, p.y - 38, 'PROXIMITY MINE SET', '#ffc23d', 14);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = 'padding:9px 10px;border:1px solid rgba(255,194,61,.6);border-radius:7px;background:#261a0a;color:#ffe6ae;font:800 10px ui-monospace,monospace;';
    button.textContent = 'MINE [H]';
    button.addEventListener('click', deployMine);
    ultimateState.gadgetDock?.append(button);
    ultimateState.gadgetButtons.mine = button;
    const originalUpdate = Game.update;
    Game.update = function(dt) {
      originalUpdate.call(this, dt);
      if (Game.state !== 'play' || !this.p || this.p.dead) return;
      ultimateState.mineCooldown = Math.max(0, ultimateState.mineCooldown - dt);
      button.disabled = ultimateState.mineCooldown > 0;
      button.textContent = ultimateState.mineCooldown > 0 ? 'MINE '+Math.ceil(ultimateState.mineCooldown)+'s' : 'MINE [H]';
      for (const mine of [...ultimateState.mines]) {
        mine.life -= dt;
        if (mine.life <= 0) {
          ultimateState.mines = ultimateState.mines.filter(item => item !== mine);
          continue;
        }
        if (Math.random() < .16) FX.burst(mine.x, mine.y, '#ffc23d', 1, 13, .18, 2);
        const target = this.enemies.find(enemy => !enemy.dead && Math.hypot(enemy.x-mine.x,enemy.y-mine.y) < 82);
        if (!target) continue;
        FX.ring(mine.x, mine.y, 170, '#ffc23d');
        FX.text(mine.x, mine.y - 24, 'MINE DETONATED', '#ffc23d', 13);
        for (const enemy of this.enemies) {
          if (!enemy.dead && Math.hypot(enemy.x-mine.x,enemy.y-mine.y) < 170) {
            this.damage(enemy, Math.max(25, 28 + this.lvl * 9));
          }
        }
        for (const projectile of this.eb) if (Math.hypot(projectile.x-mine.x,projectile.y-mine.y) < 190) projectile.life = 0;
        ultimateState.mines = ultimateState.mines.filter(item => item !== mine);
      }
    };
    window.addEventListener('keydown', event => {
      if (Game.state === 'play' && event.code === 'KeyH' && !event.repeat) {
        event.preventDefault();
        deployMine();
      }
    });
  });


  ultimateFeatureInstallers.push(function installCriticalChainLightning() {
    const originalDamage = Game.damage;
    Game.damage = function(enemy, amount) {
      const previous = enemy && Number(enemy.featureCriticalSequence || 0);
      originalDamage.call(this, enemy, amount);
      const current = enemy && Number(enemy.featureCriticalSequence || 0);
      if (!enemy || current <= previous || ultimateState.chainGuard) return;
      const target = this.enemies.filter(other => other !== enemy && !other.dead && other.hp > 0)
        .map(other => ({ other, distance: Math.hypot(other.x-enemy.x,other.y-enemy.y) }))
        .filter(item => item.distance < 230)
        .sort((a,b)=>a.distance-b.distance)[0];
      if (!target) return;
      ultimateState.chainGuard = true;
      try {
        FX.ring(enemy.x, enemy.y, 72, '#b58cff');
        FX.burst(target.other.x, target.other.y, '#b58cff', 5, 95, .28, 2.5);
        FX.text(target.other.x, target.other.y - 28, 'CHAIN LIGHTNING', '#b58cff', 12);
        this.damage(target.other, Math.max(5, (Number(amount) || 0) * .42));
      } finally { ultimateState.chainGuard = false; }
    };
  });


  ultimateFeatureInstallers.push(function installPiercingVolley() {
    const originalControl = Game.control;
    Game.control = function(dt) {
      const before = this.bullets.length;
      originalControl.call(this, dt);
      if (this.bullets.length <= before || !this.p) return;
      ultimateState.piercingVolley++;
      if (ultimateState.piercingVolley % 8 !== 0) return;
      const p = this.p, dx = Math.cos(p.aim), dy = Math.sin(p.aim);
      const linedUp = this.enemies.map(enemy => {
        const ex = enemy.x-p.x, ey = enemy.y-p.y;
        return { enemy, along: ex*dx+ey*dy, across: Math.abs(ex*dy-ey*dx) };
      }).filter(item => !item.enemy.dead && item.along > 25 && item.along < 900 && item.across < (item.enemy.r || 12) + 13)
        .sort((a,b)=>a.along-b.along).slice(0,3);
      if (!linedUp.length) return;
      FX.text(p.x + dx*45, p.y + dy*45, 'PIERCING VOLLEY', '#70e9ff', 13);
      for (const item of linedUp) {
        this.damage(item.enemy, Math.max(10, 14 + this.lvl * 8));
        FX.ring(item.enemy.x, item.enemy.y, 34, '#70e9ff');
      }
    };
  });


  ultimateFeatureInstallers.push(function installCombatLifesteal() {
    const originalKill = Game.kill;
    Game.kill = function(enemy) {
      originalKill.call(this, enemy);
      ultimateState.lifeStealClock = Math.max(0, ultimateState.lifeStealClock - 0);
      if (!this.p || this.p.dead || this.p.hp <= 0 || ultimateState.lifeStealClock > 0) return;
      const restored = Math.min(this.p.maxHp-this.p.hp, Math.max(1, Math.ceil(this.p.maxHp*.012)));
      if (restored > 0) {
        this.p.hp += restored;
        ultimateState.lifeStealClock = .9;
        FX.text(this.p.x, this.p.y-32, 'LIFESTEAL +'+restored, '#ff6eb4', 13);
      }
    };
    const originalUpdate = Game.update;
    Game.update = function(dt) {
      originalUpdate.call(this, dt);
      ultimateState.lifeStealClock = Math.max(0, ultimateState.lifeStealClock-dt);
    };
  });


  ultimateFeatureInstallers.push(function installShieldReflection() {
    let reflectCooldown = 0;
    const originalHurt = Game.hurt;
    Game.hurt = function(amount) {
      const player = this.p;
      const shielded = !!(player && player.shield > 0 && player.inv <= 0);
      const target = shielded ? this.enemies.filter(enemy=>!enemy.dead&&enemy.hp>0)
        .sort((a,b)=>Math.hypot(a.x-player.x,a.y-player.y)-Math.hypot(b.x-player.x,b.y-player.y))[0] : null;
      originalHurt.call(this, amount);
      if (shielded && target && reflectCooldown <= 0) {
        reflectCooldown = .3;
        const reflected = Math.max(1, (Number(amount)||10)*.65);
        this.damage(target, reflected);
        FX.burst(target.x,target.y,'#3df5ff',4,95,.25,2);
        FX.text(target.x,target.y-22,'REFLECT '+Math.ceil(reflected),'#3df5ff',12);
      }
    };
    const originalUpdate = Game.update;
    Game.update = function(dt) {
      originalUpdate.call(this,dt);
      reflectCooldown=Math.max(0,reflectCooldown-dt);
    };
  });


  ultimateFeatureInstallers.push(function installArmorBreak() {
    const originalDamage = Game.damage;
    Game.damage = function(enemy, amount) {
      if (enemy && !enemy.dead) {
        enemy.featureArmorStacks = Math.min(6, (Number(enemy.featureArmorStacks)||0)+1);
        const stacks = enemy.featureArmorStacks;
        if (stacks >= 2) amount *= 1 + (stacks-1)*.035;
        if (stacks === 4) FX.text(enemy.x,enemy.y-(enemy.r||12)-20,'ARMOR BREAK','#ffc23d',12);
      }
      originalDamage.call(this,enemy,amount);
    };
  });


  ultimateFeatureInstallers.push(function installExecutionBonus() {
    const originalDamage = Game.damage;
    Game.damage = function(enemy, amount) {
      if (enemy && !enemy.dead && Number(enemy.mhp)>0 && enemy.hp/enemy.mhp<=.22) {
        amount *= 1.32;
        if (!enemy.featureExecutionShown) {
          enemy.featureExecutionShown = true;
          FX.text(enemy.x,enemy.y-(enemy.r||12)-30,'EXECUTION WINDOW','#ff718c',12);
        }
      }
      originalDamage.call(this,enemy,amount);
    };
  });


  ultimateFeatureInstallers.push(function installOverdriveHeat() {
    const overdriveMarker = "    packTimers.overdrive = packCooldowns.overdrive;\n    Game.p.rapid";
    if (typeof ultimateState.overdriveActive !== 'number') ultimateState.overdriveActive = 0;
    if (typeof ultimateState.overheated !== 'number') ultimateState.overheated = 0;
    if (typeof useOverdrive === 'function' && !ultimateState.overdrivePatched) {
      const originalUseOverdrive = useOverdrive;
      useOverdrive = function() {
        originalUseOverdrive();
        if (Game.state === 'play' && Game.p && packTimers.overdrive > 0) {
          ultimateState.overdriveActive = 8;
          ultimateState.heat = 0;
        }
      };
      // Existing button references the original function, so patch its shared cooldown signal too.
      if (overdriveMarker && !ultimateState.overdriveHotkeyReady) ultimateState.overdriveHotkeyReady = true;
      ultimateState.overdrivePatched = true;
    }
    const originalUpdate = Game.update;
    Game.update = function(dt) {
      originalUpdate.call(this,dt);
      if (Game.state !== 'play' || !this.p || this.p.dead) return;
      if (ultimateState.overdriveActive > 0) {
        ultimateState.overdriveActive = Math.max(0,ultimateState.overdriveActive-dt);
        ultimateState.heat = Math.min(100,ultimateState.heat+dt*13);
        if (ultimateState.heat >= 100) {
          ultimateState.overdriveActive = 0;
          ultimateState.overheated = 3.5;
          this.p.rapid = 0;
          FX.ring(this.p.x,this.p.y,180,'#ff5d4d');
          FX.text(this.p.x,this.p.y-52,'OVERDRIVE OVERHEAT · COOLING 3.5s','#ff765f',13);
        }
      } else if (ultimateState.overheated > 0) {
        ultimateState.overheated = Math.max(0,ultimateState.overheated-dt);
      } else {
        ultimateState.heat = Math.max(0,ultimateState.heat-dt*24);
      }
    };
  });


  ultimateFeatureInstallers.push(function installBossStagger() {
    const originalDamage = Game.damage;
    Game.damage = function(enemy, amount) {
      if (enemy && enemy.k === 'boss' && !enemy.dead) {
        enemy.featureStaggerDamage = (Number(enemy.featureStaggerDamage)||0) + Math.max(0,Number(amount)||0);
        const threshold = Math.max(1200,(Number(enemy.mhp)||50000)*.075);
        if (enemy.featureStaggerDamage >= threshold && (Number(this.time)||0) >= (Number(enemy.featureStaggerReadyAt)||0)) {
          enemy.featureStaggerDamage = 0;
          enemy.featureStaggerReadyAt = (Number(this.time)||0) + 6.5;
          enemy.fireT = Math.max(Number(enemy.fireT)||0,1.25);
          FX.ring(enemy.x,enemy.y,145,'#ffdf75');
          FX.text(enemy.x,enemy.y-(enemy.r||40)-28,'BOSS STAGGERED · 1.25s','#ffdf75',15);
        }
      }
      originalDamage.call(this,enemy,amount);
    };
  });


  ultimateFeatureInstallers.push(function installBossTelegraphs() {
    const originalUpdate = Game.update;
    Game.update = function(dt) {
      originalUpdate.call(this,dt);
      if (Game.state!=='play') return;
      for (const boss of this.enemies) {
        if (boss.dead || boss.k!=='boss') continue;
        if (boss.t < .22) ultimateState.bossTelegraph.delete(boss);
        if (boss.t >= 1.95 && !ultimateState.bossTelegraph.has(boss)) {
          ultimateState.bossTelegraph.add(boss);
          FX.ring(boss.x,boss.y,210,'#ff718c');
          FX.text(boss.x,boss.y-(boss.r||44)-28,'INCOMING AIMED VOLLEY','#ff9aac',13);
          if (this.p) FX.text(this.p.x,this.p.y-70,'DODGE THE RED WARNING','#ff9aac',12);
        }
      }
    };
  });


  ultimateFeatureInstallers.push(function installRotatingBossPattern() {
    const originalUpdate = Game.update;
    Game.update = function(dt) {
      originalUpdate.call(this,dt);
      if (Game.state!=='play' || !this.p) return;
      for (const boss of this.enemies) {
        if (boss.dead || boss.k!=='boss') continue;
        boss.featurePatternClock=(Number(boss.featurePatternClock)||0)+dt;
        if (boss.featurePatternClock >= 6.2) {
          boss.featurePatternClock=0;
          boss.featurePatternAngle=(Number(boss.featurePatternAngle)||0)+.58;
          for(let i=0;i<12;i++){
            const angle=boss.featurePatternAngle+i*Math.PI*2/12;
            this.eb.push({x:boss.x,y:boss.y,vx:Math.cos(angle)*205,vy:Math.sin(angle)*205,life:6,damage:13});
          }
          FX.ring(boss.x,boss.y,230,'#ff3d9a');
          FX.text(boss.x,boss.y-(boss.r||44)-38,'ROTATING NOVA','#ff78b4',14);
        } else if (boss.featurePatternClock >= 5.2 && !boss.featurePatternWarned) {
          boss.featurePatternWarned=true;
          FX.ring(boss.x,boss.y,165,'#ff3d9a');
          FX.text(boss.x,boss.y-(boss.r||44)-24,'ROTATING NOVA CHARGING','#ff78b4',12);
        } else if (boss.featurePatternClock < 1) boss.featurePatternWarned=false;
      }
    };
  });


  ultimateFeatureInstallers.push(function installEliteAffixes() {
    const affixes=['BULWARK','VOLATILE','COMMANDER','MEDIC'];
    const originalSpawn = Game.spawnWave;
    Game.spawnWave = function() {
      originalSpawn.call(this);
      for(const elite of this.enemies.filter(enemy=>enemy.featureElite&&!enemy.featureAffix)){
        const index=(Math.max(1,this.wave)-1)%affixes.length;
        elite.featureAffix=affixes[index];
        elite.featureAffixClock=2.8;
        FX.text(elite.x,elite.y-(elite.r||18)-28,'ELITE · '+elite.featureAffix,'#ff9a55',13);
      }
    };
    const originalDamage=Game.damage;
    Game.damage=function(enemy,amount){
      if(enemy&&enemy.featureAffix==='BULWARK'&&!enemy.dead) amount*=.76;
      originalDamage.call(this,enemy,amount);
    };
    const originalKill=Game.kill;
    Game.kill=function(enemy){
      const volatile=enemy&&enemy.featureAffix==='VOLATILE';
      const x=enemy&&enemy.x,y=enemy&&enemy.y;
      originalKill.call(this,enemy);
      if(volatile&&Number.isFinite(x)&&Number.isFinite(y)){
        FX.ring(x,y,190,'#ff9a55');
        for(const other of this.enemies) if(!other.dead&&Math.hypot(other.x-x,other.y-y)<190) this.damage(other,Math.max(20,25+this.lvl*8));
        for(const bullet of this.eb) if(Math.hypot(bullet.x-x,bullet.y-y)<190) bullet.life=0;
        FX.text(x,y-24,'VOLATILE BURST','#ff9a55',13);
      }
    };
    const originalUpdate=Game.update;
    Game.update=function(dt){
      originalUpdate.call(this,dt);
      if(Game.state!=='play') return;
      for(const elite of this.enemies){
        if(elite.dead||!elite.featureAffix) continue;
        elite.featureAffixClock=(Number(elite.featureAffixClock)||0)-dt;
        if(elite.featureAffix==='MEDIC'&&elite.featureAffixClock<=0){
          elite.featureAffixClock=3.2;
          const ally=this.enemies.filter(enemy=>enemy!==elite&&!enemy.dead&&enemy.hp<enemy.mhp)
            .sort((a,b)=>a.hp/a.mhp-b.hp/b.mhp)[0];
          if(ally){ally.hp=Math.min(ally.mhp,ally.hp+ally.mhp*.07);FX.ring(ally.x,ally.y,45,'#6dffb0')}
        }
        if(elite.featureAffix==='COMMANDER'&&elite.featureAffixClock<=0){
          elite.featureAffixClock=3.4;
          const p=this.p,angle=Math.atan2(p.y-elite.y,p.x-elite.x);
          for(let i=-1;i<=1;i++){
            const a=angle+i*.14;
            this.eb.push({x:elite.x,y:elite.y,vx:Math.cos(a)*235,vy:Math.sin(a)*235,life:5,damage:13});
          }
          FX.text(elite.x,elite.y-22,'COMMAND BURST','#ff9a55',11);
        }
      }
    };
  });


  ultimateFeatureInstallers.push(function installWaveMutators() {
    const rules=[
      {name:'GLASS SWARM',score:1.35,health:.78,fire:1},
      {name:'OVERCHARGED',score:1.25,health:1,fire:.68},
      {name:'FORTIFIED',score:1.5,health:1.28,fire:1},
      {name:'SUPPLY RUSH',score:1.2,health:1,fire:1}
    ];
    const originalSpawn=Game.spawnWave;
    Game.spawnWave=function(){
      originalSpawn.call(this);
      if(this.wave%3!==0||ultimateState.lastMutatorWave===this.wave) return;
      ultimateState.lastMutatorWave=this.wave;
      const rule=rules[(Math.floor(this.wave/3)-1)%rules.length];
      ultimateState.waveMutator=rule;
      for(const enemy of this.enemies){
        if(enemy.dead) continue;
        if(rule.health!==1){enemy.hp=Math.max(1,Math.ceil(enemy.hp*rule.health));enemy.mhp=Math.max(enemy.hp,Math.ceil(enemy.mhp*rule.health))}
        if(rule.fire!==1) enemy.fireT=Math.max(.12,(Number(enemy.fireT)||1)*rule.fire);
      }
      if(rule.name==='SUPPLY RUSH'&&this.pu){
        const view=core.getView();
        ['life','shield','rapid'].forEach((kind,index)=>this.pu.push({x:view.w*(.3+index*.2),y:view.h*.3,k:kind,t:24,a:0}));
      }
      const view=core.getView();
      FX.ring(view.w/2,view.h*.36,240,'#b58cff');
      FX.text(view.w/2,view.h*.36,rule.name+' · WAVE '+this.wave,'#c9a9ff',19);
    };
    const originalAward=Game.awardScore;
    Game.awardScore=function(points){
      const mult=ultimateState.waveMutator&&this.wave%3===0?ultimateState.waveMutator.score:1;
      return originalAward.call(this,points*mult);
    };
  });


  ultimateFeatureInstallers.push(function installWaveObjectiveContracts() {
    const originalSpawn=Game.spawnWave;
    Game.spawnWave=function(){
      originalSpawn.call(this);
      const types=[
        {type:'kills',title:'ELIMINATION CONTRACT',goal:Math.min(4,Math.max(1,this.enemies.filter(e=>!e.dead).length))},
        {type:'gems',title:'CRYSTAL CONTRACT',goal:2},
        {type:'speed',title:'RAPID RESPONSE',goal:0},
        {type:'clean',title:'NO-DAMAGE PROTOCOL',goal:0}
      ];
      ultimateState.objective={...types[(Math.max(1,this.wave)-1)%types.length],progress:0,claimed:false,startTime:Number(this.time)||0};
      const view=core.getView();
      FX.text(view.w/2,view.h*.43,ultimateState.objective.title+' · BONUS REWARD','#a9d4ff',16);
    };
    const originalKill=Game.kill;
    Game.kill=function(enemy){
      originalKill.call(this,enemy);
      const objective=ultimateState.objective;
      if(objective&&objective.type==='kills'&&!objective.claimed) objective.progress++;
    };
    const originalGem=Game.gem;
    Game.gem=function(gem){
      originalGem.call(this,gem);
      const objective=ultimateState.objective;
      if(objective&&objective.type==='gems'&&!objective.claimed) objective.progress++;
    };
    const originalClear=Game.clearWave;
    Game.clearWave=function(){
      const objective=ultimateState.objective;
      if(objective&&!objective.claimed){
        const elapsed=(Number(this.time)||0)-objective.startTime;
        const complete=objective.type==='kills'?objective.progress>=objective.goal:
          objective.type==='gems'?objective.progress>=objective.goal:
          objective.type==='speed'?elapsed<=28:!waveDamageTaken;
        if(complete){
          objective.claimed=true;
          const earned=this.awardScore(220);
          addFeatureCredits(35,'WAVE CONTRACT');
          FX.text(core.getView().w/2,core.getView().h*.39,'CONTRACT COMPLETE +'+earned,'#a9d4ff',18);
        } else FX.text(core.getView().w/2,core.getView().h*.39,'CONTRACT MISSED','#ff9aac',14);
      }
      originalClear.call(this);
    };
  });


  ultimateFeatureInstallers.push(function installRescueDrops() {
    const originalStart=Game.start;
    Game.start=function(){
      ultimateState.rescueClock=0;
      originalStart.call(this);
    };
    const originalUpdate=Game.update;
    Game.update=function(dt){
      originalUpdate.call(this,dt);
      if(Game.state!=='play'||!this.p||this.p.dead) return;
      ultimateState.rescueClock+=dt;
      if(ultimateState.rescueClock<42) return;
      ultimateState.rescueClock=0;
      const p=this.p,view=core.getView();
      const x=Math.max(30,Math.min(view.w-30,p.x+(Math.random()-.5)*160));
      const y=Math.max(35,Math.min(view.h-35,p.y-90+(Math.random()-.5)*90));
      this.pu.push({x,y,k:'life',t:24,a:0,featureRescue:true});
      this.pu.push({x:Math.max(25,Math.min(view.w-25,x+42)),y,k:'shield',t:24,a:0,featureRescue:true});
      FX.ring(x,y,125,'#6dffb0');
      FX.text(x,y-28,'RESCUE PODS INCOMING','#6dffb0',14);
    };
  });


  ultimateFeatureInstallers.push(function installTreasureWaves() {
    const originalSpawn=Game.spawnWave;
    Game.spawnWave=function(){
      originalSpawn.call(this);
      if(this.wave%7!==0||ultimateState.treasureWave===this.wave) return;
      ultimateState.treasureWave=this.wave;
      const view=core.getView();
      for(let i=0;i<12;i++){
        const angle=i*Math.PI*2/12;
        this.gems.push({x:view.w*.5+Math.cos(angle)*115,y:view.h*.34+Math.sin(angle)*58,vx:Math.cos(angle)*45,vy:Math.sin(angle)*45,a:angle});
      }
      FX.ring(view.w*.5,view.h*.34,260,'#ffc23d');
      FX.text(view.w*.5,view.h*.34,'TREASURE WAVE · 12 CRYSTALS','#ffc23d',20);
    };
    const originalGem=Game.gem;
    Game.gem=function(gem){
      originalGem.call(this,gem);
      if(ultimateState.treasureWave===this.wave) addFeatureCredits(2,'TREASURE CRYSTAL');
    };
  });


  ultimateFeatureInstallers.push(function installEndlessEscalation() {
    if(typeof ultimateState.endlessClock!=='number') ultimateState.endlessClock=0;
    const originalUpdate=Game.update;
    Game.update=function(dt){
      originalUpdate.call(this,dt);
      if(Game.state!=='play'||!this.p||this.wave<=MAX_WAVE) return;
      ultimateState.endlessClock+=dt;
      const interval=Math.max(3.2,7.5-(this.wave-MAX_WAVE)*.14);
      if(ultimateState.endlessClock<interval) return;
      ultimateState.endlessClock=0;
      const view=core.getView(),origin=this.enemies.find(e=>!e.dead&&e.k==='boss')||this.enemies.find(e=>!e.dead);
      const x=origin?origin.x:view.w*.5,y=origin?origin.y:view.h*.25;
      const count=Math.min(18,9+Math.floor((this.wave-MAX_WAVE)/3));
      const rotation=(Number(this.time)||0)*.31;
      for(let i=0;i<count;i++){
        const angle=rotation+i*Math.PI*2/count;
        this.eb.push({x,y,vx:Math.cos(angle)*Math.min(330,210+(this.wave-MAX_WAVE)*2),vy:Math.sin(angle)*Math.min(330,210+(this.wave-MAX_WAVE)*2),life:6,damage:Math.min(35,12+Math.floor((this.wave-MAX_WAVE)/4))});
      }
      FX.ring(x,y,220,'#ff4fd8');
      FX.text(view.w*.5,view.h*.42,'ENDLESS FRACTURE · WAVE '+this.wave,'#ff79dd',16);
    };
  });


  ultimateFeatureInstallers.push(function installVictoryStreakRewards() {
    const originalStart=Game.start;
    Game.start=function(){
      ultimateState.cleanStreak=0;
      originalStart.call(this);
    };
    const originalClear=Game.clearWave;
    Game.clearWave=function(){
      const flawless=!waveDamageTaken;
      originalClear.call(this);
      if(flawless) ultimateState.cleanStreak++;
      else ultimateState.cleanStreak=0;
      if(ultimateState.cleanStreak>=5){
        ultimateState.cleanStreak=0;
        const reward=this.awardScore(500);
        addFeatureCredits(80,'FIVE-WAVE VICTORY STREAK');
        if(this.p&&this.p.hp>0) this.p.hp=Math.min(this.p.maxHp,this.p.hp+Math.ceil(this.p.maxHp*.06));
        FX.text(core.getView().w/2,core.getView().h*.36,'5-WAVE STREAK · +'+reward+' · REPAIR','#ffc23d',19);
      }
    };
  });

  init();
})();