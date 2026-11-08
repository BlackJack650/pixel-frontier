import { BALANCE, GAME_DEFAULTS } from '/config/balance.js';
import { buildingCost } from '/shared/formulas.js';
import { MESSAGE } from '/shared/protocol.js';
import { WorldRenderer } from './render/renderer.js';
import { Network } from './net/network.js';
import { AudioEngine } from './audio/audioEngine.js';
import { icon } from './ui/icons.js';

const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];
const renderer = new WorldRenderer($('world'), $('minimap'));
const network = new Network();
const audio = new AudioEngine();
const maps = new Map();
const state = {
  screen: 'menu', mapSize: 'standard', gameActive: false, gameMapReady: false, entering: null,
  snapshot: null, room: null, selected: new Set(), inspected: null, attackPercent: 50, buildMode: null,
  settings: { ...GAME_DEFAULTS }, leaderboardExpanded: false, lastSnapAt: 0, resultShown: false
};
const BUILDINGS = [
  { type: 'house', name: 'HABITAT', key: 'H', range: 'CAP +350' },
  { type: 'port', name: 'PORT', key: 'P', range: 'RANGE 6' },
  { type: 'fort', name: 'BASTION', key: 'F', range: 'DEF +10%' },
  { type: 'drone', name: 'FPV DRONE', key: 'D', range: 'RANGE 5' },
  { type: 'missile', name: 'MISSILE', key: 'M', range: 'RANGE 12' },
  { type: 'aa', name: 'AA ARRAY', key: 'A', range: 'RANGE 6' }
];
const tutorialSteps = [
  ['Claim your first sector','Click one of your bright border sectors, then click an adjacent neutral sector. Your attack wave must arrive before the capture resolves.'],
  ['Control your commitment','The attack slider sends 0–100% of the selected garrisons. Use 10–25% for neutral land and concentrate force against rivals.'],
  ['Build upward','Choose a structure below, then click your land. Select the same structure and sector again to upgrade it — up to level 5.'],
  ['Watch the whole world','Drag to pan, wheel or pinch to zoom, and click the minimap to jump. Ports can cross short blue straits.'],
  ['Secure 25%','Habitats raise troop cap. Bastions slow attacks. Drones and missiles wear down infrastructure; AA arrays intercept them.']
];
let tutorialIndex = 0;

function injectIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => { if (!el.querySelector('svg')) el.innerHTML = icon(el.dataset.icon); });
}
injectIcons();
for (const b of BUILDINGS) {
  const button = document.createElement('button');
  button.className = 'build-button'; button.dataset.building = b.type; button.title = `${b.name} — ${b.range}`;
  button.innerHTML = `<span class="build-key">${b.key}</span>${icon(b.type)}<span class="build-name">${b.name}</span><span class="build-range">${b.range}</span><span class="build-cost">${BALANCE.buildings[b.type].baseCost}</span>`;
  button.addEventListener('click', () => { audio.unlock(); audio.click(); state.buildMode = state.buildMode === b.type ? null : b.type; renderer.setBuildMode(state.buildMode); updateBuildButtons(); if (state.buildMode) toast(`${b.name}: click one of your sectors to build or upgrade.`); });
  $('buildButtons').append(button);
}

async function loadMap(size = 'standard') {
  if (maps.has(size)) return maps.get(size);
  const response = await fetch(size === 'large' ? '/shared/map/map-large.json' : '/shared/map/map.json');
  if (!response.ok) throw new Error('Map download failed');
  const map = await response.json(); maps.set(size, map); return map;
}
async function boot() {
  try { const map = await loadMap('standard'); renderer.setMap(map); renderer.makeDemo(); }
  catch { toast('Could not load the world map. Reload to retry.', true); }
  requestAnimationFrame(frame);
}
boot();

function frame(now) {
  if (!document.hidden) {
    updateCameraKeys(now);
    renderer.render(now);
    if (state.gameActive && !$('fpsCounter').classList.contains('hidden')) $('fpsCounter').innerHTML = `${renderer.fps} FPS · ${network.ping} MS<br><small>${renderer.renderMs.toFixed(1)} MS RENDER</small>`;
  }
  requestAnimationFrame(frame);
}

