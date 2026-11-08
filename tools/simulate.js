import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameRoom } from '../server/rooms/gameRoom.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=Object.fromEntries(process.argv.slice(2).reduce((out,value,index,array)=>{if(value.startsWith('--'))out.push([value.slice(2),array[index+1]?.startsWith('--')?true:array[index+1]??true]);return out;},[]));
const ai=Math.max(1,Math.min(15,Number(args.ai)||8)),minutes=Math.max(.1,Number(args.minutes)||5),seed=Number(args.seed)||42;
const map=JSON.parse(fs.readFileSync(path.join(root,'shared/map/map.json'),'utf8'));
const room=new GameRoom({code:'SIM001',map,mode:'solo',settings:{seed,botCount:ai,difficulty:'mixed',speed:4,peaceSeconds:5,mapSize:'standard',winPercent:.25}});
const {player}=room.addHuman('Benchmark');
for(let i=0;i<ai;i++)room.addBot('mixed');room.start();
player.isBot=true;player.difficulty=3;
let lastReport=-1,steps=0;const maxSteps=20*60*minutes*2;
while(!room.result&&room.gameTime<minutes*60&&steps<maxSteps){
  room.tick();steps++;
  const second=Math.floor(room.gameTime);
  if(second>=30&&second%30===0&&second!==lastReport){lastReport=second;const leaders=[...room.players.values()].sort((a,b)=>b.regions.size-a.regions.size);console.log(`[${String(Math.floor(second/60)).padStart(2,'0')}:${String(second%60).padStart(2,'0')}] ${leaders[0].name}: ${leaders[0].regions.size} regions · ${Math.floor(leaders[0].totalTroops)} troops · ${room.waves.length} waves · ${room.projectiles.length} projectiles`);}
  if(steps%100===0)validate(room);
}
validate(room);
if(!room.result){const leader=[...room.players.values()].sort((a,b)=>b.regions.size-a.regions.size)[0];room.finish(leader.id);console.log('Time limit reached; winner determined by controlled regions.');}
console.log('\nSIMULATION COMPLETE');console.log(`Seed: ${seed} · AI slots: ${ai} · Simulated: ${Math.floor(room.gameTime)}s · Ticks: ${steps}`);
for(const p of [...room.players.values()].sort((a,b)=>b.regions.size-a.regions.size))console.log(`${p.name.padEnd(14)} level ${p.difficulty} · ${String(p.regions.size).padStart(3)} regions · ${String(p.captured).padStart(4)} captures · ${String(p.buildingCount).padStart(3)} structures`);
console.log(`Winner: ${room.players.get(room.result.winnerId)?.name}`);

function validate(room){
  const owned=new Set();
  for(const region of room.regions){
    if(!Number.isFinite(region.troops)||region.troops<0)throw new Error(`Invalid troops in region ${region.id}`);
    if(region.ownerId!=null){if(!room.players.has(region.ownerId))throw new Error(`Unknown owner in region ${region.id}`);if(owned.has(region.id))throw new Error(`Duplicate region ${region.id}`);owned.add(region.id);}
    for(const b of region.buildings)if(!Number.isFinite(b.hp)||b.level<1||b.level>5)throw new Error(`Invalid building ${b.id}`);
  }
  for(const p of room.players.values())for(const id of p.regions)if(room.regions[id].ownerId!==p.id)throw new Error(`Player/region mismatch: ${p.name}/${id}`);
}
