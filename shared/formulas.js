import { BALANCE } from '../config/balance.js';

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const buildingMaxHp = (type, level = 1) => BALANCE.buildings[type].hp * level;

export function buildingTotals(player, regions) {
  const totals = { house: 0, port: 0, fort: 0, drone: 0, missile: 0, aa: 0, count: 0 };
  for (const regionId of player.regions) {
    for (const building of regions[regionId].buildings) {
      if ((building.disabledUntilTick || 0) > (player.tickIndex || 0)) continue;
      totals[building.type] += building.level;
      totals.count++;
    }
  }
  return totals;
}

export function troopGrowth(regionsCount, houseLevels = 0) {
  if (regionsCount <= 0) return 0;
  return BALANCE.troops.regionsFactor * regionsCount ** BALANCE.troops.regionsExponent * (1 + BALANCE.troops.houseGrowth * houseLevels);
}
export function troopCap(houseLevels = 0) { return BALANCE.troops.baseCap + BALANCE.troops.capPerHouse * houseLevels; }
export function economyIncome(regionsCount, houseLevels = 0) { return BALANCE.economy.regionIncome * regionsCount + BALANCE.economy.houseIncome * houseLevels; }
export function tradeIncome(regionsCount, portLevels = 0) { return BALANCE.economy.portIncome * portLevels * (1 + BALANCE.economy.portRegionScale * regionsCount / 100); }
export function totalIncome(regionsCount, houseLevels = 0, portLevels = 0) { return economyIncome(regionsCount, houseLevels) + tradeIncome(regionsCount, portLevels); }
export function buildingCost(type, totalBuildingsOwned, currentLevel = 0) {
  const def = BALANCE.buildings[type];
  if (!def) throw new Error(`Unknown building: ${type}`);
  const upgrade = currentLevel > 0 ? BALANCE.buildings.upgradeCostGrowth ** (currentLevel - 1) : 1;
  return Math.round(def.baseCost * upgrade * BALANCE.buildings.globalCostGrowth ** totalBuildingsOwned);
}
export function upgradeHp(type, oldLevel, oldHp) {
  const newMax = buildingMaxHp(type, oldLevel + 1);
  return Math.min(newMax, oldHp + newMax * BALANCE.buildings.repairOnUpgrade);
}
export function neutralCost(region) {
  return BALANCE.combat.neutralBase + BALANCE.combat.neutralTroopFactor * region.troops + BALANCE.combat.areaCostFactor * Math.sqrt(Math.max(1, region.area));
}
export function fortAt(region) {
  let level = 0;
  for (const b of region.buildings) if (b.type === 'fort') level += b.level;
  return level;
}
export function defenseMultiplier(region) { return 1 + BALANCE.combat.fortDefense * fortAt(region); }
export function attackModifiers(targetRegion, naval = false, portLevel = 0) {
  const fort = fortAt(targetRegion);
  return {
    force: clamp(1 - BALANCE.combat.fortAttackPenalty * fort, 0.55, 1) * (naval ? 1 + BALANCE.combat.portForceBonus * portLevel : 1),
    duration: fort ? BALANCE.combat.fortDuration : 1
  };
}
export function resolveBattle(force, defenderTroops, targetRegion, naval = false, portLevel = 0) {
  const mods = attackModifiers(targetRegion, naval, portLevel);
  const effectiveForce = Math.max(0, force * mods.force);
  const defense = defenseMultiplier(targetRegion);
  const cost = targetRegion.ownerId == null ? neutralCost(targetRegion) : defenderTroops * defense;
  const captured = effectiveForce > cost && effectiveForce >= BALANCE.combat.minForce;
  return {
    captured,
    attackerLeft: captured ? Math.max(1, Math.floor(effectiveForce - cost)) : 0,
    defenderLeft: captured ? 0 : Math.max(0, Math.ceil(defenderTroops - effectiveForce / defense)),
    effectiveForce,
    defense
  };
}
export function captureBuildingOutcome(rng, building, attackForce = 0) {
  const hpRatio = clamp(building.hp / buildingMaxHp(building.type, building.level), 0, 1);
  const forcePressure = clamp(attackForce / Math.max(1, buildingMaxHp(building.type, building.level)), 0, 1);
  const pDestroy = clamp(BALANCE.capture.destroyed + (1 - hpRatio) * 0.20 + forcePressure * 0.15, BALANCE.capture.minDestroy, BALANCE.capture.maxDestroy);
  const roll = rng.next();
  if (roll < pDestroy) return 'destroyed';
  // Preserve the 40:35 ratio between non-destruction outcomes at the baseline.
  const damagedShare = BALANCE.capture.damaged / (BALANCE.capture.intact + BALANCE.capture.damaged);
  if (roll < pDestroy + (1 - pDestroy) * damagedShare) return 'damaged';
  return 'intact';
}
export function regionDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function interpolate(a, b, t) { return a + (b - a) * t; }