function showScreen(name) {
  state.screen = name;
  for (const id of ['menuScreen','soloScreen','multiplayerScreen','lobbyScreen']) $(id).classList.add('hidden');
  $('gameUI').classList.toggle('hidden', name !== 'game');
  $('menuBar').classList.toggle('hidden', name === 'game');
  document.body.classList.toggle('in-game', name === 'game');
  if (name !== 'game') $(`${name}Screen`)?.classList.remove('hidden');
}
async function goMenu() {
  state.gameActive = false; state.gameMapReady = false; state.snapshot = null; state.room = null; state.resultShown = false;
  $('resultModal').classList.add('hidden'); $('countdown').classList.add('hidden'); $('connectionBanner').classList.add('hidden');
  network.leave(); showScreen('menu'); renderer.inGame = false;
  const map = await loadMap('standard'); state.mapSize = 'standard'; renderer.setMap(map); renderer.makeDemo();
}

async function ensureGameMap(size) {
  if (state.gameMapReady && state.mapSize === size) return;
  if (state.entering) return state.entering;
  state.entering = (async () => {
    const map = await loadMap(size); renderer.setMap(map); state.mapSize = size; state.gameMapReady = true; state.entering = null;
    renderer.inGame = true; renderer.fit(); renderer.dirty = true;
  })();
  return state.entering;
}
async function enterGame(size = 'standard') {
  state.gameActive = true; state.resultShown = false; showScreen('game'); $('resultModal').classList.add('hidden');
  await ensureGameMap(size); renderer.fit();
}

function toast(message, error = false, duration = 2800) {
  const el = document.createElement('div'); el.className = `toast${error ? ' error' : ''}`; el.textContent = message;
  $('toastStack').append(el); setTimeout(() => el.remove(), duration);
}
function format(value) { const n=Math.floor(value||0);return n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e4?`${(n/1e3).toFixed(1)}K`:String(n); }
function time(seconds) { const s=Math.max(0,Math.floor(seconds||0));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function me() { return state.snapshot?.players.find(p => p.id === network.clientId); }

// Menu, settings and match creation.
document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action) {
    audio.unlock(); audio.click();
    if (action === 'solo') showScreen('solo');
    else if (action === 'multiplayer') { if (state.gameActive || network.code) network.leave(); state.gameActive=false;showScreen('multiplayer');refreshRooms(); }
    else if (action === 'menu') goMenu();
    else if (action === 'settings') $('settingsModal').classList.remove('hidden');
    else if (action === 'help') $('helpModal').classList.remove('hidden');
    else if (action === 'audio') { audio.toggleMute(); updateAudioButton(); }
  }
  const close = event.target.closest('[data-close]')?.dataset.close;
  if (close) $(close).classList.add('hidden');
});
function updateAudioButton() { $$('[data-action="audio"]').forEach(b=>b.innerHTML=icon(audio.muted?'mute':'volume')); }
updateAudioButton();

$$('.segmented').forEach(group => group.addEventListener('click', event => {
  const button=event.target.closest('button');if(!button)return;audio.click();group.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===button));
  const key=group.dataset.setting;let value=button.dataset.value;if(!['difficulty','mapSize'].includes(key))value=Number(value);state.settings[key]=value;
}));
$('botCount').addEventListener('input', e => { state.settings.botCount=Number(e.target.value);$('botCountOut').value=e.target.value; });
$('troopMultiplier').addEventListener('input', e => { state.settings.troopMultiplier=Number(e.target.value);$('troopMultOut').value=`${Number(e.target.value)*100}%`; });
$('economyMultiplier').addEventListener('input', e => { state.settings.economyMultiplier=Number(e.target.value);$('economyMultOut').value=`${Number(e.target.value)*100}%`; });
$('randomSeed').addEventListener('click',()=>{$('seedInput').value=Math.floor(Math.random()*999999);});
$('startSolo').addEventListener('click',()=>{
  if(!network.connected)return toast('Tactical network is still connecting…',true);
  audio.unlock();state.settings.seed=Number($('seedInput').value)||42042;
  network.hello('createSolo',{name:$('playerName').value,settings:{...state.settings}});$('startSolo').disabled=true;$('startSolo').querySelector('span').textContent='GENERATING WORLD…';
});
$('createMulti').addEventListener('click',()=>{
  if(!network.connected)return toast('Tactical network is still connecting…',true);
  network.hello('createMultiplayer',{name:$('multiName').value,settings:{...state.settings,difficulty:$('lobbyDifficulty').value}});
});
$('joinMulti').addEventListener('click',joinByCode);
$('joinCode').addEventListener('keydown',e=>{if(e.key==='Enter')joinByCode();});
function joinByCode(){if(!network.connected)return toast('Tactical network is still connecting…',true);const code=$('joinCode').value.trim().toUpperCase();if(code.length!==6)return toast('Enter the 6-character room code.',true);network.hello('join',{name:$('multiName').value,code});}
$('refreshRooms').addEventListener('click',refreshRooms);
async function refreshRooms(){
  $('roomList').innerHTML='<div class="empty-state">Scanning the network…</div>';
  try{const {rooms}=await fetch('/api/rooms').then(r=>r.json());$('roomList').innerHTML=rooms.length?rooms.map(r=>`<div class="room-row"><b>${r.code}</b><small>${r.players} PLAYERS · ${r.bots} AI<br>${r.mapSize.toUpperCase()} / ${r.difficulty}</small><button data-room="${r.code}">JOIN</button></div>`).join(''):'<div class="empty-state">No open rooms. Create the first war room.</div>';
    $('roomList').querySelectorAll('[data-room]').forEach(b=>b.addEventListener('click',()=>{$('joinCode').value=b.dataset.room;joinByCode();}));
  }catch{$('roomList').innerHTML='<div class="empty-state">Network scan failed. Try again.</div>';}
}

