import { BALANCE, BUILDING_TYPES } from '../../config/balance.js';
import { buildingCost, defenseMultiplier, neutralCost, regionDistance } from '../../shared/formulas.js';

export function difficultyProfile(level) { return BALANCE.ai.profiles[Math.max(0, Math.min(4, level - 1))]; }

export function decideAI(room, player) {
  const rng = room.rng;
  const level = player.difficulty || 3;
  const profile = difficultyProfile(level);
  if (!player.regions.size) return null;
  if (rng.chance(profile.mistake * .25)) return null;

  const attack = bestAttack(room, player, profile);
  const build = bestBuild(room, player, level, profile);
  if (attack && (!build || attack.score >= build.score || rng.next() > profile.buildSpend)) {
    return { type: 'ATTACK', payload: attack.payload };
  }
  if (build) return { type: build.existing ? 'UPGRADE' : 'BUILD', payload: build.payload };
  return attack ? { type: 'ATTACK', payload: attack.payload } : null;
}

function bestAttack(room, player, profile) {
  let best = null;
  const peaceful = room.gameTime < room.settings.peaceSeconds;
  if (peaceful) return null;
  for (const sourceId of player.regions) {
    const source = room.regions[sourceId];
    if (source.troops < 3 || room.hasActiveSource(sourceId)) continue;
    const targets = [...source.neighbors];
    if (source.buildings.some(b => b.type === 'port')) targets.push(...source.seaNeighbors);
    for (const targetId of targets) {
      const target = room.regions[targetId];
      if (target.ownerId === player.id) continue;
      if (target.ownerId != null && !room.players.has(target.ownerId)) continue;
      if (target.ownerId != null && room.rng.next() > profile.aggression + .18) continue;
      const needed = target.ownerId == null ? neutralCost(target) : target.troops * defenseMultiplier(target);
      if (source.troops < needed * 1.15 + 1) continue;
      const percent = Math.max(8, Math.min(95, Math.ceil((needed * 1.5 + 1) / source.troops * 100)));
      const nearbyThreat = target.neighbors.reduce((sum, id) => {
        const n = room.regions[id];
        return sum + (n.ownerId != null && n.ownerId !== player.id ? n.troops : 0);
      }, 0) / Math.max(1, target.neighbors.length);
      let score = 65 + Math.max(0, 45 - needed) + (target.isCoastal ? 5 : 0) + target.buildings.length * 10;
      score -= nearbyThreat * .08;
      score -= regionDistance(source, target) * .25;
      if (target.ownerId != null) score += profile.aggression * 35;
      if (target.id === room.players.get(target.ownerId)?.capitalRegion) score += 12;
      if (!best || score > best.score) best = { score, payload: { fromRegions: [sourceId], toRegionId: targetId, percent } };
    }
  }
  return best;
}

function bestBuild(room, player, level, profile) {
  if (level === 1 || player.economy < 90 || room.rng.next() > profile.buildSpend + .25) return null;
  const cap = BALANCE.troops.baseCap + BALANCE.troops.capPerHouse * player.houseLevels;
  const needsHouse = cap - player.totalTroops < 90 || player.houseLevels < Math.max(1, Math.floor(player.regionsCount / 5));
  const allowed = level === 2 ? ['house'] : level === 3 ? ['house','fort'] : level === 4 ? ['house','fort','port','aa'] : BUILDING_TYPES;
  const priorities = needsHouse ? ['house','fort','port','aa','drone','missile'] : level >= 5 ? ['drone','missile','aa','house','fort','port'] : ['fort','house','port','aa'];
  const ownedIds = [...player.regions];
  for (const type of priorities) {
    if (!allowed.includes(type)) continue;
    let region = null;
    if (type === 'fort' && player.regions.has(player.capitalRegion)) region = room.regions[player.capitalRegion];
    else if (type === 'port') {
      const coastal = ownedIds.map(id => room.regions[id]).filter(r => r.isCoastal);
      region = coastal[Math.floor(room.rng.next() * coastal.length)];
    } else if (type === 'house') {
      const choices = ownedIds.map(id => room.regions[id]).filter(r => !r.buildings.some(b => b.type === 'house' && b.level >= 5));
      region = choices[Math.floor(room.rng.next() * choices.length)];
    } else {
      const border = ownedIds.map(id => room.regions[id]).filter(r => r.neighbors.some(n => room.regions[n].ownerId !== player.id));
      region = (border.length ? border : ownedIds.map(id => room.regions[id]))[0];
    }
    if (!region || room.isRegionBusy(region.id) || region.buildings.length >= BALANCE.buildings.maxTypesPerRegion) continue;
    if (type === 'port' && !region.isCoastal) continue;
    const existing = region.buildings.find(b => b.type === type);
    if (existing?.level >= BALANCE.buildings.maxLevel) continue;
    const cost = buildingCost(type, player.buildingCount, existing?.level || 0);
    if (player.economy < cost) continue;
    let score = 45 + (needsHouse && type === 'house' ? 70 : 0) + (type === 'fort' && region.id === player.capitalRegion ? 20 : 0);
    return { score, existing: !!existing, payload: { regionId: region.id, buildingType: type } };
  }
  return null;
}
