import { BALANCE, BUILDING_TYPES } from '../../config/balance.js';
import { buildingMaxHp, captureBuildingOutcome, regionDistance } from '../../shared/formulas.js';

export function createBuilding(type, id, tick, rng) {
  const maxHp = buildingMaxHp(type, 1);
  const cooldown = BALANCE.buildings[type].cooldown;
  return {
    id, type, level: 1, hp: maxHp, disabledUntilTick: 0,
    nextAt: cooldown ? rng.next() * Math.min(3, cooldown) : 0
  };
}

export function captureBuildings(room, region, attackerId, attackForce) {
  const kept = [];
  for (const building of region.buildings) {
    const outcome = captureBuildingOutcome(room.rng, building, attackForce);
    if (outcome === 'destroyed') {
      room.emit('BUILDING_LOST', { regionId: region.id, buildingType: building.type, outcome, ownerId: attackerId });
      continue;
    }
    if (outcome === 'damaged') {
      building.level = Math.max(1, building.level - 1);
      building.hp = Math.max(1, buildingMaxHp(building.type, building.level) * .5);
    }
    building.disabledUntilTick = room.tickIndex + 1;
    building.nextAt = room.gameTime + (BALANCE.buildings[building.type].cooldown || 0);
    kept.push(building);
    room.emit('BUILDING_CAPTURE', { regionId: region.id, buildingType: building.type, outcome, ownerId: attackerId });
  }
  region.buildings = kept;
}

export function findBuildingTarget(room, sourceRegion, ownerId, range) {
  const candidates = [];
  for (const region of room.regions) {
    if (region.ownerId == null || region.ownerId === ownerId || !region.buildings.length) continue;
    if (regionDistance(sourceRegion, region) > range) continue;
    for (const building of region.buildings) candidates.push({ region, building });
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(room.rng.next() * candidates.length)];
}

export function launchDrone(room, region, building) {
  const target = findBuildingTarget(room, region, region.ownerId, BALANCE.buildings.drone.range);
  if (!target) { building.nextAt = room.gameTime + 3; return; }
  const damage = BALANCE.buildings.drone.damage * building.level;
  room.projectiles.push(makeProjectile(room, 'drone', region, target.region, building, damage, BALANCE.buildings.drone.flight, target.building.id));
  building.nextAt = room.gameTime + BALANCE.buildings.drone.cooldown;
  room.emit('DRONE_LAUNCH', { regionId: region.id, targetRegionId: target.region.id, ownerId: region.ownerId });
}

export function launchMissile(room, region, building) {
  const target = findBuildingTarget(room, region, region.ownerId, BALANCE.buildings.missile.range);
  if (!target) { building.nextAt = room.gameTime + 5; return; }
  const damage = BALANCE.buildings.missile.damage * building.level;
  room.projectiles.push(makeProjectile(room, 'missile', region, target.region, building, damage, BALANCE.buildings.missile.flight, target.building.id));
  building.nextAt = room.gameTime + BALANCE.buildings.missile.cooldown;
  room.emit('MISSILE_LAUNCH', { regionId: region.id, targetRegionId: target.region.id, ownerId: region.ownerId });
}

function makeProjectile(room, kind, source, target, building, damage, duration, targetBuildingId) {
  return {
    id: room.nextEntityId++, kind, ownerId: source.ownerId, sourceRegion: source.id, targetRegion: target.id,
    targetBuildingId, sx: source.x, sy: source.y, tx: target.x, ty: target.y, x: source.x, y: source.y,
    duration, remaining: duration, damage, level: building.level, aaChecked: []
  };
}

export function updateProjectile(room, projectile, dt) {
  projectile.remaining -= dt;
  const progress = Math.max(0, Math.min(1, 1 - projectile.remaining / projectile.duration));
  projectile.x = projectile.sx + (projectile.tx - projectile.sx) * progress;
  projectile.y = projectile.sy + (projectile.ty - projectile.sy) * progress - Math.sin(progress * Math.PI) * (projectile.kind === 'missile' ? 4 : 1);
  // Each AA battery gets one attempt; drone interception is deterministic, missiles use the configured chance.
  for (const region of room.regions) {
    if (region.ownerId == null || region.ownerId === projectile.ownerId) continue;
    for (const aa of region.buildings) {
      if (aa.type !== 'aa' || aa.disabledUntilTick > room.tickIndex || projectile.aaChecked.includes(aa.id)) continue;
      if (aa.nextAt > room.gameTime || regionDistance(region, projectile) > BALANCE.buildings.aa.range) continue;
      projectile.aaChecked.push(aa.id);
      aa.nextAt = room.gameTime + BALANCE.buildings.aa.cooldown / Math.max(1, aa.level);
      const chance = projectile.kind === 'drone' ? 1 : Math.min(BALANCE.buildings.aa.maxIntercept, aa.level * BALANCE.buildings.aa.interceptPerLevel);
      if (room.rng.chance(chance)) {
        room.emit('AA_INTERCEPT', { regionId: region.id, targetRegionId: projectile.targetRegion, ownerId: region.ownerId, kind: projectile.kind });
        room.dirtyRegions.add(region.id);
        return false;
      }
    }
  }
  if (projectile.remaining > 0) return true;
  const target = room.regions[projectile.targetRegion];
  if (projectile.kind === 'drone') {
    const building = target.buildings.find(b => b.id === projectile.targetBuildingId) || target.buildings[0];
    if (building && target.ownerId !== projectile.ownerId) damageBuilding(room, target, building, projectile.damage, projectile.ownerId, 'DRONE_HIT');
  } else {
    for (const region of [target, ...target.neighbors.map(id => room.regions[id])]) {
      if (regionDistance(region, target) > BALANCE.buildings.missile.splash) continue;
      for (const building of [...region.buildings]) {
        if (region.ownerId !== projectile.ownerId) damageBuilding(room, region, building, projectile.damage, projectile.ownerId, 'MISSILE_HIT');
      }
    }
    room.emit('MISSILE_EXPLOSION', { regionId: target.id, ownerId: projectile.ownerId });
  }
  return false;
}

export function damageBuilding(room, region, building, damage, attackerId, eventType) {
  building.hp -= damage;
  if (building.hp <= 0) {
    region.buildings = region.buildings.filter(b => b.id !== building.id);
    room.emit('BUILDING_DESTROYED', { regionId: region.id, buildingType: building.type, ownerId: attackerId });
  } else {
    room.emit(eventType, { regionId: region.id, buildingType: building.type, damage: Math.round(damage), ownerId: attackerId });
  }
  room.dirtyRegions.add(region.id);
}

export function recalculatePlayer(room, player) {
  player.regionsCount = player.regions.size;
  player.houseLevels = 0; player.portLevels = 0; player.fortLevels = 0;
  player.droneLevels = 0; player.missileLevels = 0; player.aaLevels = 0; player.buildingCount = 0;
  for (const regionId of player.regions) {
    for (const b of room.regions[regionId].buildings) {
      if (b.disabledUntilTick > room.tickIndex) continue;
      player[`${b.type}Levels`] += b.level;
      player.buildingCount++;
    }
  }
  player.totalTroops = 0;
  for (const regionId of player.regions) player.totalTroops += room.regions[regionId].troops;
}

export function isBuildingType(type) { return BUILDING_TYPES.includes(type); }