// Lobby.
$('copyCode').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(network.code);toast('Room code copied.');}catch{toast(`Room code: ${network.code}`);}});
$('addBot').addEventListener('click',()=>network.command('ADD_BOT',{difficulty:$('lobbyDifficulty').value}));
$('startMatch').addEventListener('click',()=>network.command('START_MATCH'));
$('lobbyDifficulty').addEventListener('change',e=>{if(state.room?.hostId===network.clientId)network.command('UPDATE_SETTINGS',{difficulty:e.target.value});});
function renderLobby(room){
  state.room=room;$('lobbyCode').textContent=room.code;$('slotCount').textContent=`${room.players.length} / ${BALANCE.maxPlayers}`;
  $('lobbyPlayers').innerHTML=room.players.map((p,i)=>`<div class="lobby-player"><i class="player-swatch" style="background:${p.color}"></i><div><b>${escapeHtml(p.name)}${p.id===network.clientId?' (YOU)':''}</b><small>${p.isBot?`AI · LEVEL ${p.difficulty}`:p.connected?'HUMAN · ONLINE':'HUMAN · RECONNECTING'}</small></div><span>${p.id===room.hostId?'HOST':String(i+1).padStart(2,'0')}</span></div>`).join('');
  const host=room.hostId===network.clientId;$('addBot').disabled=!host||room.players.length>=BALANCE.maxPlayers;$('startMatch').disabled=!host;$('lobbyDifficulty').disabled=!host;
}
function escapeHtml(text){const div=document.createElement('div');div.textContent=String(text??'');return div.innerHTML;}

