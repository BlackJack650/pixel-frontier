import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RNG } from '../shared/rng.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 192, H = 96;
const polygons = [
  // North America and Central America
  [[6,18],[14,12],[25,8],[40,8],[54,12],[62,19],[58,25],[51,28],[48,35],[41,39],[36,44],[30,42],[27,35],[20,32],[16,27],[9,25]],
  [[29,38],[37,39],[42,45],[40,49],[35,46],[31,43]],
  // South America
  [[40,46],[50,43],[58,48],[60,55],[56,64],[53,72],[48,82],[43,79],[42,69],[38,59],[36,51]],
  // Greenland
  [[48,8],[54,3],[61,5],[62,11],[57,18],[51,16]],
  // Europe
  [[83,22],[88,17],[98,15],[108,17],[115,22],[111,28],[105,31],[100,35],[93,31],[88,28],[82,28]],
  // Asia
  [[105,16],[119,11],[136,8],[153,10],[170,14],[181,21],[177,27],[167,29],[161,35],[153,38],[150,46],[141,45],[136,39],[128,37],[123,42],[116,37],[110,30],[114,23]],
  // Arabia / India
  [[105,31],[116,33],[121,40],[116,45],[109,41]],
  [[123,35],[132,38],[133,46],[128,52],[124,45]],
  // Africa
  [[82,37],[91,32],[105,34],[115,40],[119,47],[113,55],[108,63],[102,70],[95,67],[90,57],[86,49],[80,43]],
  // Australia
  [[143,59],[152,54],[165,54],[176,61],[174,70],[168,77],[156,79],[146,73],[141,66]],
  // Antarctica, broken into pixel shelves
  [[13,89],[33,86],[57,88],[79,86],[104,88],[126,86],[151,88],[179,87],[186,93],[7,93]]
];
const islands = [
  [78,21,2.3,3.5],[75,17,1.2,1.8],[86,16,1.3,1], // Britain / Iceland
  [113,69,1.4,5],[120,58,2,2], // Madagascar / Sri Lanka
  [139,48,3,1.4],[145,49,4,1.5],[151,50,3,1.3],[157,51,2,1.2], // Indonesia
  [133,55,3,1.4],[139,56,4,1.5],[150,55,3,1.3],
  [166,39,1.4,4],[170,34,1.3,3],[173,29,1.2,2], // Japan
  [181,78,2,4],[185,74,1.5,3], // New Zealand
  [61,46,2,1.2],[65,45,1.3,1], // Caribbean
  [24,50,1.2,1.2],[30,53,1,1], // Pacific
  [94,29,1.5,1.4],[100,30,1.2,1.2]
];

function insidePolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    const intersect = ((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
function landAt(x, y) {
  for (const polygon of polygons) if (insidePolygon(x + .5, y + .5, polygon)) return true;
  for (const [cx, cy, rx, ry] of islands) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) return true;
  return false;
}
function components(grid) {
  const seen = new Int32Array(W * H).fill(-1);
  const result = [];
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== -2 || seen[i] >= 0) continue;
    const id = result.length, cells = [], queue = [i];
    seen[i] = id;
    for (let q = 0; q < queue.length; q++) {
      const at = queue[q], x = at % W, y = Math.floor(at / W);
      cells.push(at);
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = ny * W + nx;
        if (grid[ni] === -2 && seen[ni] < 0) { seen[ni] = id; queue.push(ni); }
      }
    }
    result.push(cells);
  }
  return result;
}
function generate(regionTarget, seed, name) {
  const rng = new RNG(seed), grid = new Int32Array(W * H).fill(-1);
  const land = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (landAt(x, y)) { grid[y * W + x] = -2; land.push(y * W + x); }
  // Guarantee coverage of every island before distributing the remaining seeds.
  const comps = components(grid);
  const seeds = [];
  for (const cells of comps) seeds.push(cells[Math.floor(rng.next() * cells.length)]);
  const minDist = new Float64Array(W * H).fill(Infinity);
  function addSeed(at) {
    seeds.push(at);
    const sx = at % W, sy = Math.floor(at / W);
    for (const cell of land) {
      const x = cell % W, y = Math.floor(cell / W);
      minDist[cell] = Math.min(minDist[cell], (x - sx) ** 2 + (y - sy) ** 2);
    }
  }
  for (const at of seeds) {
    const sx = at % W, sy = Math.floor(at / W);
    for (const cell of land) {
      const x = cell % W, y = Math.floor(cell / W);
      minDist[cell] = Math.min(minDist[cell], (x - sx) ** 2 + (y - sy) ** 2);
    }
  }
  while (seeds.length < regionTarget) {
    let best = land[0], bestScore = -1;
    // Sampling from all land produces compact but organic Voronoi-like territories.
    for (const cell of land) {
      const jitter = rng.next() * .15;
      const score = minDist[cell] * (1 + jitter);
      if (score > bestScore && !seeds.includes(cell)) { bestScore = score; best = cell; }
    }
    addSeed(best);
  }
  const queue = [], regionOfCell = new Int32Array(W * H).fill(-1);
  seeds.forEach((cell, id) => { regionOfCell[cell] = id; queue.push(cell); });
  // Randomized source order avoids visible directional growth artifacts.
  for (let q = 0; q < queue.length; q++) {
    const at = queue[q], id = regionOfCell[at], x = at % W, y = Math.floor(at / W);
    const neighbors = [[1,0],[-1,0],[0,1],[0,-1]];
    if ((at + id) % 2) neighbors.reverse();
    for (const [dx, dy] of neighbors) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = ny * W + nx;
      if (grid[ni] === -2 && regionOfCell[ni] < 0) { regionOfCell[ni] = id; queue.push(ni); }
    }
  }
  const regions = Array.from({ length: regionTarget }, (_, id) => ({ id, area: 0, x: 0, y: 0, minX: W, minY: H, maxX: 0, maxY: 0, neighbors: [], seaNeighbors: [], isCoastal: false }));
  for (let i = 0; i < regionOfCell.length; i++) {
    const id = regionOfCell[i];
    if (id < 0) continue;
    const r = regions[id], x = i % W, y = Math.floor(i / W);
    r.area++; r.x += x + .5; r.y += y + .5;
    r.minX = Math.min(r.minX, x); r.maxX = Math.max(r.maxX, x); r.minY = Math.min(r.minY, y); r.maxY = Math.max(r.maxY, y);
    if (x === 0 || x === W - 1 || y === 0 || y === H - 1 || regionOfCell[i - 1] < 0 || regionOfCell[i + 1] < 0 || regionOfCell[i - W] < 0 || regionOfCell[i + W] < 0) r.isCoastal = true;
  }
  const neighborSets = regions.map(() => new Set());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const id = regionOfCell[y * W + x];
    if (id < 0) continue;
    for (const [dx, dy] of [[1,0],[0,1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= W || ny >= H) continue;
      const other = regionOfCell[ny * W + nx];
      if (other >= 0 && other !== id) { neighborSets[id].add(other); neighborSets[other].add(id); }
    }
  }
  regions.forEach((r, id) => {
    r.x = +(r.x / r.area).toFixed(2); r.y = +(r.y / r.area).toFixed(2);
    r.neighbors = [...neighborSets[id]].sort((a,b) => a-b);
  });
  const coastal = regions.filter(r => r.isCoastal);
  for (const a of coastal) for (const b of coastal) {
    if (a.id >= b.id) continue;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d <= 6 && !a.neighbors.includes(b.id)) { a.seaNeighbors.push(b.id); b.seaNeighbors.push(a.id); }
  }
  const outGrid = Array.from(regionOfCell);
  return {
    name, width: W, height: H, seed, grid: outGrid, regions,
    labels: [
      { text: 'NORTH AMERICA', x: 33, y: 24 }, { text: 'SOUTH AMERICA', x: 49, y: 58 },
      { text: 'EUROPE', x: 98, y: 24 }, { text: 'AFRICA', x: 100, y: 48 },
      { text: 'ASIA', x: 143, y: 24 }, { text: 'OCEANIA', x: 160, y: 66 }
    ]
  };
}

fs.mkdirSync(path.join(root, 'shared/map'), { recursive: true });
for (const [count, seed, name, file] of [[300, 71273, 'Meridian', 'map.json'], [350, 99817, 'Meridian Large', 'map-large.json']]) {
  const map = generate(count, seed, name);
  const empty = map.regions.filter(r => !r.area);
  if (empty.length) throw new Error(`Empty regions: ${empty.map(r => r.id).join(',')}`);
  fs.writeFileSync(path.join(root, 'shared/map', file), JSON.stringify(map));
  console.log(`${file}: ${map.regions.length} regions, ${map.grid.filter(id => id >= 0).length} land cells`);
}
