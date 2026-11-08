import { randomUUID } from 'node:crypto';
import { BALANCE, BUILDING_TYPES, GAME_DEFAULTS } from '../../config/balance.js';
import { RNG } from '../../shared/rng.js';
import { buildingCost, buildingMaxHp, defenseMultiplier, neutralCost, regionDistance, resolveBattle, totalIncome, troopCap, troopGrowth, upgradeHp } from '../../shared/formulas.js';
import { MESSAGE, safeString, validateCommand, MAX_CHAT } from '../../shared/protocol.js';
import { decideAI, difficultyProfile } from '../ai/aiController.js';
import { captureBuildings, createBuilding, launchDrone, launchMissile, recalculatePlayer, updateProjectile } from '../sim/systems.js';

const DT = 1 / BALANCE.tickRate;
const send = (ws, data) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(data)); };

export class GameRoom {
  constructor({ code, map, mode = 'solo', settings = {} }) {
    this.code = code;
    this.map = map;
    this.mode = mode;
    this.settings = { ...GAME_DEFAULTS, ...settings };
    this.rng = new RNG(this.settings.seed);
    this.players = new Map();
    this.clients = new Map();
    this.regions = [];
    this.waves = [];
    this.projectiles = [];
    this.commandQueue = [];
    this.events = [];
    this.dirtyRegions = new Set();
    this.phase = 'lobby';
    this.tickIndex = 0;
    this.gameTime = 0;
    this.countdown = 0;
    this.paused = false;
    this.hostId = null;
    this.nextEntityId = 1;
    this.createdAt = Date.now();
    this.lastHumanAt = Date.now();
    this.result = null;
    this.resetRegions();
  }

  resetRegions() {
    this.rng = new RNG(this.settings.seed);
    this.regions = this.map.regions.map(r => ({
      ...r, ownerId: null,
      troops: this.rng.int(BALANCE.map.neutralMin, BALANCE.map.neutralMax) + Math.floor(Math.sqrt(r.area)),
      buildings: []
    }));
    this.waves = []; this.projectiles = []; this.events = []; this.commandQueue = [];
    this.dirtyRegions = new Set(this.regions.map(r => r.id));
    this.gameTime = 0; this.tickIndex = 0; this.result = null; this.paused = false;
  }

  addHuman(name, ws = null) {
    if (this.players.size >= BALANCE.maxPlayers) return { error: 'ROOM_FULL' };
    const id = randomUUID(), sessionToken = randomUUID();
    const player = this.makePlayer(id, name, false, 3);
    player.sessionToken = sessionToken;
    player.connected = true;
    this.players.set(id, player);
    if (!this.hostId) this.hostId = id;
    if (ws) this.clients.set(id, ws);
    this.lastHumanAt = Date.now();
    this.broadcastLobby();
    return { player, sessionToken };
  }

  makePlayer(id, name, isBot, difficulty) {
    const index = this.players.size;
    return {
      id, name: safeString(name || (isBot ? `AI ${index}` : 'Commander'), 18) || `Player ${index + 1}`,
      color: BALANCE.colors[index % BALANCE.colors.length], pattern: index % 4,
      isBot, difficulty, connected: !isBot, disconnectedAt: 0,
      regions: new Set(), regionsCount: 0, totalTroops: 0, houseLevels: 0, portLevels: 0,
      fortLevels: 0, droneLevels: 0, missileLevels: 0, aaLevels: 0, buildingCount: 0,
      economy: BALANCE.start.economy * this.settings.economyMultiplier,
      capitalRegion: null, attackPercent: 50, autoExpand: false, nextAiAt: 0,
      lastAttackTick: -100, commandWindowAt: 0, commandCount: 0, lastChatAt: 0,
      processedCommands: new Set(), processedOrder: [], captured: 0, lost: 0
    };
  }

  addBot(difficulty = this.settings.difficulty) {
    if (this.players.size >= BALANCE.maxPlayers) return { error: 'ROOM_FULL' };
    const resolved = difficulty === 'mixed' ? this.rollMixedDifficulty() : Math.max(1, Math.min(5, Number(difficulty) || 3));
    const id = randomUUID();
    const player = this.makePlayer(id, `AI ${String(this.players.size).padStart(2, '0')}`, true, resolved);
    this.players.set(id, player);
    this.broadcastLobby();
    return { player };
  }