// Network messages and snapshot flow.
network.addEventListener('status',({detail})=>{
  $('netStatus').className=`status-pill ${detail.connected?'online':'offline'}`;$('netStatus').innerHTML=`<i></i> ${detail.connected?'NETWORK ONLINE':'NETWORK OFFLINE'}`;
  $('connectionBanner').classList.toggle('hidden',detail.connected||!state.gameActive);
});
network.addEventListener('message',async({detail:data})=>{
  switch(data.t){
    case MESSAGE.WELCOME:
      if(state.room)renderLobby(state.room);if(data.resumed){toast('Command link restored.');state.gameActive=true;}
      break;
    case MESSAGE.LOBBY:
      state.room=data.room;
      if(data.room.phase==='lobby'&&data.room.mode==='multiplayer'){showScreen('lobby');renderLobby(data.room);}
      if(state.snapshot){state.snapshot.paused=data.room.paused;updateHUD();}
      break;
    case MESSAGE.START:
      $('startSolo').disabled=false;$('startSolo').querySelector('span').textContent='INITIALIZE CAMPAIGN';state.gameMapReady=false;state.selected.clear();renderer.setSelection([]);
      await enterGame(data.mapSize);$('countdown').classList.remove('hidden');break;
    case MESSAGE.FULL:
    case MESSAGE.SNAP:
      await handleSnapshot(data.snapshot);break;
    case MESSAGE.ERR:
      if(data.code==='RESUME_FAILED'){network.shouldResume=false;network.clearSession();await goMenu();toast('Previous session expired. Start a new campaign.',true);}
      else{toast(data.message||data.code,true);audio.error();if(['JOIN_FAILED','ROOM_NOT_FOUND','BAD_CODE','MATCH_ACTIVE','ROOM_FULL'].includes(data.code))showScreen('multiplayer');}
      break;
    case MESSAGE.CHAT:addChat(data);break;
    case MESSAGE.RESULT:showResult(data.result);break;
    case MESSAGE.SERVER_SHUTDOWN:toast(data.message,true,6000);break;
  }
});
async function handleSnapshot(snapshot){
  await ensureGameMap(snapshot.settings.mapSize);if(!state.gameActive){state.gameActive=true;showScreen('game');}
  state.snapshot=snapshot;state.lastSnapAt=performance.now();renderer.setSnapshot(snapshot,network.clientId);
  for(const r of snapshot.regions){if(state.selected.has(r.i)&&r.o!==network.clientId)state.selected.delete(r.i);}
  renderer.setSelection(state.selected);
  if(snapshot.events?.length)for(const event of snapshot.events){const region=renderer.map.regions[event.regionId];audio.event(event,region,renderer.camera,network.clientId);handleGameEvent(event);}
  updateHUD();
  if(snapshot.phase==='playing')$('countdown').classList.add('hidden');
  else if(snapshot.phase==='countdown'){$('countdown').classList.remove('hidden');$('countdown').querySelector('b').textContent=Math.max(1,Math.ceil(snapshot.countdown));}
  if(snapshot.phase==='playing'&&!localStorage.getItem('pf-tutorial')&&!state.tutorialStarted){state.tutorialStarted=true;setTimeout(()=>showTutorial(0),600);}
}
function handleGameEvent(event){
  const own=event.ownerId===network.clientId,lost=event.previousOwnerId===network.clientId||event.defenderId===network.clientId;
  if(event.type==='MATCH_BEGIN'){toast(event.message);feed(event.message);}
  else if(event.type==='CAPTURE'&&(own||lost))feed(`<b>${own?'SECTOR SECURED':'SECTOR LOST'}</b> · #${String(event.regionId).padStart(3,'0')}${event.troops?` · ${event.troops} troops`:''}`,lost);
  else if(event.type==='BUILD'&&own)feed(`<b>${event.buildingType.toUpperCase()}</b> ONLINE · SECTOR ${event.regionId}`);
  else if(event.type==='UPGRADE'&&own)feed(`<b>${event.buildingType.toUpperCase()}</b> UPGRADED TO LEVEL ${event.level}`);
  else if(event.type==='BUILDING_CAPTURE'&&own)feed(`<b>${event.buildingType.toUpperCase()}</b> CAPTURED · ${event.outcome.toUpperCase()}`);
  else if(event.type==='BUILDING_DESTROYED'&&(own||lost))feed(`<b>INFRASTRUCTURE DESTROYED</b> · SECTOR ${event.regionId}`,true);
  else if(event.type==='PEACE_TIME')toast(event.message);
}
function feed(html,hostile=false){const el=document.createElement('div');el.className=`feed-item${hostile?' hostile':''}`;el.innerHTML=html;$('eventFeed').prepend(el);while($('eventFeed').children.length>5)$('eventFeed').lastChild.remove();setTimeout(()=>el.remove(),6500);}

