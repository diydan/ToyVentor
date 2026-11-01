// Native world runtime: audio (5A Unit 2).
//
// Lifted verbatim from runtime/world.ts. No behavior change: statements keep
// their relative order and run once at import time, as before.
import { PART, PB } from "./catalog";

/* ---------- sound ---------- */
var AC: AudioContext | null = null, sound = true;
var gestured=false;
function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!gestured && !AC) return null;
  if (!AC) {
    var C: typeof AudioContext | undefined =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (C) AC = new C();
  }if(AC&&AC.state==="suspended"&&gestured){var rp=AC.resume();if(rp&&rp.catch)rp.catch(function(){})}return AC}
function tone(f: number, t0: number, d: number, ty: OscillatorType, v: number, f2?: number): void {var a=ctx();if(!a||!sound)return;var o=a.createOscillator(),g=a.createGain();o.type=ty||"sine";o.frequency.setValueAtTime(f,a.currentTime+t0);if(f2)o.frequency.exponentialRampToValueAtTime(f2,a.currentTime+t0+d);g.gain.setValueAtTime(.0001,a.currentTime+t0);g.gain.exponentialRampToValueAtTime(v||.12,a.currentTime+t0+.02);g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+t0+d);o.connect(g);g.connect(a.destination);o.start(a.currentTime+t0);o.stop(a.currentTime+t0+d+.05)}
function noise(t0: number, d: number, fa: number, fb: number, v: number): void {var a=ctx();if(!a||!sound)return;var n=Math.floor(a.sampleRate*d),b=a.createBuffer(1,n,a.sampleRate),x=b.getChannelData(0);for(var i=0;i<n;i++)x[i]=Math.random()*2-1;var s=a.createBufferSource();s.buffer=b;var f=a.createBiquadFilter();f.type="bandpass";f.frequency.setValueAtTime(fa,a.currentTime+t0);f.frequency.exponentialRampToValueAtTime(fb,a.currentTime+t0+d);var g=a.createGain();g.gain.setValueAtTime(v||.2,a.currentTime+t0);g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+t0+d);s.connect(f);f.connect(g);g.connect(a.destination);s.start(a.currentTime+t0)}
var sfx={snap:function(){noise(0,.05,2200,1200,.12);tone(220,0,.12,"sine",.14,120)},zoom:function(){noise(0,.5,400,3200,.16)},glow:function(){tone(520,0,.5,"sine",.12,1040);tone(780,.05,.5,"sine",.07,1560)},shove:function(){tone(110,0,.18,"sine",.22,70);noise(0,.15,500,200,.18)},whirl:function(){noise(0,.7,500,1800,.14);tone(260,0,.7,"triangle",.07,780)},found:function(){tone(784,0,.12,"triangle",.14);tone(988,.1,.12,"triangle",.14);tone(1319,.2,.35,"triangle",.14)},bump:function(){tone(110,0,.12,"sine",.2)},pop:function(){tone(420,0,.12,"sine",.14,260)},bolt:function(){for(var i=0;i<3;i++)tone(900-i*150,i*.06,.05,"square",.05)},crash:function(){noise(0,.4,900,200,.3);tone(140,0,.25,"sine",.2,60)}};
/* adaptive music: one bar of pad, an arpeggio, and a melody that joins as parts are found */
function buzz(p: number | number[]): void {
  try {
    if (navigator.vibrate) navigator.vibrate(p);
  } catch (e) {}
}
function partSound(k: string): void {var p=PART[k];if(!p){sfx.snap();return}noise(0,.04,2400,1400,.1);var st=p.st,sl=p.s;
 if(st==="speed")tone(320,0,.14,"sawtooth",.045,1100);else if(st==="spin"){tone(500,0,.25,"triangle",.08,800);tone(640,.08,.2,"triangle",.06,420)}else if(st==="glow"){tone(880,0,.4,"sine",.09);tone(1320,.06,.45,"sine",.06);tone(1760,.12,.4,"sine",.04)}else{tone(140,0,.16,"square",.06,90);noise(.01,.08,2800,1800,.12)}
 if(sl==="wheels"||sl==="legs"||sl==="feet")tone(180,.02,.18,"sine",.12,90);else if(sl==="head"||sl==="top"||sl==="extra")tone(660,.03,.1,"sine",.07,990);else tone(260,.02,.1,"triangle",.06,200);buzz(10)}