  rollMixedDifficulty() {
    const roll = this.rng.next();
    let cursor = 0;
    for (let i = 0; i < BALANCE.ai.mixedWeights.length; i++) {
      cursor += BALANCE.ai.mixedWeights[i];
      if (roll <= cursor) return i + 1;
    }
    return 3;
  }

  attach(playerId, ws) {
    const player = this.players.get(playerId);
    if (!player) return false;
    player.connected = true; player.disconnectedAt = 0; player.isBot = false;
    this.clients.set(playerId, ws);
    this.lastHumanAt = Date.now();
    if (this.phase !== 'lobby') send(ws, { t: MESSAGE.FULL, snapshot: this.snapshot(true), clientId: playerId, code: this.code });
    this.broadcastLobby();
    return true;
  }

  detach(playerId) {
    const player = this.players.get(playerId);
    this.clients.delete(playerId);
    if (!player || player.isBot) return;
    player.connected = false; player.disconnectedAt = Date.now();
    if (this.mode === 'solo' && this.phase === 'playing') this.paused = true;
    if (this.phase === 'lobby' && this.hostId === playerId) this.hostId = [...this.players.values()].find(p => !p.isBot && p.connected)?.id || this.hostId;
    this.broadcastLobby();
  }

  leavePlayer(player) {
    this.clients.delete(player.id);
    if (this.phase === 'lobby') {
      this.players.delete(player.id);
      if (this.hostId === player.id) this.hostId = [...this.players.values()].find(p => !p.isBot)?.id || null;
    } else {
      player.isBot = true; player.difficulty = 3; player.connected = false; player.disconnectedAt = 0;
      player.nextAiAt = this.gameTime; this.paused = false;
    }
    this.broadcastLobby();
  }

  start() {
    if (this.phase !== 'lobby') return;
    if (![...this.players.values()].some(p => !p.isBot)) return;
    this.resetRegions();
    this.assignCapitals();
    this.phase = 'countdown'; this.countdown = BALANCE.countdownSeconds;
    this.broadcast({ t: MESSAGE.START, code: this.code, mapSize: this.settings.mapSize, countdown: this.countdown });
    this.broadcast({ t: MESSAGE.FULL, snapshot: this.snapshot(true) });
    this.broadcastLobby();
  }

  restart() {
    for (const p of this.players.values()) {
      p.regions.clear(); p.economy = BALANCE.start.economy * this.settings.economyMultiplier;
      p.captured = 0; p.lost = 0; p.nextAiAt = 0; p.capitalRegion = null;
    }
    this.start();
  }

  assignCapitals() {
    const candidates = this.regions.filter(r => r.area >= 7 && r.neighbors.length >= 2);
    const chosen = [];
    for (const player of this.players.values()) {
      let best = null, bestScore = -Infinity;
      for (const region of candidates) {
        if (chosen.includes(region.id)) continue;
        const minDist = chosen.length ? Math.min(...chosen.map(id => regionDistance(region, this.regions[id]))) : 100;
        const score = minDist * 10 + Math.min(region.area, 30) + this.rng.next() * 3;
        if (score > bestScore) { bestScore = score; best = region; }
      }
      if (!best) best = this.regions.find(r => !chosen.includes(r.id));
      if (!best) continue;
      chosen.push(best.id);
      best.ownerId = player.id;
      best.troops = BALANCE.start.troopCap * BALANCE.start.troopFactor * this.settings.troopMultiplier;
      best.buildings = [];
      player.capitalRegion = best.id; player.regions.add(best.id);
      player.economy = BALANCE.start.economy * this.settings.economyMultiplier;
      player.nextAiAt = this.rng.next() * difficultyProfile(player.difficulty).reaction;
      this.dirtyRegions.add(best.id);
    }
    for (const p of this.players.values()) recalculatePlayer(this, p);
  }

