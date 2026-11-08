export class AudioEngine {
  constructor() {
    const saved=this.load();this.master=saved.master??.7;this.sfx=saved.sfx??.8;this.music=saved.music??.15;this.muted=saved.muted??false;
    this.ctx=null;this.masterGain=null;this.sfxGain=null;this.musicGain=null;this.activeBattle=0;this.musicTimer=null;this.musicStep=0;
  }
  load(){try{return JSON.parse(localStorage.getItem('pf-audio'))||{};}catch{return{};}}
  save(){localStorage.setItem('pf-audio',JSON.stringify({master:this.master,sfx:this.sfx,music:this.music,muted:this.muted}));}
  async unlock(){
    if(!this.ctx){
      const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;
      this.ctx=new Context();this.masterGain=this.ctx.createGain();this.sfxGain=this.ctx.createGain();this.musicGain=this.ctx.createGain();
      this.sfxGain.connect(this.masterGain);this.musicGain.connect(this.masterGain);this.masterGain.connect(this.ctx.destination);this.apply();this.startMusic();
    }
    if(this.ctx.state==='suspended')await this.ctx.resume();
  }
  apply(){if(!this.ctx)return;this.masterGain.gain.setTargetAtTime(this.muted?0:this.master,this.ctx.currentTime,.02);this.sfxGain.gain.setTargetAtTime(this.sfx,this.ctx.currentTime,.02);this.musicGain.gain.setTargetAtTime(this.music*.24,this.ctx.currentTime,.05);this.save();}
  setVolume(kind,value){this[kind]=Number(value);this.apply();}
  toggleMute(){this.muted=!this.muted;this.apply();return this.muted;}
  makePan(pan=0,destination=this.sfxGain){if(!this.ctx)return null;const node=this.ctx.createStereoPanner?this.ctx.createStereoPanner():this.ctx.createGain();if(node.pan)node.pan.value=pan;node.connect(destination);return node;}
  tone(freq,duration=.1,{type='square',volume=.1,slide=0,pan=0,when=0,destination=null}={}){
    if(!this.ctx||this.ctx.state!=='running')return;const t=this.ctx.currentTime+when,osc=this.ctx.createOscillator(),gain=this.ctx.createGain(),out=this.makePan(pan,destination||this.sfxGain);
    osc.type=type;osc.frequency.setValueAtTime(Math.max(20,freq),t);if(slide)osc.frequency.exponentialRampToValueAtTime(Math.max(20,freq+slide),t+duration);
    gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(Math.max(.0002,volume),t+.008);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    osc.connect(gain);gain.connect(out);osc.start(t);osc.stop(t+duration+.02);
  }
  noise(duration=.15,{volume=.12,frequency=700,pan=0,when=0}={}){
    if(!this.ctx||this.ctx.state!=='running')return;const length=Math.ceil(this.ctx.sampleRate*duration),buffer=this.ctx.createBuffer(1,length,this.ctx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*(1-i/length);
    const src=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),gain=this.ctx.createGain(),out=this.makePan(pan),t=this.ctx.currentTime+when;
    src.buffer=buffer;filter.type='lowpass';filter.frequency.value=frequency;gain.gain.setValueAtTime(volume,t);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    src.connect(filter);filter.connect(gain);gain.connect(out);src.start(t);
  }
  click(){this.tone(620,.035,{volume:.045,type:'square'});}
  error(){this.tone(115,.13,{volume:.11,type:'sawtooth',slide:-35});}
  spatial(region,camera){if(!region)return{pan:0,scale:1};const dx=region.x-camera.x,dy=region.y-camera.y,d=Math.hypot(dx,dy);return{pan:Math.max(-1,Math.min(1,dx/70)),scale:Math.max(.12,1-d/150)};}
  event(event,region,camera,clientId){
    if(!this.ctx||this.ctx.state!=='running')return;const {pan,scale}=this.spatial(region,camera),battle=['ATTACK','CAPTURE','DEFEND','DRONE_LAUNCH','MISSILE_LAUNCH','MISSILE_EXPLOSION','AA_INTERCEPT','BUILDING_DESTROYED'].includes(event.type);
    if(battle){if(this.activeBattle>=6)return;this.activeBattle++;setTimeout(()=>this.activeBattle=Math.max(0,this.activeBattle-1),400);}
    const v=scale;
    switch(event.type){
      case'CAPTURE':{const own=event.ownerId===clientId,lost=event.previousOwnerId===clientId;this.tone(lost?410:own?620:350,.12,{volume:.10*v,slide:lost?-180:own?240:40,pan});if(own)this.tone(900,.08,{volume:.06*v,when:.07,pan});break;}
      case'ATTACK':this.tone(event.ownerId===clientId?150:110,.18,{volume:.09*v,type:'sawtooth',slide:-65,pan});this.noise(.09,{volume:.04*v,frequency:500,pan});break;
      case'DEFEND':this.tone(240,.08,{volume:.045*v,slide:-70,pan});break;
      case'BUILD':this.noise(.06,{volume:.09,frequency:1000,pan});this.tone(180,.07,{volume:.06,slide:-50,pan});break;
      case'UPGRADE':this.tone(480,.09,{volume:.08,pan});this.tone(720,.12,{volume:.08,when:.09,pan});break;
      case'DRONE_LAUNCH':this.tone(980,.12,{volume:.055*v,type:'sawtooth',slide:-520,pan});break;
      case'MISSILE_LAUNCH':this.noise(.32,{volume:.09*v,frequency:900,pan});this.tone(90,.35,{volume:.1*v,type:'sawtooth',slide:120,pan});break;
      case'MISSILE_EXPLOSION':case'BUILDING_DESTROYED':this.noise(.4,{volume:.16*v,frequency:420,pan});this.tone(75,.28,{volume:.11*v,slide:-35,pan});break;
      case'AA_INTERCEPT':this.tone(1200,.07,{volume:.08*v,slide:-650,pan});this.noise(.08,{volume:.05*v,frequency:1800,pan,when:.03});break;
      case'DRONE_HIT':case'MISSILE_HIT':this.noise(.12,{volume:.07*v,frequency:700,pan});break;
      case'BUILDING_CAPTURE':if(event.ownerId===clientId)this.tone(540,.08,{volume:.045,pan});break;
    }
  }
  victory(won){if(!this.ctx)return;if(won)[440,554,659,880].forEach((f,i)=>this.tone(f,.28,{volume:.1,when:i*.12}));else{this.tone(220,.5,{volume:.1,type:'triangle',slide:-30});this.tone(261,.5,{volume:.07,type:'triangle',when:.05,slide:-40});}}
  startMusic(){
    if(this.musicTimer)return;const notes=[110,0,165,0,130.81,0,196,0,110,146.83,0,164.81,98,0,146.83,0];
    this.musicTimer=setInterval(()=>{if(!this.ctx||this.ctx.state!=='running'||this.music<=0)return;const f=notes[this.musicStep++%notes.length];if(f)this.tone(f,.22,{volume:.11,type:'triangle',destination:this.musicGain});},260);
  }
}