function updateHUD(){
  const s=state.snapshot,p=me();if(!s||!p)return;
  $('nationName').textContent=p.name;$('nationColor').style.background=p.color;
  $('troopsValue').textContent=format(p.troops);$('capValue').textContent=format(p.cap);$('growthValue').textContent=`+${p.growth}/s`;
  $('economyValue').textContent=format(p.economy);$('incomeValue').textContent=`+${p.income}/s`;$('regionsValue').textContent=p.regions;$('regionsTotal').textContent=renderer.map.regions.length;
  $('controlPercent').textContent=`${(p.regions/renderer.map.regions.length*100).toFixed(1)}% WORLD`;$('matchTimer').textContent=time(s.gameTime);
  $('phaseLabel').textContent=s.paused?'SIMULATION PAUSED':s.peaceLeft>0?`PEACE · ${Math.ceil(s.peaceLeft)}S`:state.room?.mode==='multiplayer'?'ONLINE WAR ROOM':'WORLD CONQUEST';
  $('pauseButton').classList.toggle('hidden',state.room?.mode==='multiplayer');$('chatToggle').classList.toggle('hidden',state.room?.mode!=='multiplayer');
  const sorted=[...s.players].sort((a,b)=>b.regions-a.regions||b.troops-a.troops);
  $('leaderRows').innerHTML=sorted.map((r,i)=>`<div class="leader-row${r.id===network.clientId?' me':''}"><span class="rank">${String(i+1).padStart(2,'0')}</span><i class="swatch" style="background:${r.color}"></i><span class="name">${escapeHtml(r.name)}<small class="leader-troops">${format(r.troops)} TROOPS${r.isBot?` · AI ${r.difficulty}`:''}</small></span><b>${r.regions}</b></div>`).join('');
  $('autoExpand').classList.toggle('active',p.autoExpand);updateBuildButtons();updateInspector();
}
function updateBuildButtons(){
  const p=me(),regionId=state.inspected??[...state.selected][0],region=renderer.regionState.get(regionId);
  $$('.build-button').forEach(button=>{const type=button.dataset.building,existing=region?.b?.find(b=>b.t===type),cost=p?buildingCost(type,p.buildings,existing?.l||0):BALANCE.buildings[type].baseCost;
    button.querySelector('.build-cost').textContent=existing?.l>=5?'MAX':cost;button.classList.toggle('active',state.buildMode===type);button.classList.toggle('unaffordable',!!p&&p.economy<cost);button.title=existing?`${type.toUpperCase()} LEVEL ${existing.l} → ${Math.min(5,existing.l+1)} · ${cost} credits`:`${type.toUpperCase()} · ${cost} credits`;});
}
function updateInspector(){
  const id=state.inspected;if(id==null||!renderer.map){$('regionInspector').classList.add('hidden');return;}const r=renderer.map.regions[id],s=renderer.regionState.get(id);if(!r||!s)return;
  $('regionInspector').classList.remove('hidden');$('inspectName').textContent=`SECTOR ${String(id).padStart(3,'0')}${r.isCoastal?' / COAST':''}`;
  const owner=s.o!=null?state.snapshot?.players.find(p=>p.id===s.o):null;$('inspectOwner').textContent=owner?.name||'NEUTRAL';$('inspectOwner').style.color=owner?.color||'#8da49a';$('inspectTroops').textContent=format(s.t);$('inspectArea').textContent=r.area;
  $('inspectBuildings').innerHTML=s.b?.length?s.b.map(b=>`<span class="inspect-building">${b.t.toUpperCase()} <i>L${b.l}</i> · ${b.h}/${b.m}</span>`).join(''):'<span class="inspect-building">NO INFRASTRUCTURE</span>';
  $('inspectHint').textContent=s.o===network.clientId?(state.buildMode?`Click to ${s.b?.some(b=>b.t===state.buildMode)?'upgrade':'build'} ${state.buildMode}.`:'Your sector. Add to selection with Shift, or choose infrastructure below.'):state.selected.size?'Hostile sector. Click again to launch with selected sources.':'Select one or more of your sectors to attack.';
}
$('closeInspector').addEventListener('click',()=>{state.inspected=null;updateInspector();});

// Attack controls.
function setAttackPercent(value,send=true){state.attackPercent=Math.max(0,Math.min(100,Number(value)));$('attackPercent').value=state.attackPercent;$('attackPercentOut').value=state.attackPercent;$$('[data-percent]').forEach(b=>b.classList.toggle('active',Number(b.dataset.percent)===state.attackPercent));if(send&&state.gameActive)network.command('SET_ATTACK_PERCENT',{percent:state.attackPercent});}
$('attackPercent').addEventListener('input',e=>setAttackPercent(e.target.value,false));$('attackPercent').addEventListener('change',e=>setAttackPercent(e.target.value,true));
$$('[data-percent]').forEach(b=>b.addEventListener('click',()=>{audio.click();setAttackPercent(b.dataset.percent);}));
$('autoExpand').addEventListener('click',()=>{const next=!me()?.autoExpand;network.command('SET_AUTO_EXPAND',{value:next});$('autoExpand').classList.toggle('active',next);});
$('pauseButton').addEventListener('click',()=>{if(state.snapshot)network.command('PAUSE',{value:!state.snapshot.paused});});
$('rematchButton').addEventListener('click',()=>{if(state.room?.hostId!==network.clientId)return toast('Only the host can initialize a rematch.',true);network.command('REMATCH');$('resultModal').classList.add('hidden');state.resultShown=false;state.gameMapReady=false;});