  receive(playerId, message) {
    const player = this.players.get(playerId);
    if (!player) return;
    const validationError = validateCommand(message);
    if (validationError) return this.error(playerId, message.cmdId, validationError, 'The command could not be validated.');
    if (player.processedCommands.has(message.cmdId)) return send(this.clients.get(playerId), { t: MESSAGE.ACK, cmdId: message.cmdId });
    const now = Date.now();
    if (now - player.commandWindowAt >= 1000) { player.commandWindowAt = now; player.commandCount = 0; }
    if (++player.commandCount > BALANCE.commandRatePerSecond) return this.error(playerId, message.cmdId, 'RATE_LIMIT', 'Command rate limit reached.');
    player.processedCommands.add(message.cmdId); player.processedOrder.push(message.cmdId);
    if (player.processedOrder.length > 500) player.processedCommands.delete(player.processedOrder.shift());

    if (message.type === 'LEAVE') {
      this.leavePlayer(player);
      send(this.clients.get(playerId), { t: MESSAGE.ACK, cmdId: message.cmdId });
      return;
    }
    const lobbyCommands = ['ADD_BOT','REMOVE_BOT','KICK','UPDATE_SETTINGS','START_MATCH','REMATCH'];
    if (lobbyCommands.includes(message.type)) {
      const error = this.executeLobbyCommand(player, message);
      if (error) this.error(playerId, message.cmdId, error.code, error.message);
      else send(this.clients.get(playerId), { t: MESSAGE.ACK, cmdId: message.cmdId });
      return;
    }
    if (this.phase === 'lobby' || this.phase === 'ended') return this.error(playerId, message.cmdId, 'MATCH_NOT_ACTIVE', 'The match is not active.');
    this.commandQueue.push({ playerId, message });
    send(this.clients.get(playerId), { t: MESSAGE.ACK, cmdId: message.cmdId });
  }

  executeLobbyCommand(player, message) {
    const host = player.id === this.hostId;
    if (message.type === 'REMATCH') {
      if (!host) return { code: 'NOT_HOST', message: 'Only the host can start a rematch.' };
      this.phase = 'lobby'; this.start(); return null;
    }
    if (this.phase !== 'lobby') return { code: 'MATCH_ACTIVE', message: 'Settings are locked during a match.' };
    if (!host) return { code: 'NOT_HOST', message: 'Only the host can change the room.' };
    switch (message.type) {
      case 'ADD_BOT': return this.addBot(message.payload.difficulty || this.settings.difficulty).error ? { code: 'ROOM_FULL', message: 'The room is full.' } : null;
      case 'REMOVE_BOT': {
        const target = this.players.get(message.payload.playerId);
        if (target?.isBot) this.players.delete(target.id);
        this.broadcastLobby(); return null;
      }
      case 'KICK': {
        const target = this.players.get(message.payload.playerId);
        if (target && target.id !== this.hostId) { this.clients.get(target.id)?.close(4000, 'Kicked'); this.players.delete(target.id); }
        this.broadcastLobby(); return null;
      }
      case 'UPDATE_SETTINGS': {
        const allowed = ['botCount','difficulty','speed','troopMultiplier','economyMultiplier','peaceSeconds','seed','winPercent'];
        for (const key of allowed) if (key in message.payload) this.settings[key] = message.payload[key];
        this.broadcastLobby(); return null;
      }
      case 'START_MATCH': this.start(); return null;
      default: return null;
    }
  }

  tick() {
    this.tickIndex++;
    this.processQueue();
    this.updateDisconnected();
    if (this.phase === 'countdown') {
      this.countdown -= DT;
      if (this.countdown <= 0) {
        this.phase = 'playing'; this.gameTime = 0;
        this.emit('MATCH_BEGIN', { message: this.settings.peaceSeconds ? `Peace protocol: ${this.settings.peaceSeconds}s` : 'Borders are open' });
      }
      if (this.tickIndex % 10 === 0) this.broadcastDelta();
      return;
    }
    if (this.phase !== 'playing' || this.paused) {
      if (this.dirtyRegions.size || this.events.length) this.broadcastDelta();
      return;
    }
    const dt = DT * Number(this.settings.speed || 1);
    this.gameTime += dt;
    for (const player of this.players.values()) recalculatePlayer(this, player);
    this.updateEconomy(dt);
    this.updateBuildings();
    this.updateWaves(dt);
    this.updateProjectiles(dt);
    this.updateAI();
    for (const player of this.players.values()) recalculatePlayer(this, player);
    if (this.tickIndex % 20 === 0) this.checkVictory();
    if (this.tickIndex % 2 === 0) this.broadcastDelta();
  }