var MOTOR: { o: OscillatorNode; o2: OscillatorNode; g: GainNode } | null = null;
function motor(v: number): void {var a=AC;if(!a)return;if(!MOTOR){var o=a.createOscillator(),o2=a.createOscillator(),f=a.createBiquadFilter(),g=a.createGain();o.type="sawtooth";o2.type="square";o.frequency.value=60;o2.frequency.value=30;f.type="lowpass";f.frequency.value=360;g.gain.value=0;o.connect(f);o2.connect(f);f.connect(g);g.connect(a.destination);o.start();o2.start();MOTOR={o:o,o2:o2,g:g}}var on=sound&&v>.2;MOTOR.o.frequency.setTargetAtTime(58+v*22,a.currentTime,.08);MOTOR.o2.frequency.setTargetAtTime(29+v*11,a.currentTime,.08);MOTOR.g.gain.setTargetAtTime(on?Math.min(.045,.012+v*.007):0,a.currentTime,.08)}
export interface MusicState {
  on: boolean;
  next: number;
  step: number;
  bar: number;
  bus: GainNode | null;
  rev: ConvolverNode | null;
  nb?: AudioBuffer;
}
var MUS: MusicState = {on:false,next:0,step:0,bar:0,bus:null,rev:null};
export interface SongDef {
  bpm: number;
  root: number;
  scale: number[];
  wave: OscillatorType;
  pad: number[];
  dec: number;
}
var SONG: Record<string, SongDef> = {garden:{bpm:84,root:60,scale:[0,2,4,7,9],wave:"triangle",pad:[0,4,7],dec:.55},sky:{bpm:70,root:62,scale:[0,2,4,7,9,11],wave:"sine",pad:[0,4,7,11],dec:1.1},junk:{bpm:96,root:57,scale:[0,3,5,7,10],wave:"square",pad:[0,3,7],dec:.22},beach:{bpm:104,root:62,scale:[0,2,4,7,9],wave:"triangle",pad:[0,4,7],dec:.32},snow:{bpm:68,root:64,scale:[0,2,4,7,11],wave:"sine",pad:[0,4,7,11],dec:1.4},room:{bpm:92,root:67,scale:[0,2,4,5,7,9],wave:"triangle",pad:[0,4,7],dec:.5}};
function musInit(){var a=ctx();if(!a||MUS.bus)return;MUS.bus=a.createGain();MUS.bus.gain.value=0;MUS.bus.connect(a.destination);var cv=a.createConvolver(),len=Math.floor(a.sampleRate*2.4),buf=a.createBuffer(2,len,a.sampleRate);for(var ch=0;ch<2;ch++){var d=buf.getChannelData(ch);for(var i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.6)}cv.buffer=buf;var wet=a.createGain();wet.gain.value=.4;cv.connect(wet);wet.connect(MUS.bus);MUS.rev=cv;MUS.next=a.currentTime+.1}
function musGain(v: number, tm?: number): void {var a=ctx();if(!a||!MUS.bus)return;MUS.bus.gain.cancelScheduledValues(a.currentTime);MUS.bus.gain.setTargetAtTime(v,a.currentTime,tm||.6)}
function mnote(m: number, t: number, dur: number, wave: OscillatorType, vol: number): void {var a=ctx();if(!a)return;var o=a.createOscillator(),g=a.createGain(),f=a.createBiquadFilter();f.type="lowpass";f.frequency.value=wave==="square"?1200:2800;o.type=wave;o.frequency.value=440*Math.pow(2,(m-69)/12);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(f);f.connect(g);g.connect(MUS.bus!);g.connect(MUS.rev!);o.start(t);o.stop(t+dur+.05)}
function kick(t: number): void {var a=AC;if(!a)return;var o=a.createOscillator(),g=a.createGain();o.type="sine";o.frequency.setValueAtTime(130,t);o.frequency.exponentialRampToValueAtTime(46,t+.13);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.16,t+.005);g.gain.exponentialRampToValueAtTime(.0001,t+.26);o.connect(g);g.connect(MUS.bus!);o.start(t);o.stop(t+.3)}
function hit(t: number, f: number, dur: number, vol: number): void {var a=AC;if(!a)return;if(!MUS.nb){var n=Math.floor(a.sampleRate*.3),b=a.createBuffer(1,n,a.sampleRate),d=b.getChannelData(0);for(var i=0;i<n;i++)d[i]=Math.random()*2-1;MUS.nb=b}var s2=a.createBufferSource();s2.buffer=MUS.nb;var fl=a.createBiquadFilter();fl.type="bandpass";fl.frequency.value=f;fl.Q.value=.8;var g=a.createGain();g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);s2.connect(fl);fl.connect(g);g.connect(MUS.bus!);s2.start(t,0,dur+.02)}
function toolSound(k: string): void {if(k==="screwdriver"){for(var i=0;i<4;i++)tone(1700+i*60,i*.12,.05,"square",.03)}else if(k==="spanner"){for(var j=0;j<4;j++)noise(j*.13,.04,4200,3000,.12)}else{tone(320,0,.35,"sawtooth",.05,150);noise(.32,.06,1800,900,.14)}}
function bellTone(k: string): void {var b=PB[k];if(!b)return;tone(b.f,0,.7,"sine",.14);tone(b.f*2,0,.4,"sine",.03)}

export function toggleSound(): boolean {
  sound = !sound;
  return sound;
}
export function noteGesture(): void {
  gestured = true;
  try {
    musInit();
    if (MUS.on) musGain(sound ? 0.7 : 0, 1);
  } catch (e) {}
}

export { AC, sound, gestured, ctx, tone, noise, sfx, partSound, MOTOR, motor, MUS, SONG, musInit, musGain, mnote, kick, hit, toolSound, bellTone, buzz };
(["snap","found","bolt","shove","crash"] as ("snap"|"found"|"bolt"|"shove"|"crash")[]).forEach(function(k){var f=sfx[k],pat={snap:10,found:[20,40,30],bolt:8,shove:16,crash:30}[k];sfx[k]=function(){f.apply(null,arguments as unknown as []);buzz(pat)}});