function showResult(result){
  if(state.resultShown)return;state.resultShown=true;const standing=result.standings.find(p=>p.id===network.clientId),won=result.winnerId===network.clientId;
  $('resultKicker').textContent=won?'CAMPAIGN VICTORY':'CAMPAIGN COMPLETE';$('resultTitle').textContent=won?'World secured.':'The front has fallen.';$('resultSubtitle').textContent=won?'Your nation controls the Meridian theater.':`${result.standings.find(p=>p.id===result.winnerId)?.name||'A rival'} dominates this timeline.`;
  $('resultStats').innerHTML=`<div><small>YOUR PLACE</small><b>#${standing?.place||'—'}</b></div><div><small>SECTORS</small><b>${standing?.regions||0}</b></div><div><small>CAMPAIGN TIME</small><b>${time(result.duration)}</b></div>`;
  $('resultStandings').innerHTML=result.standings.slice(0,8).map(p=>`<div class="result-standing"><span>#${p.place}</span><i style="background:${p.color}"></i><span>${escapeHtml(p.name)}</span><b>${p.regions} SECTORS</b></div>`).join('');
  $('rematchButton').disabled=state.room?.hostId!==network.clientId;$('resultModal').classList.remove('hidden');audio.victory(won);
}

// Canvas interaction: mouse, touch, pinch, box selection and minimap.
const pointers=new Map();let gesture=null,pinch=null,longPressTimer=null,lastTap={at:0,x:0,y:0};
const selectionBox=document.createElement('div');selectionBox.style.cssText='position:fixed;display:none;pointer-events:none;border:1px solid #b9ef6b;background:rgba(185,239,107,.09);z-index:15';document.body.append(selectionBox);
$('world').addEventListener('contextmenu',e=>{e.preventDefault();state.buildMode=null;renderer.setBuildMode(null);state.selected.clear();renderer.setSelection(state.selected);updateBuildButtons();});
$('world').addEventListener('wheel',e=>{if(!state.gameActive)return;e.preventDefault();renderer.zoom(e.deltaY<0?1.12:1/1.12,e.clientX,e.clientY);updateZoomBadge();},{passive:false});
$('world').addEventListener('pointerdown',e=>{
  if(!state.gameActive||e.button===2)return;audio.unlock();$('world').setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});renderer.pointerDown=true;renderer.camera.vx=renderer.camera.vy=0;
  if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y)};gesture=null;clearTimeout(longPressTimer);return;}
  gesture={id:e.pointerId,startX:e.clientX,startY:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false,shift:e.shiftKey,pointerType:e.pointerType};pinch=null;
  if(e.pointerType==='touch')longPressTimer=setTimeout(()=>{if(gesture&&!gesture.moved){selectAllBorders();gesture.long=true;navigator.vibrate?.(25);}},560);
});
$('world').addEventListener('pointermove',e=>{
  if(!state.gameActive)return;const world=renderer.screenToWorld(e.clientX,e.clientY);$('mapCoords').textContent=`X:${String(Math.max(0,Math.floor(world.x))).padStart(3,'0')} Y:${String(Math.max(0,Math.floor(world.y))).padStart(2,'0')}`;
  const hovered=renderer.pick(e.clientX,e.clientY);renderer.setHovered(hovered);if(hovered!=null)state.inspected=hovered;updateInspector();
  if(pointers.has(e.pointerId))pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===2&&pinch){const[a,b]=[...pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(pinch.distance>0)renderer.zoom(distance/pinch.distance,(a.x+b.x)/2,(a.y+b.y)/2);pinch.distance=distance;updateZoomBadge();return;}
  if(!gesture||gesture.id!==e.pointerId)return;const dx=e.clientX-gesture.lastX,dy=e.clientY-gesture.lastY,total=Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY);
  if(total>5){gesture.moved=true;clearTimeout(longPressTimer);}if(!gesture.moved)return;
  if(gesture.shift){const x=Math.min(gesture.startX,e.clientX),y=Math.min(gesture.startY,e.clientY);selectionBox.style.display='block';selectionBox.style.left=`${x}px`;selectionBox.style.top=`${y}px`;selectionBox.style.width=`${Math.abs(e.clientX-gesture.startX)}px`;selectionBox.style.height=`${Math.abs(e.clientY-gesture.startY)}px`;}
  else renderer.panBy(dx,dy);gesture.lastX=e.clientX;gesture.lastY=e.clientY;
});
function pointerEnd(e){
  clearTimeout(longPressTimer);pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;if(!pointers.size)renderer.pointerDown=false;
  if(!gesture||gesture.id!==e.pointerId)return;const g=gesture;gesture=null;selectionBox.style.display='none';
  if(g.long)return;if(g.shift&&g.moved){boxSelect(g.startX,g.startY,e.clientX,e.clientY);return;}if(g.moved)return;
  const now=performance.now(),double=g.pointerType==='touch'&&now-lastTap.at<330&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<28;lastTap={at:now,x:e.clientX,y:e.clientY};handleMapClick(e.clientX,e.clientY,{shift:g.shift,double});
}
$('world').addEventListener('pointerup',pointerEnd);$('world').addEventListener('pointercancel',e=>{clearTimeout(longPressTimer);pointers.delete(e.pointerId);gesture=null;renderer.pointerDown=false;selectionBox.style.display='none';});
$('world').addEventListener('dblclick',e=>{if(!state.gameActive)return;e.preventDefault();const id=renderer.pick(e.clientX,e.clientY);if(id==null)return;const r=renderer.regionState.get(id);if(r?.o===network.clientId)selectAllBorders();else launchAttack(id);});
function handleMapClick(x,y,{shift=false,double=false}={}){
  const id=renderer.pick(x,y);if(id==null)return;state.inspected=id;const region=renderer.regionState.get(id),staticRegion=renderer.map.regions[id];if(!region)return;
  if(state.buildMode){if(region.o!==network.clientId){toast('Build inside your own territory.',true);audio.error();return;}const existing=region.b?.some(b=>b.t===state.buildMode);network.command(existing?'UPGRADE':'BUILD',{regionId:id,buildingType:state.buildMode});updateInspector();return;}
  if(region.o===network.clientId){if(double){selectAllBorders();return;}if(shift){if(state.selected.has(id))state.selected.delete(id);else state.selected.add(id);}else state.selected=new Set([id]);renderer.setSelection(state.selected);audio.click();}
  else if(double)launchAttack(id);else if(state.selected.size)launchAttack(id);else toast('Select your source sector first, then a target.');
  updateInspector();updateBuildButtons();if(staticRegion)renderer.setHovered(id);
}
function validSources(targetId){const target=renderer.map.regions[targetId];return[...state.selected].filter(id=>{const r=renderer.map.regions[id],s=renderer.regionState.get(id);if(!r||s?.o!==network.clientId)return false;if(r.neighbors.includes(targetId))return true;const port=s.b?.some(b=>b.t==='port');return port&&r.isCoastal&&target.isCoastal&&r.seaNeighbors.includes(targetId);});}
function launchAttack(targetId){if(!state.selected.size)return toast('Select at least one of your sectors first.',true);if(state.attackPercent<=0){toast('Choose an attack force above 0%.',true);audio.error();return;}const sources=validSources(targetId);if(!sources.length){toast('No selected sector can reach this target. Use a border or port.',true);audio.error();return;}network.command('ATTACK',{fromRegions:sources,toRegionId:targetId,percent:state.attackPercent});}
function selectAllBorders(){if(!state.snapshot)return;state.selected.clear();for(const r of renderer.map.regions){const s=renderer.regionState.get(r.id);if(s?.o===network.clientId&&r.neighbors.some(n=>renderer.regionState.get(n)?.o!==network.clientId))state.selected.add(r.id);}renderer.setSelection(state.selected);toast(`${state.selected.size} border sectors selected.`);}
function boxSelect(x1,y1,x2,y2){const minX=Math.min(x1,x2),maxX=Math.max(x1,x2),minY=Math.min(y1,y2),maxY=Math.max(y1,y2);state.selected.clear();for(const r of renderer.map.regions){const s=renderer.regionState.get(r.id);if(s?.o!==network.clientId)continue;const p=renderer.worldToScreen(r.x,r.y);if(p.x>=minX&&p.x<=maxX&&p.y>=minY&&p.y<=maxY)state.selected.add(r.id);}renderer.setSelection(state.selected);toast(`${state.selected.size} sectors selected.`);}
$('minimap').addEventListener('pointerdown',e=>{if(!state.gameActive)return;const rect=$('minimap').getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*renderer.map.width,y=(e.clientY-rect.top)/rect.height*renderer.map.height;renderer.centerOn(x,y);});
function updateZoomBadge(){$('zoomBadge').textContent=`${(renderer.camera.scale/renderer.fitScale).toFixed(1)}×`;}
$('zoomIn').addEventListener('click',()=>{renderer.zoom(1.25);updateZoomBadge();});$('zoomOut').addEventListener('click',()=>{renderer.zoom(.8);updateZoomBadge();});$('fitMap').addEventListener('click',()=>{renderer.fit();updateZoomBadge();});

