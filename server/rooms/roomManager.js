import fs from 'node:fs';
import path from 'node:path';
import { BALANCE, GAME_DEFAULTS } from '../../config/balance.js';
import { GameRoom } from './gameRoom.js';
import { MESSAGE, safeString, validCode } from '../../shared/protocol.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const send = (ws, data) => { if (ws.readyState === 1) ws.send(JSON.stringify(data)); };
const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
function sanitizeSettings(input = {}) {
  const difficulty = ['1','2','3','4','5','mixed'].includes(String(input.difficulty)) ? String(input.difficulty) : GAME_DEFAULTS.difficulty;
  return {
    botCount: Math.round(clamp(input.botCount, 1, 15, GAME_DEFAULTS.botCount)), difficulty,
    speed: [0.5,1,2,4].includes(Number(input.speed)) ? Number(input.speed) : 1,
    troopMultiplier: clamp(input.troopMultiplier, .5, 3, 1), economyMultiplier: clamp(input.economyMultiplier, .5, 5, 1),
    peaceSeconds: clamp(input.peaceSeconds, 0, 120, 10), mapSize: input.mapSize === 'large' ? 'large' : 'standard',
    seed: Math.trunc(clamp(input.seed, 0, 999999999, GAME_DEFAULTS.seed)), winPercent: clamp(input.winPercent, .05, 1, GAME_DEFAULTS.winPercent)
  };
}

export class RoomManager {
  constructor({ maps, profilePath }) {
    this.maps = maps;
    this.rooms = new Map();
    this.profilePath = profilePath;
    this.profile = this.loadProfile();
  }

  loadProfile() {
    try { return JSON.parse(fs.readFileSync(this.profilePath, 'utf8')); }
    catch { return { games: 0, wins: 0, captures: 0, bestRegions: 0 }; }
  }
  saveProfile() {
    fs.mkdirSync(path.dirname(this.profilePath), { recursive: true });
    fs.writeFileSync(this.profilePath, JSON.stringify(this.profile, null, 2));
  }
  createCode() {
    let code;
    do { code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join(''); } while (this.rooms.has(code));
    return code;
  }
  createRoom(mode, settings) {
    if (this.rooms.size >= BALANCE.maxRooms) throw new Error('SERVER_FULL');
    const clean = sanitizeSettings(settings);
    const mapSize = clean.mapSize;
    const room = new GameRoom({ code: this.createCode(), map: this.maps[mapSize], mode, settings: clean });
    this.rooms.set(room.code, room);
    return room;
  }
  listRooms() {
    return [...this.rooms.values()].filter(r => r.mode === 'multiplayer' && r.phase === 'lobby').map(r => ({
      code: r.code, players: [...r.players.values()].filter(p => !p.isBot).length,
      bots: [...r.players.values()].filter(p => p.isBot).length, slots: BALANCE.maxPlayers,
      mapSize: r.settings.mapSize, difficulty: r.settings.difficulty, createdAt: r.createdAt
    }));
  }

  hello(ws, message) {
    if (ws.roomCode) return send(ws, { t: MESSAGE.ERR, code: 'ALREADY_JOINED', message: 'Already in a room.' });
    const action = message.action;
    let room, player, sessionToken;
    if (action === 'resume') {
      room = this.rooms.get(String(message.code || '').toUpperCase());
      player = room?.players.get(message.playerId);
      if (!room || !player || player.sessionToken !== message.sessionToken) return send(ws, { t: MESSAGE.ERR, code: 'RESUME_FAILED', message: 'Session expired. Rejoin from the lobby.' });
      ws.roomCode = room.code; ws.playerId = player.id;
      room.attach(player.id, ws);
      send(ws, { t: MESSAGE.WELCOME, clientId: player.id, sessionToken: player.sessionToken, code: room.code, mode: room.mode, resumed: true });
      if (room.phase === 'ended' && room.result) send(ws, { t: MESSAGE.RESULT, result: room.result });
      return;
    }
    try {
      if (action === 'createSolo' || action === 'createMultiplayer') {
        const mode = action === 'createSolo' ? 'solo' : 'multiplayer';
        room = this.createRoom(mode, message.settings || {});
        ({ player, sessionToken } = room.addHuman(safeString(message.name, 18) || 'Commander'));
        ws.roomCode = room.code; ws.playerId = player.id;
        room.attach(player.id, ws);
        send(ws, { t: MESSAGE.WELCOME, clientId: player.id, sessionToken, code: room.code, mode });
        if (mode === 'solo') {
          const count = Math.max(1, Math.min(15, Number(room.settings.botCount) || 7));
          for (let i = 0; i < count; i++) room.addBot(room.settings.difficulty);
          room.start();
        }
      } else if (action === 'join') {
        const code = String(message.code || '').toUpperCase();
        if (!validCode(code)) return send(ws, { t: MESSAGE.ERR, code: 'BAD_CODE', message: 'Enter a valid 6-character room code.' });
        room = this.rooms.get(code);
        if (!room) return send(ws, { t: MESSAGE.ERR, code: 'ROOM_NOT_FOUND', message: 'Room not found.' });
        if (room.phase !== 'lobby') return send(ws, { t: MESSAGE.ERR, code: 'MATCH_ACTIVE', message: 'This match has already started.' });
        ({ player, sessionToken } = room.addHuman(safeString(message.name, 18) || 'Commander'));
        if (!player) return send(ws, { t: MESSAGE.ERR, code: 'ROOM_FULL', message: 'This room is full.' });
        ws.roomCode = room.code; ws.playerId = player.id;
        room.attach(player.id, ws);
        send(ws, { t: MESSAGE.WELCOME, clientId: player.id, sessionToken, code: room.code, mode: room.mode });
      } else send(ws, { t: MESSAGE.ERR, code: 'BAD_HELLO', message: 'Unknown lobby action.' });
    } catch (error) {
      send(ws, { t: MESSAGE.ERR, code: error.message === 'SERVER_FULL' ? 'SERVER_FULL' : 'JOIN_FAILED', message: error.message === 'SERVER_FULL' ? 'Server room limit reached.' : 'Could not create or join the room.' });
    }
  }

  message(ws, message) {
    const room = this.rooms.get(ws.roomCode);
    if (!room || !ws.playerId) return send(ws, { t: MESSAGE.ERR, code: 'NOT_IN_ROOM', message: 'Join a room first.' });
    room.receive(ws.playerId, message);
  }
  disconnect(ws) {
    const room = this.rooms.get(ws.roomCode);
    if (room && ws.playerId) room.detach(ws.playerId);
  }
  tick() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      room.tick();
      if (room.result && !room.statsSaved) {
        room.statsSaved = true;
        this.profile.games++;
        const humans = [...room.players.values()].filter(p => !p.isBot || p.sessionToken);
        for (const p of humans) {
          this.profile.captures += p.captured;
          this.profile.bestRegions = Math.max(this.profile.bestRegions, p.regions.size);
          if (p.id === room.result.winnerId) this.profile.wins++;
        }
        this.saveProfile();
      }
      const noHumans = ![...room.players.values()].some(p => p.connected && !p.isBot);
      if (noHumans && now - room.lastHumanAt > BALANCE.emptyRoomTtlSeconds * 1000) this.rooms.delete(code);
    }
  }
  shutdown() {
    for (const room of this.rooms.values()) room.broadcast({ t: MESSAGE.SERVER_SHUTDOWN, message: 'Server is restarting. Your session can resume shortly.' });
  }
}
