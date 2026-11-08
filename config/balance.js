// Every gameplay number lives here. Distances are in 192×96 map cells, time in seconds.
export const BALANCE = Object.freeze({
  tickRate: 20,
  snapshotRate: 10,
  maxPlayers: 20,
  commandRatePerSecond: 30,
  commandCooldownMs: 100,
  reconnectSeconds: 90,
  emptyRoomTtlSeconds: 60,
  maxRooms: 100,
  countdownSeconds: 3,
  defaultWinPercent: 0.25, // Domination vertical slice; use 1 for last-nation/world conquest.
  map: { width: 192, height: 96, standardRegions: 300, largeRegions: 350, neutralMin: 3, neutralMax: 13 },
  start: { troopCap: 300, troopFactor: 0.4, economy: 200 },
  troops: { regionsFactor: 0.30, regionsExponent: 0.92, houseGrowth: 0.03, baseCap: 300, capPerHouse: 350 },
  economy: { regionIncome: 0.06, houseIncome: 0.35, portIncome: 0.5, portRegionScale: 0.05 },
  combat: {
    neutralBase: 1,
    neutralTroopFactor: 0.5,
    areaCostFactor: 0.16,
    fortDuration: 1.5,
    fortAttackPenalty: 0.08,
    fortDefense: 0.10,
    portForceBonus: 0.15,
    waveBase: 0.25,
    wavePerTile: 0.05,
    autoExpandForce: 0.65,
    minForce: 1
  },
  buildings: {
    maxLevel: 5,
    maxTypesPerRegion: 6,
    repairOnUpgrade: 0.5,
    globalCostGrowth: 1.08,
    upgradeCostGrowth: 1.6,
    house: { name: 'Habitat', baseCost: 100, hp: 100 },
    port: { name: 'Port', baseCost: 250, hp: 120, range: 6 },
    fort: { name: 'Bastion', baseCost: 300, hp: 150, range: 4 },
    drone: { name: 'FPV drone', baseCost: 400, hp: 80, range: 5, cooldown: 20, damage: 25, flight: 1.2 },
    missile: { name: 'Missile', baseCost: 900, hp: 60, range: 12, cooldown: 60, damage: 120, flight: 2.5, splash: 1.5 },
    aa: { name: 'AA array', baseCost: 500, hp: 100, range: 6, cooldown: 8, interceptPerLevel: 0.25, maxIntercept: 0.9 }
  },
  capture: { intact: 0.40, damaged: 0.35, destroyed: 0.25, minDestroy: 0.05, maxDestroy: 0.60 },
  ai: {
    mixedWeights: [0.15, 0.20, 0.30, 0.20, 0.15],
    profiles: [
      { reaction: 1.20, aggression: 0.20, buildSpend: 0.20, mistake: 0.28 },
      { reaction: 0.90, aggression: 0.35, buildSpend: 0.30, mistake: 0.20 },
      { reaction: 0.60, aggression: 0.50, buildSpend: 0.40, mistake: 0.12 },
      { reaction: 0.35, aggression: 0.70, buildSpend: 0.55, mistake: 0.06 },
      { reaction: 0.15, aggression: 0.90, buildSpend: 0.70, mistake: 0.02 }
    ]
  },
  colors: ['#b8ef68','#ff8066','#62c9f1','#e7a6ff','#ffd166','#72e4bd','#ff8dc7','#91a7ff','#f29e4c','#80ed99','#c77dff','#56cfe1','#f87171','#a3e635','#fbbf24','#38bdf8','#fb7185','#4ade80','#c084fc','#2dd4bf']
});

export const BUILDING_TYPES = Object.freeze(['house', 'port', 'fort', 'drone', 'missile', 'aa']);
export const GAME_DEFAULTS = Object.freeze({
  botCount: 7,
  difficulty: 'mixed',
  speed: 1,
  troopMultiplier: 1,
  economyMultiplier: 1,
  peaceSeconds: 10,
  mapSize: 'standard',
  seed: 42042,
  winPercent: BALANCE.defaultWinPercent
});