  processQueue() {
    const queue = this.commandQueue.splice(0);
    for (const { playerId, message } of queue) {
      const player = this.players.get(playerId);
      if (!player) continue;
      let error = null;
      if (message.type === 'CHAT') error = this.chat(player, message.payload.text);
      else if (message.type === 'PING') send(this.clients.get(playerId), { t: MESSAGE.PONG, cmdId: message.cmdId, at: message.payload.at });
      else if (message.type === 'PAUSE') {
        if (this.mode !== 'solo') error = { code: 'SOLO_ONLY', message: 'Pause is available in solo mode.' };
        else { this.paused = !!message.payload.value; this.broadcastLobby(); }
      } else if (message.type === 'SET_ATTACK_PERCENT') player.attackPercent = Math.max(0, Math.min(100, Number(message.payload.percent) || 0));
      else if (message.type === 'SET_AUTO_EXPAND') player.autoExpand = !!message.payload.value;
      else if (message.type === 'ATTACK') error = this.attack(player, message.payload);
      else if (message.type === 'BUILD' || message.type === 'UPGRADE') error = this.build(player, message.payload, message.type === 'UPGRADE');
      if (error) this.error(playerId, message.cmdId, error.code, error.message);
    }
  }

  attack(player, { fromRegions, toRegionId, percent }) {
    if (this.phase !== 'playing' || this.paused) return { code: 'MATCH_NOT_ACTIVE', message: 'The match is not active.' };
    if (this.gameTime < this.settings.peaceSeconds) return { code: 'PEACE_TIME', message: `Peace protocol: ${Math.ceil(this.settings.peaceSeconds - this.gameTime)}s remaining.` };
    if (percent <= 0) return { code: 'ZERO_PERCENT', message: 'Choose an attack force above 0%.' };
    if ((this.tickIndex - player.lastAttackTick) * (1000 / BALANCE.tickRate) < BALANCE.commandCooldownMs) return { code: 'COOLDOWN', message: 'Command cooldown — hold the front.' };
    const target = this.regions[toRegionId];
    if (!target) return { code: 'BAD_TARGET', message: 'Unknown target region.' };
    if (target.ownerId === player.id) return { code: 'OWN_TARGET', message: 'This region is already yours.' };
    const unique = [...new Set(fromRegions)];
    const sources = [];
    for (const id of unique) {
      const source = this.regions[id];
      if (!source || source.ownerId !== player.id) return { code: 'NOT_OWNER', message: 'All source regions must belong to you.' };
      if (this.hasActiveSource(id)) return { code: 'SOURCE_BUSY', message: 'A source region already has an active attack.' };
      if (!this.canReach(source, target)) return { code: 'NOT_ADJACENT', message: 'Select a neighboring region or use a port within range.' };
      sources.push(source);
    }
    const available = sources.reduce((sum, r) => sum + r.troops, 0);
    const force = Math.floor(available * percent / 100);
    if (force < 1) return { code: 'NO_TROOPS', message: 'Not enough troops for this attack.' };
    player.lastAttackTick = this.tickIndex;
    this.launchWave(player, sources, target, force, false);
    return null;
  }

  canReach(source, target) {
    if (source.neighbors.includes(target.id)) return true;
    return source.isCoastal && target.isCoastal && source.seaNeighbors.includes(target.id) && source.buildings.some(b => b.type === 'port');
  }

