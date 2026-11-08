import { MESSAGE, makeCommand } from '/shared/protocol.js';

export class Network extends EventTarget {
  constructor() {
    super(); this.ws = null; this.connected = false; this.clientId = null; this.sessionToken = null; this.code = null; this.mode = null;
    this.pending = new Map(); this.commandSeq = 0; this.reconnectTimer = null; this.shouldResume = false; this.ping = 0;
    this.loadSession(); this.shouldResume = !!(this.code && this.sessionToken && this.clientId); this.connect();
  }
  loadSession() {
    try { const s=JSON.parse(localStorage.getItem('pf-session')); if(s){this.clientId=s.clientId;this.sessionToken=s.sessionToken;this.code=s.code;this.mode=s.mode;} } catch {}
  }
  saveSession() { localStorage.setItem('pf-session',JSON.stringify({clientId:this.clientId,sessionToken:this.sessionToken,code:this.code,mode:this.mode})); }
  clearSession() { localStorage.removeItem('pf-session');this.clientId=this.sessionToken=this.code=this.mode=null;this.shouldResume=false; }
  connect() {
    clearTimeout(this.reconnectTimer);
    const protocol=location.protocol==='https:'?'wss':'ws';
    this.ws=new WebSocket(`${protocol}://${location.host}/ws`);
    this.ws.addEventListener('open',()=>{
      this.connected=true;this.emit('status',{connected:true});
      if(this.shouldResume&&this.code&&this.sessionToken)this.hello('resume',{code:this.code,playerId:this.clientId,sessionToken:this.sessionToken});
    });
    this.ws.addEventListener('close',()=>{
      this.connected=false;this.emit('status',{connected:false});
      if(this.shouldResume)this.reconnectTimer=setTimeout(()=>this.connect(),1800);
    });
    this.ws.addEventListener('error',()=>{});
    this.ws.addEventListener('message',event=>{
      let data;try{data=JSON.parse(event.data);}catch{return;}
      if(data.t===MESSAGE.WELCOME){
        this.clientId=data.clientId;this.sessionToken=data.sessionToken;this.code=data.code;this.mode=data.mode;this.shouldResume=true;this.saveSession();
      }
      if(data.t===MESSAGE.ACK||data.t===MESSAGE.ERR){const pending=this.pending.get(data.cmdId);if(pending){clearTimeout(pending.timer);this.pending.delete(data.cmdId);}}
      if(data.t===MESSAGE.PONG){this.ping=Math.max(0,Math.round(performance.now()-data.at));this.emit('ping',this.ping);}
      this.emit('message',data);
    });
  }
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  send(data){if(this.ws?.readyState===1){this.ws.send(JSON.stringify(data));return true;}return false;}
  hello(action,extra={}){return this.send({t:MESSAGE.HELLO,action,...extra});}
  command(type,payload={}){
    const cmdId=`${Date.now().toString(36)}-${(++this.commandSeq).toString(36)}-${Math.random().toString(36).slice(2,6)}`;
    const command=makeCommand(cmdId,type,payload);this.send(command);
    const pending={command,retries:0,timer:null};
    pending.timer=setTimeout(()=>this.retry(cmdId),1600);this.pending.set(cmdId,pending);return cmdId;
  }
  retry(cmdId){const p=this.pending.get(cmdId);if(!p)return;if(!this.connected||p.retries>=3){this.pending.delete(cmdId);return;}p.retries++;this.send(p.command);p.timer=setTimeout(()=>this.retry(cmdId),1600*p.retries);}
  leave(){if(this.code&&this.connected)this.send(makeCommand(`${Date.now().toString(36)}-leave`,'LEAVE',{}));this.shouldResume=false;for(const p of this.pending.values())clearTimeout(p.timer);this.pending.clear();this.clearSession();this.ws?.close();setTimeout(()=>this.connect(),50);}
}