// Keyboard and accessibility.
const keys=new Set();let lastKeyFrame=performance.now();
addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
  if(e.key==='F3'){e.preventDefault();$('showFps').checked=!$('showFps').checked;$('fpsCounter').classList.toggle('hidden',!$('showFps').checked);return;}
  if(e.key==='Escape'){$$('.modal').forEach(m=>m.classList.add('hidden'));state.buildMode=null;renderer.setBuildMode(null);updateBuildButtons();return;}
  if(!state.gameActive)return;keys.add(e.key.toLowerCase());
  if(e.code==='Space'){e.preventDefault();if(state.room?.mode==='solo'&&state.snapshot)network.command('PAUSE',{value:!state.snapshot.paused});}
  if(/^[1-5]$/.test(e.key))setAttackPercent(Number(e.key)*20);
  if(e.key.toLowerCase()==='b'){state.buildMode=state.buildMode?null:'house';renderer.setBuildMode(state.buildMode);updateBuildButtons();}
  if(e.key==='Tab'){e.preventDefault();state.leaderboardExpanded=!state.leaderboardExpanded;$('leaderboard').classList.toggle('expanded',state.leaderboardExpanded);}
  const building=BUILDINGS.find(b=>b.key.toLowerCase()===e.key.toLowerCase());if(building&&!['b'].includes(e.key.toLowerCase())&&e.altKey){state.buildMode=building.type;renderer.setBuildMode(building.type);updateBuildButtons();}
});
addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
function updateCameraKeys(now){const dt=Math.min(.05,(now-lastKeyFrame)/1000);lastKeyFrame=now;if(!state.gameActive)return;let dx=0,dy=0;if(keys.has('a')||keys.has('arrowleft'))dx-=1;if(keys.has('d')||keys.has('arrowright'))dx+=1;if(keys.has('w')||keys.has('arrowup'))dy-=1;if(keys.has('s')||keys.has('arrowdown'))dy+=1;if(dx||dy){renderer.camera.x+=dx*35*dt;renderer.camera.y+=dy*35*dt;renderer.clampCamera();}if(keys.has('q'))renderer.zoom(Math.pow(.5,dt));if(keys.has('e'))renderer.zoom(Math.pow(2,dt));}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.gameActive&&state.room?.mode==='solo'&&state.snapshot&&!state.snapshot.paused)network.command('PAUSE',{value:true});});