  launchWave(player, sources, target, force, cascade) {
    let naval = false, portLevel = 0;
    const source = sources[0];
    if (!source.neighbors.includes(target.id)) {
      naval = true;
      portLevel = source.buildings.filter(b => b.type === 'port').reduce((n, b) => n + b.level, 0);
    }
    let remaining = force;
    const initialTroops = sources.map(region => region.troops);
    const available = initialTroops.reduce((sum, troops) => sum + troops, 0);
    for (let index = 0; index < sources.length; index++) {
      const region = sources[index];
      const take = index === sources.length - 1 ? remaining : Math.min(initialTroops[index], Math.floor(force * initialTroops[index] / available));
      region.troops = Math.max(0, region.troops - take); remaining -= take;
      this.dirtyRegions.add(region.id);
    }
    const x = sources.reduce((sum, r) => sum + r.x, 0) / sources.length;
    const y = sources.reduce((sum, r) => sum + r.y, 0) / sources.length;
    const distance = Math.hypot(target.x - x, target.y - y);
    const fort = target.buildings.some(b => b.type === 'fort');
    const duration = (BALANCE.combat.waveBase + BALANCE.combat.wavePerTile * distance) * (fort ? BALANCE.combat.fortDuration : 1);
    this.waves.push({ id: this.nextEntityId++, ownerId: player.id, fromRegions: sources.map(r => r.id), targetRegionId: target.id, x, y, tx: target.x, ty: target.y, force, remaining: duration, duration, naval, portLevel, cascade });
    this.emit('ATTACK', { regionId: target.id, sourceRegionId: source.id, ownerId: player.id, targetOwnerId: target.ownerId, force, naval });
  }

