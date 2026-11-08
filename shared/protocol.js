export const MESSAGE = Object.freeze({
  HELLO: 'HELLO', WELCOME: 'WELCOME', LOBBY: 'LOBBY', START: 'START', SNAP: 'SNAP', FULL: 'FULL',
  CMD: 'CMD', ACK: 'ACK', ERR: 'ERR', EVENT: 'EVENT', CHAT: 'CHAT', PING: 'PING', PONG: 'PONG',
  RESULT: 'RESULT', SERVER_SHUTDOWN: 'SERVER_SHUTDOWN'
});
export const COMMANDS = Object.freeze(['ATTACK', 'BUILD', 'UPGRADE', 'SET_ATTACK_PERCENT', 'SET_AUTO_EXPAND', 'CHAT', 'PING', 'PAUSE', 'ADD_BOT', 'REMOVE_BOT', 'KICK', 'UPDATE_SETTINGS', 'START_MATCH', 'REMATCH', 'LEAVE']);
export const BUILDING_COMMANDS = new Set(['BUILD', 'UPGRADE']);
export const MAX_CHAT = 200;

export function makeCommand(cmdId, type, payload = {}) { return { t: MESSAGE.CMD, cmdId, type, payload }; }
export function safeString(value, max = 24) { return String(value ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max); }
export function validCode(code) { return typeof code === 'string' && /^[A-Z0-9]{6}$/.test(code); }
export function validateCommand(message) {
  if (!message || message.t !== MESSAGE.CMD || !COMMANDS.includes(message.type)) return 'BAD_COMMAND';
  if (typeof message.cmdId !== 'string' || message.cmdId.length > 64) return 'BAD_COMMAND_ID';
  if (!message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)) return 'BAD_PAYLOAD';
  if (message.type === 'ATTACK') {
    const { fromRegions, toRegionId, percent } = message.payload;
    if (!Array.isArray(fromRegions) || fromRegions.length < 1 || fromRegions.length > 350 || !fromRegions.every(id => Number.isInteger(id) && id >= 0)) return 'BAD_SOURCE';
    if (!Number.isInteger(toRegionId) || toRegionId < 0) return 'BAD_TARGET';
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) return 'BAD_PERCENT';
  }
  if (BUILDING_COMMANDS.has(message.type)) {
    if (!Number.isInteger(message.payload.regionId) || message.payload.regionId < 0) return 'BAD_REGION';
    if (!['house','port','fort','drone','missile','aa'].includes(message.payload.buildingType)) return 'BAD_BUILDING';
  }
  if (message.type === 'CHAT' && (typeof message.payload.text !== 'string' || message.payload.text.length > MAX_CHAT)) return 'BAD_CHAT';
  return null;
}