// Audio and display preferences.
for(const kind of ['master','sfx','music']){const input=$(`${kind}Volume`),out=$(`${kind}Out`);input.value=audio[kind];out.value=`${Math.round(audio[kind]*100)}%`;input.addEventListener('input',()=>{audio.unlock();audio.setVolume(kind,input.value);out.value=`${Math.round(input.value*100)}%`;});}
$('reducedMotion').checked=renderer.reducedMotion;$('reducedMotion').addEventListener('change',e=>{renderer.reducedMotion=e.target.checked;});
$('showFps').addEventListener('change',e=>$('fpsCounter').classList.toggle('hidden',!e.target.checked));

// Chat.
$('chatToggle').addEventListener('click',()=>$('chatPanel').classList.toggle('hidden'));$('closeChat').addEventListener('click',()=>$('chatPanel').classList.add('hidden'));
$('chatForm').addEventListener('submit',e=>{e.preventDefault();const text=$('chatInput').value.trim();if(text)network.command('CHAT',{text});$('chatInput').value='';});
function addChat(data){const el=document.createElement('div');el.className='chat-message';el.innerHTML=`<b style="color:${data.color}">${escapeHtml(data.name)}</b><span>${escapeHtml(data.text)}</span>`;$('chatMessages').append(el);$('chatMessages').scrollTop=$('chatMessages').scrollHeight;if(state.room?.mode==='multiplayer')$('chatToggle').classList.remove('hidden');}

// First-game tutorial.
function showTutorial(index){tutorialIndex=index;if(index>=tutorialSteps.length)return closeTutorial();$('tutorial').classList.remove('hidden');$('tutorialStep').textContent=`FIELD MANUAL ${index+1} / ${tutorialSteps.length}`;$('tutorialTitle').textContent=tutorialSteps[index][0];$('tutorialText').textContent=tutorialSteps[index][1];$('nextTutorial').textContent=index===tutorialSteps.length-1?'DEPLOY →':'NEXT →';}
function closeTutorial(){$('tutorial').classList.add('hidden');localStorage.setItem('pf-tutorial','done');}
$('nextTutorial').addEventListener('click',()=>showTutorial(tutorialIndex+1));$('skipTutorial').addEventListener('click',closeTutorial);

// Keep latency visible and command retry logic warm.
setInterval(()=>{if(network.connected&&network.code&&state.gameActive)network.command('PING',{at:performance.now()});},2500);
setInterval(()=>{if(state.snapshot&&state.gameActive){updateHUD();updateZoomBadge();}},1000);