  updateWaves(dt) {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wave = this.waves[i]; wave.remaining -= dt;
      if (wave.remaining > 0) continue;
      this.waves.splice(i, 1);
      const target = this.regions[wave.targetRegionId];
      const player = this.players.get(wave.ownerId);
      if (!player) continue;
      if (target.ownerId === wave.ownerId) {
        target.troops += wave.force; this.dirtyRegions.add(target.id); continue;
      }
      const previousOwnerId = target.ownerId;
      const result = resolveBattle(wave.force, target.troops, target, wave.naval, wave.portLevel);
      if (result.captured) {
        if (previousOwnerId && this.players.has(previousOwnerId)) {
          this.players.get(previousOwnerId).regions.delete(target.id); this.players.get(previousOwnerId).lost++;
        }
        target.ownerId = wave.ownerId; target.troops = result.attackerLeft;
        player.regions.add(target.id); player.captured++;
        captureBuildings(this, target, wave.ownerId, result.effectiveForce);
        this.emit('CAPTURE', { regionId: target.id, ownerId: wave.ownerId, previousOwnerId, troops: result.attackerLeft });
        if (player.autoExpand && result.attackerLeft > 4) {
          const next = target.neighbors.map(id => this.regions[id]).filter(r => r.ownerId !== player.id).sort((a,b) => a.troops - b.troops)[0];
          if (next) {
            const force = Math.floor(target.troops * BALANCE.combat.autoExpandForce);
            if (force > 0) this.launchWave(player, [target], next, force, true);
          }
        }
      } else {
        target.troops = result.defenderLeft;
        this.emit('DEFEND', { regionId: target.id, ownerId: wave.ownerId, defenderId: target.ownerId, troops: result.defenderLeft });
      }
      this.dirtyRegions.add(target.id);
    }
  }

  build(player, { regionId, buildingType }, upgradeOnly) {
    if (this.phase !== 'playing' || this.paused) return { code: 'MATCH_NOT_ACTIVE', message: 'The match is not active.' };
    const region = this.regions[regionId];
    if (!region || region.ownerId !== player.id) return { code: 'NOT_OWNER', message: 'Build inside your own territory.' };
    if (!BUILDING_TYPES.includes(buildingType)) return { code: 'BAD_BUILDING', message: 'Unknown building.' };
    if (this.isRegionBusy(regionId)) return { code: 'REGION_BUSY', message: 'Cannot build in an active combat zone.' };
    if (buildingType === 'port' && !region.isCoastal) return { code: 'NOT_COASTAL', message: 'Ports require a coastal region.' };
    const existing = region.buildings.find(b => b.type === buildingType);
    if (upgradeOnly && !existing) return { code: 'NOT_BUILT', message: 'Build level 1 first.' };
    if (existing && existing.level >= BALANCE.buildings.maxLevel) return { code: 'MAX_LEVEL', message: 'Maximum level 5 reached.' };
    if (!existing && region.buildings.length >= BALANCE.buildings.maxTypesPerRegion) return { code: 'REGION_FULL', message: 'All infrastructure slots are occupied.' };
    const cost = buildingCost(buildingType, player.buildingCount, existing?.level || 0);
    if (player.economy < cost) return { code: 'NO_FUNDS', message: `Need ${cost - Math.floor(player.economy)} more credits.` };
    player.economy -= cost;
    if (existing) {
      existing.level++;
      existing.hp = upgradeHp(buildingType, existing.level - 1, existing.hp);
      this.emit('UPGRADE', { regionId, buildingType, level: existing.level, ownerId: player.id });
    } else {
      const building = createBuilding(buildingType, this.nextEntityId++, this.tickIndex, this.rng);
      building.nextAt += this.gameTime;
      region.buildings.push(building);
      this.emit('BUILD', { regionId, buildingType, level: 1, ownerId: player.id });
    }
    this.dirtyRegions.add(regionId);
    recalculatePlayer(this, player);
    return null;
  }

  updateEconomy(dt) {
    for (const player of this.players.values()) {
      if (!player.regions.size) continue;
      const cap = troopCap(player.houseLevels);
      const growth = troopGrowth(player.regionsCount, player.houseLevels);
      if (player.totalTroops < cap) {
        const owned = [...player.regions];
        const region = this.regions[owned[(this.tickIndex + owned.length) % owned.length]];
        region.troops += Math.min(growth * dt, cap - player.totalTroops);
        this.dirtyRegions.add(region.id);
      }
      player.economy += totalIncome(player.regionsCount, player.houseLevels, player.portLevels) * dt;
    }
  }

  updateBuildings() {
    if (this.gameTime < this.settings.peaceSeconds) return;
    for (const region of this.regions) {
      if (region.ownerId == null || !region.buildings.length) continue;
      for (const building of region.buildings) {
        if (building.disabledUntilTick > this.tickIndex || building.nextAt > this.gameTime) continue;
        if (building.type === 'drone') launchDrone(this, region, building);
        else if (building.type === 'missile') launchMissile(this, region, building);
      }
    }
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (!updateProjectile(this, this.projectiles[i], dt)) this.projectiles.splice(i, 1);
  }

  updateAI() {
    for (const player of this.players.values()) {
      if (!player.isBot || !player.regions.size || player.nextAiAt > this.gameTime) continue;
      const profile = difficultyProfile(player.difficulty);
      player.nextAiAt = this.gameTime + profile.reaction;
      const decision = decideAI(this, player);
      if (!decision) continue;
      if (decision.type === 'ATTACK') this.attack(player, decision.payload);
      else this.build(player, decision.payload, decision.type === 'UPGRADE');
    }
  }

  updateDisconnected() {
    const now = Date.now();
    for (const player of this.players.values()) {
      if (player.isBot || player.connected || !player.disconnectedAt) continue;
      if (now - player.disconnectedAt >= BALANCE.reconnectSeconds * 1000) {
        player.isBot = true; player.difficulty = 3; player.nextAiAt = this.gameTime;
      }
    }
  }

  checkVictory() {
    if (this.gameTime < Math.max(5, this.settings.peaceSeconds)) return;
    const active = [...this.players.values()].filter(p => p.regions.size > 0).sort((a,b) => b.regions.size - a.regions.size);
    if (!active.length) return;
    const human = [...this.players.values()].find(p => !p.isBot);
    const soloDefeat = this.mode === 'solo' && human && !human.regions.size;
    if (active.length === 1 || active[0].regions.size / this.regions.length >= this.settings.winPercent || soloDefeat) {
      this.finish(active[0].id);
    }
  }

  finish(winnerId) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    const standings = [...this.players.values()].sort((a,b) => b.regions.size - a.regions.size).map((p, index) => ({ id: p.id, name: p.name, color: p.color, place: index + 1, regions: p.regions.size, captured: p.captured }));
    this.result = { winnerId, standings, duration: Math.floor(this.gameTime), tick: this.tickIndex };
    this.broadcast({ t: MESSAGE.RESULT, result: this.result });
  }

  chat(player, text) {
    const now = Date.now();
    if (now - player.lastChatAt < 700) return { code: 'CHAT_RATE', message: 'Slow down in chat.' };
    const clean = safeString(text, MAX_CHAT);
    if (!clean) return { code: 'EMPTY_CHAT', message: 'Message is empty.' };
    player.lastChatAt = now;
    this.broadcast({ t: MESSAGE.CHAT, playerId: player.id, name: player.name, color: player.color, text: clean, at: now });
    return null;
  }

  hasActiveSource(regionId) { return this.waves.some(w => w.fromRegions.includes(regionId)); }
  isRegionBusy(regionId) { return this.waves.some(w => w.targetRegionId === regionId || w.fromRegions.includes(regionId)); }
  emit(type, payload) { this.events.push({ type, ...payload, at: this.gameTime }); if (this.events.length > 200) this.events.shift(); }
  error(playerId, cmdId, code, message) { send(this.clients.get(playerId), { t: MESSAGE.ERR, cmdId, code, message }); }
  broadcast(data) { for (const ws of this.clients.values()) send(ws, data); }

  lobbyState() {
    return {
      code: this.code, mode: this.mode, phase: this.phase, hostId: this.hostId, settings: this.settings,
      paused: this.paused, countdown: Math.max(0, this.countdown), gameTime: this.gameTime,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, pattern: p.pattern, isBot: p.isBot, difficulty: p.difficulty, connected: p.connected, regions: p.regions.size }))
    };
  }
  broadcastLobby() { this.broadcast({ t: MESSAGE.LOBBY, room: this.lobbyState() }); }

  serializeRegion(r) {
    return {
      i: r.id, o: r.ownerId, t: Math.max(0, Math.floor(r.troops)),
      b: r.buildings.map(b => ({ i: b.id, t: b.type, l: b.level, h: Math.max(0, Math.round(b.hp)), m: buildingMaxHp(b.type, b.level) }))
    };
  }
  playerState(p) {
    const cap = troopCap(p.houseLevels);
    return {
      id: p.id, name: p.name, color: p.color, pattern: p.pattern, isBot: p.isBot, difficulty: p.difficulty,
      connected: p.connected, regions: p.regions.size, troops: Math.floor(p.totalTroops), cap,
      economy: Math.floor(p.economy), income: +totalIncome(p.regionsCount, p.houseLevels, p.portLevels).toFixed(2),
      growth: +troopGrowth(p.regionsCount, p.houseLevels).toFixed(2), attackPercent: p.attackPercent,
      autoExpand: p.autoExpand, capitalRegion: p.capitalRegion, buildings: p.buildingCount,
      houseLevels: p.houseLevels, portLevels: p.portLevels, captured: p.captured, lost: p.lost
    };
  }
  snapshot(full = false) {
    const regions = full ? this.regions.map(r => this.serializeRegion(r)) : [...this.dirtyRegions].map(id => this.serializeRegion(this.regions[id]));
    return {
      code: this.code, tick: this.tickIndex, gameTime: +this.gameTime.toFixed(2), phase: this.phase, paused: this.paused,
      countdown: Math.max(0, +this.countdown.toFixed(1)), peaceLeft: Math.max(0, +(this.settings.peaceSeconds - this.gameTime).toFixed(1)),
      settings: this.settings, full, regions,
      players: [...this.players.values()].map(p => this.playerState(p)),
      waves: this.waves.map(w => ({ id: w.id, ownerId: w.ownerId, from: w.fromRegions, to: w.targetRegionId, x: +w.x.toFixed(2), y: +w.y.toFixed(2), tx: w.tx, ty: w.ty, force: Math.floor(w.force), remaining: +Math.max(0,w.remaining).toFixed(2), duration: +w.duration.toFixed(2), naval: w.naval })),
      projectiles: this.projectiles.map(p => ({ id: p.id, kind: p.kind, ownerId: p.ownerId, x: +p.x.toFixed(2), y: +p.y.toFixed(2), tx: p.tx, ty: p.ty, remaining: +Math.max(0,p.remaining).toFixed(2) })),
      events: this.events.splice(0), winnerId: this.result?.winnerId || null
    };
  }
  broadcastDelta() {
    if (!this.clients.size) { this.dirtyRegions.clear(); this.events.length = 0; return; }
    const snapshot = this.snapshot(false);
    this.dirtyRegions.clear();
    this.broadcast({ t: MESSAGE.SNAP, snapshot });
  }
}
