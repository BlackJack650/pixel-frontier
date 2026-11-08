import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameRoom } from '../server/rooms/gameRoom.js';
import { troopCap } from '../shared/formulas.js';
import { recalculatePlayer, createBuilding, launchDrone, launchMissile, updateProjectile } from '../server/sim/systems.js';

const map=JSON.parse(fs.readFileSync(new URL('../shared/map/map.json',import.meta.url),'utf8'));
function makeRoom(){const room=new GameRoom({code:'TEST01',map,mode:'solo',settings:{seed:42,peaceSeconds:0,speed:1}});const {player}=room.addHuman('Tester');room.addBot(3);room.start();room.phase='playing';room.gameTime=1;return{room,player,bot:[...room.players.values()].find(p=>p.isBot)};}

test('0% attack is rejected and 100% removes the full source garrison',()=>{
  const{room,player}=makeRoom(),source=room.regions[player.capitalRegion],target=source.neighbors.map(id=>room.regions[id]).find(r=>r.ownerId!==player.id);
  assert.equal(room.attack(player,{fromRegions:[source.id],toRegionId:target.id,percent:0}).code,'ZERO_PERCENT');
  const before=source.troops;assert.ok(before>0);
  assert.equal(room.attack(player,{fromRegions:[source.id],toRegionId:target.id,percent:100}),null);
  assert.equal(source.troops,0);assert.equal(room.waves.length,1);assert.equal(room.waves[0].force,Math.floor(before));
});

test('habitat raises cap, levels stop at 5, prices rise and HP never regenerates',()=>{
  const{room,player}=makeRoom(),region=room.regions[player.capitalRegion];player.economy=1e9;
  assert.equal(troopCap(player.houseLevels),300);
  assert.equal(room.build(player,{regionId:region.id,buildingType:'house'},false),null);
  recalculatePlayer(room,player);assert.equal(troopCap(player.houseLevels),650);
  const house=region.buildings[0];const costs=[];
  for(let level=2;level<=5;level++){costs.push(player.economy);assert.equal(room.build(player,{regionId:region.id,buildingType:'house'},true),null);assert.equal(house.level,level);}
  assert.equal(room.build(player,{regionId:region.id,buildingType:'house'},true).code,'MAX_LEVEL');
  house.hp=5;room.updateEconomy(30);room.updateBuildings();assert.equal(house.hp,5);
  assert.equal(room.build(player,{regionId:region.id,buildingType:'house'},true).code,'MAX_LEVEL','level 6 remains blocked after damage');
});

test('ports reject inland sectors and construction is blocked in active combat',()=>{
  const{room,player}=makeRoom(),inland=room.regions.find(r=>!r.isCoastal);inland.ownerId=player.id;player.regions.add(inland.id);player.economy=1e6;
  assert.equal(room.build(player,{regionId:inland.id,buildingType:'port'},false).code,'NOT_COASTAL');
  room.waves.push({fromRegions:[inland.id],targetRegionId:inland.neighbors[0]});
  assert.equal(room.build(player,{regionId:inland.id,buildingType:'house'},false).code,'REGION_BUSY');
});

test('drone damages infrastructure and AA intercepts a drone before impact',()=>{
  const{room,player,bot}=makeRoom(),source=room.regions[player.capitalRegion],target=room.regions[bot.capitalRegion];
  source.x=source.y=0;target.x=2;target.y=0;target.ownerId=bot.id;target.buildings=[];
  const house=createBuilding('house',9000,0,room.rng);house.disabledUntilTick=0;target.buildings.push(house);
  const drone=createBuilding('drone',9001,0,room.rng);drone.disabledUntilTick=0;source.buildings=[drone];
  launchDrone(room,source,drone);assert.equal(room.projectiles.length,1);
  const projectile=room.projectiles[0];while(room.projectiles.includes(projectile)&&projectile.remaining>0){if(!updateProjectile(room,projectile,.3))break;}
  assert.ok(house.hp<100,'drone inflicts 25 damage at level 1');

  house.hp=100;const aa=createBuilding('aa',9002,0,room.rng);aa.disabledUntilTick=0;aa.nextAt=0;target.buildings.push(aa);room.gameTime=10;
  launchDrone(room,source,drone);const intercepted=room.projectiles.at(-1);assert.equal(updateProjectile(room,intercepted,.1),false);assert.equal(house.hp,100);
  assert.ok(room.events.some(e=>e.type==='AA_INTERCEPT'));
});

test('missile salvo can destroy a building on impact',()=>{
  const{room,player,bot}=makeRoom(),source=room.regions[player.capitalRegion],target=room.regions[bot.capitalRegion];
  source.x=source.y=0;target.x=2;target.y=0;target.ownerId=bot.id;target.buildings=[];
  const house=createBuilding('house',9100,0,room.rng);house.disabledUntilTick=0;target.buildings.push(house);
  const missile=createBuilding('missile',9101,0,room.rng);missile.disabledUntilTick=0;source.buildings=[missile];
  launchMissile(room,source,missile);const projectile=room.projectiles[0];
  while(projectile.remaining>0){if(!updateProjectile(room,projectile,.5))break;}
  assert.equal(target.buildings.length,0);assert.ok(room.events.some(e=>e.type==='BUILDING_DESTROYED'));
});

test('reconnect restores the same player and freezes a disconnected human',()=>{
  const{room,player}=makeRoom();room.detach(player.id);assert.equal(player.connected,false);assert.equal(player.isBot,false);
  room.attach(player.id,null);assert.equal(player.connected,true);assert.ok(room.players.get(player.id)===player);
});
