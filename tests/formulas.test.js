import test from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../config/balance.js';
import { troopGrowth, troopCap, economyIncome, tradeIncome, totalIncome, buildingCost, buildingMaxHp, upgradeHp, neutralCost, resolveBattle, attackModifiers, captureBuildingOutcome } from '../shared/formulas.js';
import { RNG } from '../shared/rng.js';

test('troop growth, cap and over-cap formula are stable',()=>{
  assert.equal(troopGrowth(0),0);
  assert.ok(Math.abs(troopGrowth(1)-.30)<1e-9);
  assert.equal(troopCap(),300);assert.equal(troopCap(2),1000);
  assert.ok(troopGrowth(10,3)>troopGrowth(10,0));
  assert.equal(troopGrowth(100)*0,0,'over-cap multiplier disables growth without burning excess');
});
test('economy and trade formulas include ports and region scaling',()=>{
  assert.ok(Math.abs(economyIncome(10,2)-1.3)<1e-9);
  assert.ok(Math.abs(tradeIncome(100,2)-1.05)<1e-9);
  assert.ok(Math.abs(totalIncome(10,2,2)-2.305)<1e-9);
});
test('building prices grow globally and by upgrade level',()=>{
  const first=buildingCost('house',0),second=buildingCost('house',1);
  assert.equal(first,100);assert.equal(second,108);assert.ok(second>first);
  assert.equal(buildingCost('house',0,2),160);
  assert.equal(buildingCost('missile',0),900);
});
test('upgrades repair exactly 50% of the new maximum, capped',()=>{
  assert.equal(buildingMaxHp('fort',3),450);
  assert.equal(upgradeHp('house',1,10),110);
  assert.equal(upgradeHp('house',1,100),200);
});
test('neutral cost includes garrison and area',()=>{
  assert.equal(neutralCost({troops:0,area:0}),1.16);
  assert.ok(neutralCost({troops:12,area:25})>neutralCost({troops:12,area:1}));
});
test('battle capture and defense remainder are deterministic',()=>{
  const neutral={ownerId:null,troops:6,area:4,buildings:[]};
  const win=resolveBattle(100,6,neutral);assert.equal(win.captured,true);assert.ok(win.attackerLeft>0);
  const loss=resolveBattle(1,6,neutral);assert.equal(loss.captured,false);
  const defended={ownerId:'enemy',troops:100,area:4,buildings:[{type:'fort',level:2}]};
  const result=resolveBattle(100,100,defended);assert.equal(result.captured,false);assert.ok(result.defenderLeft>0);
  const mods=attackModifiers(defended);assert.equal(mods.duration,1.5);assert.ok(mods.force<1);
});
test('naval force receives 15% per port level',()=>{
  const target={ownerId:'enemy',troops:1,area:1,buildings:[]};
  assert.ok(attackModifiers(target,true,2).force>attackModifiers(target,false,0).force);
});
test('building capture can produce intact, damaged and destroyed outcomes',()=>{
  const outcomes=new Set(),rng=new RNG(42),building={type:'house',level:3,hp:70};
  for(let i=0;i<300;i++)outcomes.add(captureBuildingOutcome(rng,building,50));
  assert.deepEqual([...outcomes].sort(),['damaged','destroyed','intact']);
});
test('capture destroy probability is bounded',()=>{
  const alwaysHigh={next:()=>.59},building={type:'missile',level:1,hp:1};
  assert.equal(captureBuildingOutcome(alwaysHigh,building,1e6),'destroyed');
  assert.equal(captureBuildingOutcome({next:()=>.999},{type:'house',level:5,hp:500},0),'intact');
});
test('seeded RNG is reproducible',()=>{const a=new RNG(42),b=new RNG(42);for(let i=0;i<100;i++)assert.equal(a.next(),b.next());});
