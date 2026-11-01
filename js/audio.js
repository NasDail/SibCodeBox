// Сохранённая аудиосистема исходного автомата: стили BGM/SFX, DSP, громкость и mute.
/* CONFIG */
const CONFIG = {
  bgmStyle: 'ambient', sfxStyle: 'arcade', bgmTempo: 5.5, bgmVolume: 40, sfxVolume: 70,
  filterCutoff: 2400, bassBoost: 50, reverb: 35, echo: 0,
  chimesEnabled: true, glowIntensity: 60, idleTimeout: 120,
  hideCursor: true, baudrate: 9600,
  save() { try { localStorage.setItem('sib_config_v10', JSON.stringify(this)); } catch(e){} },
  load() {
    try {
      const s = localStorage.getItem('sib_config_v10') || localStorage.getItem('sib_config_v12');
      if (s) Object.assign(this, JSON.parse(s));
      if (this.filterCutoff < 800) this.filterCutoff = 2400;
    } catch(e){}
  }
};
CONFIG.load();

/* =====================================================================
   AUDIO (сокращённо — логика сохранена)
   ===================================================================== */
const SoundMaster = {
  ctx:null, isMuted:false, isBgmPlaying:false,
  masterGain:null, bgmGain:null, sfxGain:null, bgmVoices:[],
  filterNode:null, bassNode:null, reverbNode:null, reverbGain:null,
  echoDelay:null, echoGain:null,
  currentChordStep:0, chordTimer:null, melodyTimer:null,
  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain(); this.masterGain.gain.value = 1;
      this.masterGain.connect(this.ctx.destination);
      this.bgmGain = this.ctx.createGain(); this.bgmGain.gain.value = Math.max(0, Math.min(1, Number.isFinite(Number(CONFIG.bgmVolume)) ? Number(CONFIG.bgmVolume) / 100 : 0.4));
      this.bgmGain.connect(this.masterGain);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = Math.max(0, Math.min(1, Number.isFinite(Number(CONFIG.sfxVolume)) ? Number(CONFIG.sfxVolume) / 100 : 0.7));
      this.sfxGain.connect(this.masterGain);
      this.bassNode = this.ctx.createBiquadFilter();
      this.bassNode.type = 'lowshelf'; this.bassNode.frequency.value = 200;
      this.bassNode.gain.value = (CONFIG.bassBoost - 50) / 50 * 8;
      this.bassNode.connect(this.bgmGain);
      this.filterNode = this.ctx.createBiquadFilter();
      this.filterNode.type = 'lowpass'; this.filterNode.frequency.value = CONFIG.filterCutoff;
      this.filterNode.Q.value = 0.7; this.filterNode.connect(this.bassNode);
      this.reverbNode = this.ctx.createConvolver();
      this.reverbNode.buffer = this._makeReverbBuffer(2, 2.5);
      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = CONFIG.reverb / 100 * 0.6;
      this.reverbNode.connect(this.reverbGain); this.reverbGain.connect(this.bgmGain);
      this.echoDelay = this.ctx.createDelay(2); this.echoDelay.delayTime.value = 0.32;
      this.echoGain = this.ctx.createGain();
      this.echoGain.gain.value = CONFIG.echo / 100 * 0.4;
      this.echoDelay.connect(this.echoGain); this.echoGain.connect(this.echoDelay);
      this.echoGain.connect(this.bgmGain);
    }
    const resume = this.ctx.resume();
    if (resume && resume.then) resume.then(() => { if (!this.isBgmPlaying && !this.isMuted) this.startBGM(CONFIG.bgmStyle); }).catch(()=>{});
    else if (!this.isBgmPlaying && !this.isMuted) this.startBGM(CONFIG.bgmStyle);
  },
  _makeReverbBuffer(duration, decay) {
    const rate = this.ctx.sampleRate, len = rate * duration;
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * Math.pow(1 - i/len, decay);
    }
    return buf;
  },
  setBgmVolume(v){ const value=Math.max(0,Math.min(1,Number(v)||0)); CONFIG.bgmVolume=Math.round(value*100); CONFIG.save(); if(this.bgmGain) this.bgmGain.gain.setTargetAtTime(value,this.ctx.currentTime,0.05); },
  setSfxVolume(v){ const value=Math.max(0,Math.min(1,Number(v)||0)); CONFIG.sfxVolume=Math.round(value*100); CONFIG.save(); if(this.sfxGain) this.sfxGain.gain.setTargetAtTime(value,this.ctx.currentTime,0.05); },
  setFilterCutoff(v){ CONFIG.filterCutoff=Number(v); CONFIG.save(); if(this.filterNode) this.filterNode.frequency.setTargetAtTime(CONFIG.filterCutoff,this.ctx.currentTime,0.05); },
  setBassBoost(v){ CONFIG.bassBoost=Number(v); CONFIG.save(); if(this.bassNode) this.bassNode.gain.setTargetAtTime((CONFIG.bassBoost-50)/50*8,this.ctx.currentTime,0.05); },
  setReverb(v){ CONFIG.reverb=Number(v); CONFIG.save(); if(this.reverbGain) this.reverbGain.gain.setTargetAtTime(CONFIG.reverb/100*0.6,this.ctx.currentTime,0.05); },
  setEcho(v){ CONFIG.echo=Number(v); CONFIG.save(); if(this.echoGain) this.echoGain.gain.setTargetAtTime(CONFIG.echo/100*0.4,this.ctx.currentTime,0.05); },
  toggleMute() {
    this.init(); this.isMuted = !this.isMuted;
    document.getElementById('btnAudioToggle').textContent = this.isMuted ? '🔇' : '🔊';
    this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : 1, this.ctx.currentTime, 0.05);
    if (!this.isMuted && !this.isBgmPlaying) this.startBGM(CONFIG.bgmStyle);
  },
  stopBGM() {
    if (this.chordTimer) { clearInterval(this.chordTimer); this.chordTimer = null; }
    if (this.melodyTimer) { clearInterval(this.melodyTimer); this.melodyTimer = null; }
    for (const voice of this.bgmVoices) { try { voice.o.stop(); } catch (_) {} }
    this.bgmVoices = [];
    this.isBgmPlaying = false;
  },
  startBGM(style) {
    if (!this.ctx) return;
    this.stopBGM(); this.isBgmPlaying = true;
    const presets = {
      ambient:   { chords: [[82.41,164.81,196.00,246.94,293.66,370.00],[65.41,130.81,196.00,246.94,261.63,329.63],[98.00,146.83,196.00,246.94,293.66,392.00],[73.42,146.83,220.00,293.66,369.99,440.00]], scale:[392,440,493.88,587.33,659.25,783.99,880,987.77], type:'sine' },
      synthwave: { chords: [[110,220,277.18,329.63,440],[98,196,246.94,293.66,392],[123.47,246.94,311.13,369.99,493.88],[146.83,293.66,369.99,440,587.33]], scale:[440,523.25,587.33,659.25,783.99,880,1046.5], type:'sawtooth' },
      lofi:      { chords: [[65.41,130.81,155.56,196,233.08],[58.27,116.54,146.83,174.61,220],[73.42,146.83,174.61,220,261.63],[82.41,164.81,196,246.94,293.66]], scale:[261.63,311.13,349.23,392,466.16,523.25], type:'triangle' },
      chiptune:  { chords: [[131.85,164.81,196,261.63,329.63],[146.83,174.61,220,293.66,369.99],[164.81,196,246.94,329.63,392],[123.47,155.56,196,246.94,311.13]], scale:[523.25,587.33,659.25,698.46,783.99,880,987.77,1046.5], type:'square' },
      cinematic: { chords: [[55,110,146.83,164.81,220],[61.74,123.47,164.81,185,246.94],[49,98,130.81,146.83,196],[65.41,130.81,174.61,196,261.63]], scale:[220,261.63,329.63,392,440,523.25], type:'sine' }
    };
    const p = presets[style] || presets.ambient;
    const voices = [];
    for (let i = 0; i < 5; i++) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = p.type; o.detune.value = (Math.random()-0.5)*12;
      g.gain.value = i === 0 ? 0.22 : 0.08;
      o.connect(g); g.connect(this.filterNode);
      if (this.reverbNode) g.connect(this.reverbNode);
      if (this.echoDelay) g.connect(this.echoDelay);
      o.start(); voices.push({o,g});
    }
    this.bgmVoices = voices;
    const nextChord = () => {
      if (!this.isBgmPlaying) return;
      const chord = p.chords[this.currentChordStep % p.chords.length];
      const t = this.ctx.currentTime;
      voices.forEach((v,i) => { if (chord[i]) v.o.frequency.setTargetAtTime(chord[i],t,1.6); });
      this.currentChordStep++;
    };
    nextChord();
    this.chordTimer = setInterval(nextChord, Math.max(1800, CONFIG.bgmTempo * 1000));
    this.melodyTimer = setInterval(() => {
      if (!this.isBgmPlaying || this.isMuted || !CONFIG.chimesEnabled) return;
      if (Math.random() > 0.45) {
        const note = p.scale[Math.floor(Math.random()*p.scale.length)];
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = p.type; o.frequency.value = note;
        g.gain.setValueAtTime(0.06, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        o.connect(g); g.connect(this.bgmGain);
        if (this.reverbNode) g.connect(this.reverbNode);
        o.start(t); o.stop(t + 1.6);
      }
    }, 750);
  },
  pauseBGM(){ if(this.bgmGain && this.ctx) this.bgmGain.gain.setTargetAtTime(0,this.ctx.currentTime,0.35); },
  resumeBGM(){
    if (!this.bgmGain || this.isMuted) return;
    const target = Math.max(0, Math.min(1, Number.isFinite(Number(CONFIG.bgmVolume)) ? Number(CONFIG.bgmVolume) / 100 : 0.4));
    this.bgmGain.gain.setTargetAtTime(target,this.ctx.currentTime,0.8);
  },
  _sfxParams(kind) {
    const themes = {
      soft:   { hover:{f1:700,f2:400,g:0.03,t:'sine'}, focus:{f1:280,f2:120,g:0.15,t:'sine'}, click:{f1:400,f2:700,g:0.1,t:'sine'} },
      arcade: { hover:{f1:750,f2:380,g:0.05,t:'sine'}, focus:{f1:320,f2:110,g:0.2,t:'sine'}, click:{f1:440,f2:880,g:0.15,t:'triangle'} },
      heavy:  { hover:{f1:400,f2:180,g:0.08,t:'square'}, focus:{f1:200,f2:60,g:0.3,t:'square'}, click:{f1:220,f2:110,g:0.2,t:'sawtooth'} }
    };
    return themes[CONFIG.sfxStyle]?.[kind] || themes.arcade[kind];
  },
  _beep(f1,f2,g,tT,dur){ if(this.isMuted) return; this.init(); const t=this.ctx.currentTime; const o=this.ctx.createOscillator(),gg=this.ctx.createGain(); o.type=tT; o.frequency.setValueAtTime(f1,t); o.frequency.exponentialRampToValueAtTime(f2,t+dur); gg.gain.setValueAtTime(g,t); gg.gain.exponentialRampToValueAtTime(0.0001,t+dur); o.connect(gg); gg.connect(this.sfxGain); o.start(t); o.stop(t+dur); },
  hover(){ const p=this._sfxParams('hover'); this._beep(p.f1,p.f2,p.g,p.t,0.04); },
  focus(){ const p=this._sfxParams('focus'); this._beep(p.f1,p.f2,p.g,p.t,0.09); },
  click(){ const p=this._sfxParams('click'); this._beep(p.f1,p.f2,p.g,p.t,0.10); },
  back(){ this._beep(320,130,0.16,'sine',0.14); },
  error(){ this._beep(220,110,0.25,'sawtooth',0.30); },
  launch(){ if(this.isMuted) return; this.init(); const t=this.ctx.currentTime;
    const s=this.ctx.createOscillator(),sg=this.ctx.createGain(); s.type='sine';
    s.frequency.setValueAtTime(90,t); s.frequency.exponentialRampToValueAtTime(25,t+0.8);
    sg.gain.setValueAtTime(0.4,t); sg.gain.exponentialRampToValueAtTime(0.0001,t+0.8);
    s.connect(sg); sg.connect(this.sfxGain); s.start(t); s.stop(t+0.8);
    const b=this.ctx.createOscillator(),bg=this.ctx.createGain(); b.type='triangle';
    b.frequency.setValueAtTime(523.25,t); b.frequency.exponentialRampToValueAtTime(1046.5,t+0.45);
    bg.gain.setValueAtTime(0.2,t); bg.gain.exponentialRampToValueAtTime(0.0001,t+0.5);
    b.connect(bg); bg.connect(this.sfxGain); b.start(t); b.stop(t+0.5);
  },
  secretUnlock(){ this.init(); [523.25,659.25,783.99,1046.5].forEach((f,i)=>{ setTimeout(()=>{ const t=this.ctx.currentTime; const o=this.ctx.createOscillator(),g=this.ctx.createGain(); o.type='triangle'; o.frequency.value=f; g.gain.setValueAtTime(0.2,t); g.gain.exponentialRampToValueAtTime(0.0001,t+0.25); o.connect(g); g.connect(this.masterGain); o.start(t); o.stop(t+0.25); }, i*80); }); }
};
window.addEventListener('pointerdown', () => SoundMaster.init(), { once:true });
window.addEventListener('keydown', () => SoundMaster.init(), { once:true });
window.CONFIG = CONFIG;
window.SoundMaster = SoundMaster;

