import { BALANCE } from '/config/balance.js';
import { RNG } from '/shared/rng.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hexCache = new Map();
function rgb(hex) {
  if (!hexCache.has(hex)) hexCache.set(hex, [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]);
  return hexCache.get(hex);
}
const colorCss = (c, shade = 1) => `rgb(${Math.round(c[0]*shade)},${Math.round(c[1]*shade)},${Math.round(c[2]*shade)})`;

export class WorldRenderer {
  constructor(canvas, minimap) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
    this.minimap = minimap; this.miniCtx = minimap.getContext('2d');
    this.map = null; this.base = null; this.baseCtx = null; this.image = null;
    this.regionState = new Map(); this.players = new Map(); this.clientId = null;
    this.selected = new Set(); this.hovered = null; this.buildMode = null;
    this.waves = []; this.projectiles = []; this.particles = []; this.floaters = [];
    this.camera = { x: 96, y: 48, scale: 6, vx: 0, vy: 0 };
    this.width = innerWidth; this.height = innerHeight; this.dpr = 1; this.fitScale = 6;
    this.dirty = true; this.inGame = false; this.demo = true; this.pointerDown = false;
    this.lastFrame = performance.now(); this.lastSnapshotAt = performance.now();
    this.fps = 60; this.frameCount = 0; this.fpsAt = performance.now(); this.renderMs = 0; this.quality = 1;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize(); addEventListener('resize', () => this.resize());
  }

  resize() {
    this.width = innerWidth; this.height = innerHeight; this.dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`; this.canvas.style.height = `${this.height}px`;
    this.ctx.imageSmoothingEnabled = false;
    this.fitScale = Math.min(this.width / 192, this.height / 96);
    if (this.map) this.clampCamera();
  }

  setMap(map, fit = true) {
    this.map = map; this.base = document.createElement('canvas'); this.base.width = map.width; this.base.height = map.height;
    this.baseCtx = this.base.getContext('2d', { alpha: false }); this.image = this.baseCtx.createImageData(map.width, map.height);
    this.regionState.clear(); this.selected.clear(); this.hovered = null; this.waves = []; this.projectiles = []; this.particles = [];
    this.dirty = true;
    if (fit) this.fit();
  }

  fit() {
    if (!this.map) return;
    this.fitScale = Math.min(this.width / this.map.width, this.height / this.map.height);
    this.camera.scale = this.fitScale * (this.inGame ? .91 : 1.06);
    this.camera.x = this.map.width / 2; this.camera.y = this.map.height / 2;
    this.camera.vx = this.camera.vy = 0; this.clampCamera();
  }

  makeDemo() {
    if (!this.map) return;
    this.demo = true; this.inGame = false; this.players.clear(); this.regionState.clear();
    const rng = new RNG(8231), ids = [];
    for (let i = 0; i < 12; i++) { const id = `demo-${i}`; ids.push(id); this.players.set(id, { id, color: BALANCE.colors[i], pattern: i % 4, name: `Power ${i}` }); }
    const capitals = [], candidates = this.map.regions.filter(r => r.area > 12);
    for (const id of ids) {
      let best = candidates[0], score = -1;
      for (let n = 0; n < 35; n++) {
        const r = candidates[Math.floor(rng.next() * candidates.length)];
        const d = capitals.length ? Math.min(...capitals.map(c => Math.hypot(c.x-r.x,c.y-r.y))) : 100;
        if (d > score) { score = d; best = r; }
      }
      capitals.push(best); best.demoOwner = id;
    }
    for (const r of this.map.regions) {
      let owner = null, best = Infinity;
      for (const c of capitals) { const d = (c.x-r.x)**2 + (c.y-r.y)**2; if (d < best) { best = d; owner = c.demoOwner; } }
      if (rng.next() < .07) owner = null;
      this.regionState.set(r.id, { i: r.id, o: owner, t: rng.int(3,90), b: [] });
    }
    this.dirty = true; this.fit();
  }

  setSnapshot(snapshot, clientId) {
    this.demo = false; this.inGame = true; this.clientId = clientId;
    if (snapshot.full) this.regionState.clear();
    for (const p of snapshot.players) this.players.set(p.id, p);
    for (const r of snapshot.regions) { this.regionState.set(r.i, r); this.dirty = true; }
    this.waves = snapshot.waves; this.projectiles = snapshot.projectiles;
    this.lastSnapshotAt = performance.now(); this.dirty = true;
    for (const event of snapshot.events || []) this.spawnEvent(event);
  }

  setSelection(ids) { this.selected = new Set(ids); this.dirty = true; }
  setHovered(id) { if (id !== this.hovered) { this.hovered = id; this.dirty = true; } }
  setBuildMode(type) { this.buildMode = type; }

  redrawBase() {
    if (!this.map || !this.dirty) return;
    const { width: w, height: h, grid } = this.map, data = this.image.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const at = y*w+x, id = grid[at], offset = at*4;
      let c;
      if (id < 0) {
        const wave = (x*3+y*5)%17 === 0;
        c = wave ? [10,40,49] : ((x+y)%2 ? [7,31,40] : [8,34,43]);
      } else {
        const state = this.regionState.get(id), owner = state?.o != null ? this.players.get(state.o) : null;
        const noise = ((x*13 + y*7 + id*3) % 3) * .045;
        c = owner ? rgb(owner.color) : [47,70,62];
        let shade = owner ? .57 + noise : .72 + noise;
        if (owner && ((owner.pattern === 1 && (x+y)%7===0) || (owner.pattern === 2 && (x-y+96)%8===0) || (owner.pattern === 3 && x%7===0 && y%3===0))) shade *= .77;
        const left = x > 0 ? grid[at-1] : -1, right = x < w-1 ? grid[at+1] : -1, up = y > 0 ? grid[at-w] : -1, down = y < h-1 ? grid[at+w] : -1;
        const border = left !== id || right !== id || up !== id || down !== id;
        if (border) {
          const selected = this.selected.has(id), hovered = this.hovered === id;
          if (selected) c = [220,255,159], shade = 1;
          else if (hovered) c = [246,200,95], shade = .95;
          else shade = owner ? .32 : .48;
        }
        c = [Math.round(c[0]*shade), Math.round(c[1]*shade), Math.round(c[2]*shade)];
      }
      data[offset] = c[0]; data[offset+1] = c[1]; data[offset+2] = c[2]; data[offset+3] = 255;
    }
    this.baseCtx.putImageData(this.image, 0, 0); this.dirty = false;
  }

  worldToScreen(x, y) { return { x: (x-this.camera.x)*this.camera.scale+this.width/2, y: (y-this.camera.y)*this.camera.scale+this.height/2 }; }
  screenToWorld(x, y) { return { x: (x-this.width/2)/this.camera.scale+this.camera.x, y: (y-this.height/2)/this.camera.scale+this.camera.y }; }
  pick(x, y) {
    if (!this.map) return null;
    const p = this.screenToWorld(x,y), gx = Math.floor(p.x), gy = Math.floor(p.y);
    if (gx < 0 || gy < 0 || gx >= this.map.width || gy >= this.map.height) return null;
    const id = this.map.grid[gy*this.map.width+gx]; return id >= 0 ? id : null;
  }
  zoom(factor, sx = this.width/2, sy = this.height/2) {
    if (!this.map) return;
    const before = this.screenToWorld(sx,sy), min = this.fitScale*.5, max = this.fitScale*8;
    this.camera.scale = clamp(this.camera.scale*factor,min,max);
    const after = this.screenToWorld(sx,sy);
    this.camera.x += before.x-after.x; this.camera.y += before.y-after.y; this.clampCamera();
  }
  panBy(dx,dy) { this.camera.x -= dx/this.camera.scale; this.camera.y -= dy/this.camera.scale; this.camera.vx = -dx/this.camera.scale*7; this.camera.vy = -dy/this.camera.scale*7; this.clampCamera(); }
  centerOn(x,y) { this.camera.x=x; this.camera.y=y; this.camera.vx=this.camera.vy=0; this.clampCamera(); }
  clampCamera() {
    if (!this.map) return;
    const halfW = this.width/(2*this.camera.scale), halfH = this.height/(2*this.camera.scale);
    this.camera.x = halfW*2 >= this.map.width ? this.map.width/2 : clamp(this.camera.x,halfW,this.map.width-halfW);
    this.camera.y = halfH*2 >= this.map.height ? this.map.height/2 : clamp(this.camera.y,halfH,this.map.height-halfH);
  }

  render(now = performance.now()) {
    const start = performance.now(), dt = Math.min(.05,(now-this.lastFrame)/1000); this.lastFrame=now;
    if (!this.map) return;
    if (!this.pointerDown && !this.reducedMotion) {
      this.camera.x += this.camera.vx*dt; this.camera.y += this.camera.vy*dt;
      this.camera.vx *= Math.pow(.04,dt); this.camera.vy *= Math.pow(.04,dt); this.clampCamera();
    }
    this.redrawBase();
    const ctx=this.ctx, s=this.camera.scale, origin=this.worldToScreen(0,0);
    ctx.setTransform(this.dpr,0,0,this.dpr,0,0); ctx.imageSmoothingEnabled=false;
    ctx.fillStyle='#071e27'; ctx.fillRect(0,0,this.width,this.height);
    ctx.drawImage(this.base,0,0,this.map.width,this.map.height,Math.round(origin.x),Math.round(origin.y),Math.ceil(this.map.width*s),Math.ceil(this.map.height*s));
    if (this.inGame) this.drawGame(ctx,dt,now);
    else this.drawDemoOverlay(ctx,now);
    this.drawMinimap();
    this.frameCount++;
    if (now-this.fpsAt>=1000) {
      this.fps=Math.round(this.frameCount*1000/(now-this.fpsAt)); this.frameCount=0; this.fpsAt=now;
      if (this.fps<45) this.quality=.45; else if (this.fps>54) this.quality=1;
    }
    this.renderMs=this.renderMs*.9+(performance.now()-start)*.1;
  }

  drawDemoOverlay(ctx,now) {
    ctx.save(); ctx.globalAlpha=.18; ctx.strokeStyle='#84a98e'; ctx.lineWidth=1;
    const pulse=(now/1800)%1, p=this.worldToScreen(133,28), r=10+pulse*45;
    ctx.beginPath(); ctx.arc(Math.round(p.x),Math.round(p.y),r,0,TAU); ctx.stroke();
    ctx.globalAlpha=.5; ctx.fillStyle='#b9ef6b'; ctx.fillRect(Math.round(p.x)-2,Math.round(p.y)-2,4,4); ctx.restore();
  }

  drawGame(ctx,dt,now) {
    const s=this.camera.scale;
    // Subtle geographic labels are part of the canvas, not external assets.
    if (s>3.5) {
      ctx.save(); ctx.font=`${clamp(Math.floor(s*1.1),7,11)}px ${getComputedStyle(document.documentElement).getPropertyValue('--mono')}`; ctx.textAlign='center';
      for (const label of this.map.labels) { const p=this.worldToScreen(label.x,label.y); ctx.fillStyle='rgba(3,18,20,.32)'; ctx.fillText(label.text,p.x,p.y); }
      ctx.restore();
    }
    for (const r of this.map.regions) {
      const state=this.regionState.get(r.id); if (!state) continue;
      const p=this.worldToScreen(r.x,r.y);
      if (p.x < -30 || p.y < -30 || p.x > this.width+30 || p.y > this.height+30) continue;
      const player=state.o!=null?this.players.get(state.o):null;
      if (player?.capitalRegion===r.id && state.o===player.id) this.drawCapital(ctx,p.x,p.y,s,player.color);
      if (state.b?.length && s>1.7) this.drawBuildings(ctx,state,p.x,p.y,s);
      if ((s>12 || this.selected.has(r.id)) && state.t>0) {
        ctx.font=`bold ${clamp(Math.floor(s*.6),8,15)}px monospace`; ctx.textAlign='center'; ctx.fillStyle='#061719'; ctx.fillText(state.t,p.x+1,p.y+4);
        ctx.fillStyle='#eef5df'; ctx.fillText(state.t,p.x,p.y+3);
      }
    }
    const since=(now-this.lastSnapshotAt)/1000;
    for (const w of this.waves) {
      const progress=clamp(1-(w.remaining-since)/w.duration,0,1), x=w.x+(w.tx-w.x)*progress, y=w.y+(w.ty-w.y)*progress;
      const a=this.worldToScreen(w.x,w.y), b=this.worldToScreen(w.tx,w.ty), p=this.worldToScreen(x,y), owner=this.players.get(w.ownerId);
      ctx.save(); ctx.strokeStyle=owner?.color||'#b9ef6b'; ctx.globalAlpha=.45; ctx.lineWidth=Math.max(1,Math.floor(s/4)); ctx.setLineDash([Math.max(2,s),Math.max(2,s)]); ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
      ctx.globalAlpha=1; ctx.fillStyle='#efffde'; const size=clamp(Math.round(s*.5),3,9);ctx.fillRect(Math.round(p.x-size/2),Math.round(p.y-size/2),size,size);
      ctx.strokeStyle=owner?.color||'#b9ef6b';ctx.lineWidth=2;ctx.strokeRect(Math.round(b.x-s),Math.round(b.y-s),Math.round(s*2),Math.round(s*2));ctx.restore();
    }
    for (const p of this.projectiles) {
      const point=this.worldToScreen(p.x,p.y), color=p.kind==='missile'?'#ffb45f':'#76e6e0';ctx.fillStyle=color;
      const size=p.kind==='missile'?5:3;ctx.fillRect(Math.round(point.x-size/2),Math.round(point.y-size/2),size,size);
      if (p.kind==='missile') {ctx.globalAlpha=.45;ctx.fillRect(Math.round(point.x),Math.round(point.y+5),2,8);ctx.globalAlpha=1;}
    }
    this.updateParticles(ctx,dt);
    if (this.buildMode && this.hovered!=null) {
      const r=this.map.regions[this.hovered], state=this.regionState.get(this.hovered), p=this.worldToScreen(r.x,r.y);
      const valid=state?.o===this.clientId && (this.buildMode!=='port'||r.isCoastal);
      ctx.save();ctx.strokeStyle=valid?'#b9ef6b':'#ff8066';ctx.globalAlpha=.6;ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.arc(p.x,p.y,(BALANCE.buildings[this.buildMode].range||2)*s,0,TAU);ctx.stroke();ctx.restore();
    }
  }

  drawCapital(ctx,x,y,s,color) {
    const z=clamp(Math.floor(s*.75),4,10);ctx.fillStyle='#07191b';ctx.fillRect(Math.round(x-z/2-1),Math.round(y-z/2-1),z+2,z+2);ctx.fillStyle=color;
    ctx.fillRect(Math.round(x-z/2),Math.round(y-z/2),z,z);ctx.fillStyle='#eff7dc';ctx.fillRect(Math.round(x-1),Math.round(y-z/2),2,z);ctx.fillRect(Math.round(x-z/2),Math.round(y-1),z,2);
  }
  drawBuildings(ctx,state,x,y,s) {
    const max=Math.min(3,state.b.length), size=clamp(Math.round(s*.9),6,13);
    for(let i=0;i<max;i++) {
      const b=state.b[i], ox=(i-(max-1)/2)*(size+2), px=Math.round(x+ox-size/2), py=Math.round(y-size*1.5);
      ctx.fillStyle='rgba(4,17,19,.88)';ctx.fillRect(px-1,py-1,size+2,size+2);ctx.fillStyle=buildingColor(b.t);drawBuildingPixels(ctx,b.t,px,py,size);
      if(s>5){ctx.font=`bold ${Math.max(6,Math.floor(size*.55))}px monospace`;ctx.textAlign='right';ctx.fillStyle='#efffde';ctx.fillText(b.l,px+size+4,py+size);}
    }
  }
  drawMinimap() {
    if(!this.map||!this.minimap)return;const ctx=this.miniCtx,w=this.minimap.width,h=this.minimap.height;ctx.imageSmoothingEnabled=false;ctx.drawImage(this.base,0,0,w,h);
    const viewW=this.width/this.camera.scale/this.map.width*w,viewH=this.height/this.camera.scale/this.map.height*h;
    const x=(this.camera.x/this.map.width)*w-viewW/2,y=(this.camera.y/this.map.height)*h-viewH/2;
    ctx.strokeStyle='#d7ff94';ctx.lineWidth=1;ctx.strokeRect(clamp(x,0,w-2),clamp(y,0,h-2),clamp(viewW,3,w),clamp(viewH,3,h));
  }

  spawnEvent(event) {
    if(this.reducedMotion)return;const r=this.map.regions[event.regionId];if(!r)return;
    const owner=this.players.get(event.ownerId),capturing=event.type==='CAPTURE',explosion=event.type.includes('EXPLOSION')||event.type.includes('HIT');
    const count=Math.floor((capturing?12:explosion?22:5)*this.quality);if(!count)return;
    for(let i=0;i<count&&this.particles.length<160;i++) {
      const angle=this.spawnAngle=(this.spawnAngle||0)+2.39996,speed=(explosion?5:2)+(i%4);
      this.particles.push({x:r.x,y:r.y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life:.35+(i%5)*.07,max:.7,color:explosion?'#ffb45f':owner?.color||'#b9ef6b',size:explosion?2:1});
    }
    if(capturing)this.floaters.push({x:r.x,y:r.y,text:`+${event.troops||0}`,life:1,color:owner?.color||'#b9ef6b'});
  }
  updateParticles(ctx,dt) {
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.life-=dt;if(p.life<=0){this.particles.splice(i,1);continue;}p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.93;p.vy*=.93;const s=this.worldToScreen(p.x,p.y);ctx.globalAlpha=clamp(p.life*2,0,1);ctx.fillStyle=p.color;const z=Math.max(2,Math.round(this.camera.scale*.25*p.size));ctx.fillRect(Math.round(s.x),Math.round(s.y),z,z);}ctx.globalAlpha=1;
    for(let i=this.floaters.length-1;i>=0;i--){const f=this.floaters[i];f.life-=dt;if(f.life<=0){this.floaters.splice(i,1);continue;}f.y-=dt*2;const p=this.worldToScreen(f.x,f.y);ctx.globalAlpha=f.life;ctx.font='bold 11px monospace';ctx.textAlign='center';ctx.fillStyle=f.color;ctx.fillText(f.text,p.x,p.y-12);}ctx.globalAlpha=1;
  }
}

function buildingColor(type){return {house:'#b9ef6b',port:'#64cbe0',fort:'#d6d8bd',drone:'#72e4bd',missile:'#ffb45f',aa:'#e7a6ff'}[type]||'#fff';}
function drawBuildingPixels(ctx,type,x,y,s){
  const u=Math.max(1,Math.floor(s/5));
  if(type==='house'){ctx.fillRect(x+u,y+u*2,s-u*2,s-u*2);ctx.fillStyle='#0b2324';ctx.fillRect(x+s/2-u/2,y+s-u*2,u,u*2);ctx.fillRect(x+u*2,y+u*3,u,u);}
  else if(type==='port'){ctx.fillRect(x+s/2-u/2,y+u,u,s-u*2);ctx.fillRect(x+u,y+u*2,s-u*2,u);ctx.fillRect(x+u,y+s-u*2,u,u);ctx.fillRect(x+s-u*2,y+s-u*2,u,u);ctx.fillRect(x+u*2,y+s-u,s-u*4,u);}
  else if(type==='fort'){ctx.fillRect(x+u,y+u*2,s-u*2,s-u*2);ctx.fillRect(x,y+u,s,u*2);ctx.fillStyle='#0b2324';ctx.fillRect(x+s/2-u,y+s-u*3,u*2,u*3);}
  else if(type==='drone'){ctx.fillRect(x+u*2,y+u*2,s-u*4,s-u*4);ctx.fillRect(x,y+u,s-u*2,u);ctx.fillRect(x+s-u,y+u,s-u*2,u);ctx.fillRect(x+s/2-u/2,y+s-u,u,u);}
  else if(type==='missile'){ctx.fillRect(x+s/2-u,y,s>8?u*2:u,s-u*2);ctx.fillRect(x+u,y+s-u*3,s-u*2,u*2);ctx.fillStyle='#0b2324';ctx.fillRect(x+s/2,y+u,u,u);}
  else {ctx.fillRect(x+u,y+s-u*2,s-u*2,u*2);ctx.fillRect(x+s/2-u/2,y+u*2,u,s-u*4);ctx.fillRect(x+s/2,y+u,s/2-u,u);ctx.fillRect(x+s/2-u*2,y+u,u*2,u);}
}
