import WebSocket from 'ws';
import assert from 'node:assert/strict';

class Client {
  constructor(){this.ws=null;this.messages=[];this.waiters=[];this.session=null;}
  open(){return new Promise((resolve,reject)=>{this.ws=new WebSocket('ws://127.0.0.1:3000/ws');this.ws.on('open',resolve);this.ws.on('error',reject);this.ws.on('message',raw=>{const data=JSON.parse(raw);if(data.t==='WELCOME')this.session={clientId:data.clientId,sessionToken:data.sessionToken,code:data.code};this.messages.push(data);for(const waiter of [...this.waiters])if(waiter.pred(data)){clearTimeout(waiter.timer);this.waiters.splice(this.waiters.indexOf(waiter),1);waiter.resolve(data);}});});}
  send(data){this.ws.send(JSON.stringify(data));}
  wait(pred,ms=5000){const found=this.messages.find(pred);if(found)return Promise.resolve(found);return new Promise((resolve,reject)=>{const waiter={pred,resolve,timer:setTimeout(()=>{this.waiters.splice(this.waiters.indexOf(waiter),1);reject(new Error(`Message wait timeout: ${pred} · seen ${JSON.stringify(this.messages)}`));},ms)};this.waiters.push(waiter);});}
  close(){this.ws.close();}
}
const a=new Client();await a.open();a.send({t:'HELLO',action:'createMultiplayer',name:'Host',settings:{seed:42,peaceSeconds:0,speed:1}});const welcomeA=await a.wait(m=>m.t==='WELCOME');assert.equal(welcomeA.code.length,6);
const b=new Client();await b.open();b.send({t:'HELLO',action:'join',name:'Guest',code:welcomeA.code});const welcomeB=await b.wait(m=>m.t==='WELCOME');assert.equal(welcomeB.code,welcomeA.code);
await a.wait(m=>m.t==='LOBBY'&&m.room.players.length===2);a.send({t:'CMD',cmdId:'add-bot',type:'ADD_BOT',payload:{difficulty:3}});await a.wait(m=>m.t==='LOBBY'&&m.room.players.length===3);
a.send({t:'CMD',cmdId:'start',type:'START_MATCH',payload:{}});const fullA=await a.wait(m=>m.t==='FULL'),fullB=await b.wait(m=>m.t==='FULL');
assert.deepEqual(fullA.snapshot.regions,fullB.snapshot.regions,'both browsers receive identical world state');assert.equal(fullA.snapshot.players.length,3);
a.send({t:'CMD',cmdId:'chat-1',type:'CHAT',payload:{text:'Hold the frontier'}});await b.wait(m=>m.t==='CHAT'&&m.text==='Hold the frontier');
const human=fullA.snapshot.players.find(p=>p.id===welcomeA.clientId),source=human.capitalRegion,target=fullA.snapshot.regions[source].i;
a.send({t:'CMD',cmdId:'zero',type:'ATTACK',payload:{fromRegions:[source],toRegionId:target,percent:0}});await a.wait(m=>m.t==='ERR'&&m.cmdId==='zero');
b.close();await new Promise(r=>setTimeout(r,100));const resumed=new Client();await resumed.open();resumed.send({t:'HELLO',action:'resume',code:welcomeB.code,playerId:welcomeB.clientId,sessionToken:welcomeB.sessionToken});const resumeWelcome=await resumed.wait(m=>m.t==='WELCOME');assert.equal(resumeWelcome.resumed,true);const resumeFull=await resumed.wait(m=>m.t==='FULL');assert.ok(resumeFull.snapshot.players.some(p=>p.id===welcomeB.clientId));
console.log(`NETWORK SMOKE OK · room ${welcomeA.code} · identical ${fullA.snapshot.regions.length}-sector state · chat · validation · reconnect`);
a.close();resumed.close();
