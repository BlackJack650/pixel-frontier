import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

for(const file of ['map.json','map-large.json']){
  const map=JSON.parse(fs.readFileSync(new URL(`../shared/map/${file}`,import.meta.url),'utf8'));
  test(`${file}: dimensions, region budget and populated regions`,()=>{
    assert.equal(map.width,192);assert.equal(map.height,96);assert.ok(map.regions.length>=250&&map.regions.length<=350);
    assert.equal(map.grid.length,map.width*map.height);assert.ok(map.regions.every(r=>r.area>0));
    assert.ok(map.grid.every(id=>id===-1||(id>=0&&id<map.regions.length)));
  });
  test(`${file}: each territory is 4-connected`,()=>{
    for(const region of map.regions){
      const cells=[];for(let i=0;i<map.grid.length;i++)if(map.grid[i]===region.id)cells.push(i);
      const seen=new Set([cells[0]]),queue=[cells[0]];
      for(let q=0;q<queue.length;q++){const at=queue[q],x=at%map.width;for(const next of [at-1,at+1,at-map.width,at+map.width]){if(next<0||next>=map.grid.length)continue;if((next===at-1&&x===0)||(next===at+1&&x===map.width-1))continue;if(map.grid[next]===region.id&&!seen.has(next)){seen.add(next);queue.push(next);}}}
      assert.equal(seen.size,region.area,`Region ${region.id} is fragmented`);
    }
  });
  test(`${file}: land and port adjacency are symmetric`,()=>{
    for(const r of map.regions){for(const n of r.neighbors){assert.ok(map.regions[n].neighbors.includes(r.id));assert.notEqual(n,r.id);}for(const n of r.seaNeighbors){assert.ok(map.regions[n].seaNeighbors.includes(r.id));assert.ok(r.isCoastal&&map.regions[n].isCoastal);}}
  });
  test(`${file}: map contains recognizable continental landmasses`,()=>{
    assert.ok(map.regions.filter(r=>r.x<75&&r.y<43).length>25,'North America');
    assert.ok(map.regions.filter(r=>r.x<70&&r.y>44).length>15,'South America');
    assert.ok(map.regions.filter(r=>r.x>80&&r.x<123&&r.y>32).length>25,'Africa');
    assert.ok(map.regions.filter(r=>r.x>115&&r.y<50).length>35,'Asia');
    assert.ok(map.regions.filter(r=>r.x>140&&r.y>53).length>12,'Oceania');
  });
}
