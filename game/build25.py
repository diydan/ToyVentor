import os
HERE = os.path.dirname(os.path.abspath(__file__))
engine = open(os.path.join(HERE, "engine25.js")).read()
OUT = os.environ.get("TOYVENTOR_OUT", "/tmp/toyventor-outputs")
TEST_OUT = os.environ.get("TOYVENTOR_TEST_OUT", "/tmp/exp")
os.makedirs(OUT, exist_ok=True)
os.makedirs(TEST_OUT, exist_ok=True)
THREE_VERSION = "0.160.0"
def scripts(base):
    # three >=0.160 ships addons only as ES modules. The engine IIFE runs
    # inside this module script (inlined by page()), after the addons are
    # merged into one THREE namespace exactly as the r128 examples/js
    # globals used to provide them.
    return '''<script type="importmap">
{"imports":{"three":"%sbuild/three.module.js","three/addons/":"%sexamples/jsm/"}}
</script>
<script type="module">
import * as ThreeModule from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';
const THREE = Object.assign({}, ThreeModule, {EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass, FXAAShader});
window.THREE = THREE;
''' % (base, base)
def page(three_src):
    return '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ToyVentor World</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@500;700;800&family=Figtree:wght@500;600;700&display=swap" rel="stylesheet">
<style>
:root{--night:#080f2b;--surface:#101a44;--surf3:#22337e;--line:#7f9bff;--lines:#2c3f94;--ink:#f4f7ff;--mut:#bfcaf5;--sky:#52b7ff;--sky7:#2a7fcc;--gold:#ffd24d;--onsky:#06122b;--focus:#ffd24d;--fd:'Rubik','Figtree',system-ui,sans-serif;--fb:'Figtree',system-ui,sans-serif;color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;height:100%;background:var(--night);color:var(--ink);font:600 15px/1.4 var(--fb);overflow:hidden;-webkit-tap-highlight-color:transparent;-webkit-font-smoothing:antialiased}
#c{position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none}
button{font-family:inherit;color:inherit;cursor:pointer}
button:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
.bar{position:fixed;left:10px;right:10px;display:flex;gap:6px;align-items:center;z-index:3}
.bar1{top:calc(env(safe-area-inset-top,0px) + 10px)}
.bar2{top:calc(env(safe-area-inset-top,0px) + 58px)}
.wt{flex:1;min-height:42px;padding:0 6px;border-radius:12px;border:2px solid var(--line);background:rgba(16,26,68,.88);font:700 13px var(--fd);box-shadow:0 3px 0 var(--lines)}
.wt[aria-selected=true]{background:var(--sky);color:var(--onsky);border-color:var(--sky);box-shadow:0 3px 0 var(--sky7)}
.chip{display:inline-flex;align-items:center;min-height:40px;padding:0 12px;border-radius:12px;background:rgba(16,26,68,.88);border:2px solid var(--lines);font:700 13px var(--fd)}
.ctl{min-height:40px;padding:0 12px;border-radius:12px;border:2px solid var(--line);background:rgba(16,26,68,.88);font:700 13px var(--fd);box-shadow:0 3px 0 var(--lines)}
.ctl.primary{background:var(--gold);color:#2b1d00;border-color:var(--gold);box-shadow:0 3px 0 #b8901f}
.bar2 .grow{flex:1}
.how{position:fixed;left:10px;right:10px;top:calc(env(safe-area-inset-top,0px) + 104px);margin:0;padding:6px 10px;border-radius:10px;background:rgba(8,15,43,.6);font:600 12px var(--fb);color:var(--mut);z-index:3;pointer-events:none}
.tray{position:fixed;left:0;right:0;bottom:0;padding:14px 10px calc(env(safe-area-inset-bottom,0px) + 12px);display:flex;gap:8px;justify-content:center;align-items:flex-end;background:linear-gradient(180deg,rgba(8,15,43,0),rgba(8,15,43,.92) 35%);z-index:3}
.mv{flex:1;max-width:84px;display:flex;flex-direction:column;align-items:center;gap:3px;border:0;background:none;padding:0;font:700 11px var(--fb)}
.mv .pic{width:60px;height:60px;border-radius:16px;background:var(--surface);border:2px solid var(--line);box-shadow:0 3px 0 var(--lines);display:flex;align-items:center;justify-content:center}
.mv.off{opacity:.45}.mv.off .pic{border-style:dashed;box-shadow:none}
.mv.hint .pic{border-color:var(--gold);box-shadow:0 3px 0 #b8901f,0 0 16px rgba(255,210,77,.7)}
.mv:active .pic{transform:translateY(3px)}
.sheet{position:fixed;left:0;right:0;bottom:0;max-height:58vh;overflow:auto;padding:14px 12px calc(env(safe-area-inset-bottom,0px) + 14px);background:rgba(16,26,68,.97);border-top:1px solid rgba(255,255,255,.22);border-radius:20px 20px 0 0;box-shadow:0 -16px 40px rgba(2,6,28,.6);z-index:6;display:flex;flex-direction:column;gap:10px}
.sh-top{display:flex;align-items:center;justify-content:space-between}
.sh-top b{font:700 18px var(--fd)}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.sc{flex:1;min-height:38px;border-radius:10px;border:2px solid var(--lines);background:var(--surface);font:700 13px var(--fd);padding:0 6px}
.sc[aria-pressed=true]{border-color:var(--sky);background:var(--surf3)}
.opts{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x proximity;padding:2px 2px 6px;-webkit-overflow-scrolling:touch}
.opt{position:relative;flex:0 0 calc(33.3% - 6px);min-width:104px;scroll-snap-align:start;min-height:76px;border-radius:14px;border:2px solid var(--lines);background:var(--surface);padding:8px 6px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font:700 13px var(--fd);text-align:center}
.opt .meta{display:flex;align-items:center;gap:4px;font:600 11px var(--fb);color:var(--mut)}
.opt .meta i{width:8px;height:8px;border-radius:50%;display:inline-block}
.opt.on{border-color:var(--sky);background:var(--surf3);box-shadow:0 0 12px rgba(82,183,255,.45)}
.opt.lock{opacity:.7;border-style:dashed}
.opt .lk{font:700 11px/1.2 var(--fb);color:var(--gold)}
.paint{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
#seg{display:flex;gap:4px}
#seg button{min-height:34px;padding:0 10px;border-radius:9px;border:2px solid var(--lines);background:var(--surface);font:700 12px var(--fd)}
#seg button[aria-pressed=true]{border-color:var(--sky);background:var(--surf3)}
#sw{display:flex;gap:6px}
.swt{width:34px;height:34px;border-radius:10px;border:2px solid rgba(255,255,255,.45);padding:0}
.swt[aria-pressed=true]{border:3px solid #fff;box-shadow:0 0 0 2px var(--sky)}
#moves{font:600 12px var(--fb);color:var(--mut)}
.link{align-self:flex-start;background:none;border:0;color:#9bd4ff;font:700 12px var(--fb);text-decoration:underline;padding:6px 0;min-height:32px}
.toast{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 130px);transform:translate(-50%,-8px);width:min(92vw,360px);padding:10px 14px;border-radius:12px;background:rgba(16,26,68,.96);border:1px solid var(--line);font:600 14px var(--fb);opacity:0;transition:all .3s;pointer-events:none;z-index:8}
.toast.on{opacity:1;transform:translate(-50%,0)}
.bubble{position:fixed;padding:8px 10px;border-radius:14px;background:#fff;color:#14171c;box-shadow:0 6px 16px rgba(0,0,0,.35);pointer-events:none;opacity:0;transition:opacity .25s;z-index:4;display:flex;gap:6px;align-items:center;font:700 13px var(--fb);transform:translate(-50%,-100%)}
.bubble.on{opacity:1}
.building .bar,.building .how{display:none}
.wt{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;line-height:1.1}
.dots{display:flex;gap:3px}.dots i{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.28)}.dots i.on{background:var(--gold)}
.wt[aria-selected=true] .dots i{background:rgba(6,18,43,.3)}.wt[aria-selected=true] .dots i.on{background:#06122b}
.how{transition:opacity .6s}.how.gone{opacity:0}
.kb{display:none}@media (hover:hover) and (pointer:fine){.kb{display:inline}}
.mv.act .pic{border-color:var(--gold);background:#2a2350;box-shadow:0 3px 0 #b8901f,0 0 16px rgba(255,210,77,.55);animation:actp 1s ease-in-out infinite alternate}
@keyframes actp{to{transform:scale(1.08)}}
.check{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ck{flex:1;min-width:160px;font:700 13px var(--fd);padding:8px 10px;border-radius:10px}
.ck.ok{background:rgba(90,240,176,.14);color:#5af0b0}.ck.bad{background:rgba(255,157,92,.14);color:#ff9d5c}
.pcard{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 112px);transform:translateX(-50%);width:min(94vw,380px);padding:12px;border-radius:16px;background:rgba(16,26,68,.97);border:2px solid var(--gold);box-shadow:0 12px 30px rgba(0,0,0,.45),0 0 24px rgba(255,210,77,.25);display:grid;grid-template-columns:44px 1fr;gap:6px 10px;align-items:center;z-index:5}
.pcard.on{animation:cardin .45s cubic-bezier(.2,1.4,.4,1)}
@keyframes cardin{0%{transform:translate(-50%,30px) scale(.9);opacity:0}100%{transform:translate(-50%,0) scale(1);opacity:1}}
.pc-ic{width:44px;height:44px;border-radius:12px;background:var(--surf3);display:flex;align-items:center;justify-content:center}
.pc-t{display:flex;flex-direction:column}.pc-t b{font:700 15px var(--fd)}.pc-t span{font:600 12px var(--fb);color:var(--mut)}
.pc-b{grid-column:1/-1;display:flex;gap:8px}.pc-b .ctl{flex:1}
.intro{position:fixed;left:50%;top:38%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;z-index:4;opacity:0}
.intro b{display:block;font:800 40px/1.05 var(--fd);text-shadow:0 4px 18px rgba(0,0,0,.55)}
.intro span{display:block;margin-top:6px;font:700 15px var(--fb);color:var(--gold);text-shadow:0 2px 8px rgba(0,0,0,.6)}
.intro.on{animation:intro 2.4s ease-out forwards}
@keyframes intro{0%{opacity:0;transform:translate(-50%,-40%) scale(.92)}15%,70%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-56%)}}
#fade{position:fixed;inset:0;background:#080f2b;opacity:0;pointer-events:none;z-index:7}
#fade.on{animation:fade .5s ease-out}@keyframes fade{0%{opacity:1}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.intro.on,.pcard.on,.mv.act .pic{animation:none}.intro.on{opacity:1}}
.chip,.ctl,.wt,.how,.sheet,.pcard,.mv .pic{-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.ctl,.wt,.sc,.opt,.swt,.mv{transition:transform .12s ease,box-shadow .12s ease,background-color .2s ease}
.ctl:active,.wt:active,.sc:active,.opt:active{transform:translateY(2px) scale(.97)}
.titled .bar,.titled .how,.titled .tray,.titled #pcard{display:none!important}
.title{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top,0px) + 54px) 20px calc(env(safe-area-inset-bottom,0px) + 40px);z-index:6;pointer-events:none;background:linear-gradient(180deg,rgba(8,15,43,.55),rgba(8,15,43,0) 30%,rgba(8,15,43,0) 62%,rgba(8,15,43,.75))}
.title>*{pointer-events:auto}
.logo{font:800 46px/1 var(--fd);letter-spacing:-.5px;text-align:center;text-shadow:0 6px 24px rgba(82,183,255,.45);animation:logoin .9s cubic-bezier(.2,1.3,.4,1) both}
.logo span{display:block;font:700 18px var(--fd);letter-spacing:6px;text-transform:uppercase;color:var(--gold);margin-top:6px}
.tag{margin:12px 0 0;font:600 15px var(--fb);color:var(--mut);text-align:center}
.title .tag{position:absolute;top:calc(env(safe-area-inset-top,0px) + 150px);left:0;right:0}
.title .toy-tag{position:absolute;top:calc(env(safe-area-inset-top,0px) + 178px);left:0;right:0;margin:0;font:700 15px var(--fd);color:var(--gold);text-align:center}
.tbtns{display:flex;flex-direction:column;gap:10px;width:min(80vw,300px);animation:logoin .9s .2s cubic-bezier(.2,1.3,.4,1) both}
.ctl.big{min-height:58px;font-size:20px;border-radius:14px}
.ctl.primary.big{box-shadow:0 5px 0 #b8901f,0 12px 26px rgba(255,210,77,.35)}
@keyframes logoin{0%{opacity:0;transform:translateY(16px) scale(.94)}100%{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.logo,.tbtns{animation:none}}
.load{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;background:var(--night);font:700 18px var(--fd);z-index:9;transition:opacity .5s}
.load.gone{opacity:0;pointer-events:none}

.editing .bar,.editing .how,.editing .tray,.editing #pcard,.editing #bub,.editing #intro{display:none!important}
.testing .bar1,.testing #pc-try{display:none!important}
.ed{position:fixed;left:0;right:0;bottom:0;height:min(50vh,440px);display:flex;flex-direction:column;gap:8px;padding:12px 12px calc(env(safe-area-inset-bottom,0px) + 12px);background:rgba(16,26,68,.97);border-top:1px solid rgba(255,255,255,.22);border-radius:20px 20px 0 0;box-shadow:0 -16px 40px rgba(2,6,28,.6);z-index:7}
.ed[hidden],.ed-io[hidden],.ed-back[hidden]{display:none!important}
.ed-row{display:flex;gap:6px;align-items:center}
.ed .ctl{flex:1 1 0;min-width:0;padding:0 6px}
.ed .grow{flex:1 1 auto;min-width:0}
.ed b.grow{font:800 16px var(--fd)}
.ed input,.ed select{min-height:40px;border-radius:12px;border:2px solid var(--line);background:rgba(8,15,43,.92);color:var(--ink);font:700 13px var(--fd);padding:0 8px;min-width:0}
.ed .ed-row>select{flex:0 1 auto;max-width:34%}
#ed-tabs button[aria-pressed=true]{border-color:var(--sky);background:var(--surf3)}
.ed .ctl:disabled{opacity:.45}
.ed-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch}
.ed-mut{display:block;color:var(--mut);font:600 12px var(--fb);margin:2px 0 8px}
.ed-pal{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:6px}
.ed-pal button{position:relative;min-height:54px;padding:8px 8px 8px 24px;border-radius:12px;border:2px solid var(--lines);background:rgba(8,15,43,.92);color:var(--ink);text-align:left;font:700 13px var(--fd);display:flex;flex-direction:column;justify-content:center}
.ed-pal button i{position:absolute;left:9px;top:50%;width:9px;height:9px;margin-top:-4px;border-radius:50%}
.ed-pal button span{font:600 11px var(--fb);color:var(--mut)}
.ed-pal button[aria-pressed=true]{border-color:var(--gold);background:var(--surf3)}
.ed-insp{display:flex;flex-direction:column;gap:8px}
.ed-insp label{display:flex;flex-direction:column;gap:4px;font:700 12px var(--fb);color:var(--mut)}
.ed-insp select{width:100%}
.ed-chk{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.ed-chk li{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:12px;background:rgba(8,15,43,.7);border:2px solid var(--lines);font:700 13px var(--fd)}
.ed-chk .dot{flex:0 0 24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 14px var(--fd);color:#06122b}
.ed-chk li.ok .dot{background:#5af0b0}.ed-chk li.no .dot{background:#ff9d5c}.ed-chk li.no{border-color:#ff9d5c}
.ed-back{position:fixed;top:calc(env(safe-area-inset-top,0px) + 12px);left:12px;z-index:7;min-height:44px}
.ed-io{position:fixed;inset:0;z-index:9;background:rgba(4,8,26,.72);display:flex;align-items:center;justify-content:center;padding:16px}
.ed-io .box{width:min(560px,100%);display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:16px;background:var(--surface);border:2px solid var(--line)}
.ed-io textarea{height:46vh;resize:vertical;border-radius:12px;border:2px solid var(--lines);background:rgba(8,15,43,.92);color:var(--ink);font:500 12px ui-monospace,SFMono-Regular,Menlo,monospace;padding:10px}
.tlink{align-self:center;pointer-events:auto}

.bar1{overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity}.bar1::-webkit-scrollbar{display:none}.bar1 .wt{flex:0 0 auto;min-width:96px;scroll-snap-align:start}

#home{flex:0 0 46px;padding:0;display:flex;align-items:center;justify-content:center}.testing #home{display:none}

.sh-top{gap:8px}.sh-top b{flex:1}
#forgeb[aria-pressed=true]{border-color:var(--gold);background:var(--surf3)}
.forging #types,.forging #slots,.forging #opts,.forging .paint,.forging #moves,.forging #check,.forging #reset{display:none!important}
#forge[hidden]{display:none}.fg-s{margin:0 0 8px;color:var(--mut);font:600 13px var(--fb)}.fg-s b{color:var(--gold)}
.fg-list{display:flex;flex-direction:column;gap:8px}.fg-it{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:14px;border:2px solid var(--lines);background:rgba(8,15,43,.85)}.fg-it.lock{opacity:.55}
.fg-t{display:flex;flex-direction:column;gap:2px}.fg-t b{font:700 15px var(--fd)}.fg-t span{font:600 12px var(--fb);color:var(--mut)}.fg-t .fg-n{color:var(--gold)}.fg-b{display:flex;gap:6px}.fg-b .ctl{flex:1}
.ctl.sm{min-height:38px;padding:0 10px;font-size:13px}
.ctl:disabled{opacity:.45}
.mp{position:fixed;left:0;right:0;bottom:0;max-height:60vh;overflow:auto;padding:14px 12px calc(env(safe-area-inset-bottom,0px) + 14px);background:rgba(16,26,68,.97);border-top:2px solid var(--gold);border-radius:20px 20px 0 0;box-shadow:0 -16px 40px rgba(2,6,28,.6);z-index:6;display:flex;flex-direction:column;gap:8px}
.mp[hidden]{display:none}.mp-h{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.mp-h b{display:block;font:800 18px var(--fd)}.mp-k{font:800 11px var(--fd);letter-spacing:.08em;text-transform:uppercase;color:var(--gold)}
.mp p{margin:0;font:600 13px var(--fb);color:var(--mut)}.mp-slot{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:12px;border:2px dashed var(--line);background:rgba(8,15,43,.7)}
.mp-sn{display:flex;justify-content:space-between;gap:8px}.mp-sn b{font:700 14px var(--fd)}.mp-sn span{font:600 13px var(--fb);color:var(--gold)}.mp-sb{display:flex;flex-wrap:wrap;gap:6px}.mp-sb .ctl{flex:1 1 auto}
.mp-row{display:flex;gap:8px}.mp-row .ctl{flex:1}.mp-bin{font:600 12px var(--fb)!important;color:var(--mut)}
.mr{display:flex;flex-direction:column;gap:10px}.mr[hidden]{display:none}
.editing #mp,.editing #mr,.building #mp{display:none!important}

#snd,#zoom{flex:0 0 46px;padding:0;display:flex;align-items:center;justify-content:center;gap:2px}
#snd .x{display:none}#snd.off .x{display:inline}#snd.off .w{display:none}
#zoom{flex-direction:column}.zd{display:flex;gap:3px}.zd i{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.3)}.zd i.on{background:var(--gold)}
#found{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.belt-b{position:fixed;left:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 104px);width:58px;height:58px;border-radius:50%;border:3px solid var(--gold);background:rgba(16,26,68,.95);display:flex;align-items:center;justify-content:center;z-index:4;box-shadow:0 6px 16px rgba(2,6,28,.5);cursor:pointer}
.belt-b svg{width:32px;height:32px}.belt-b.nudge{animation:nudge .5s 2}
@keyframes nudge{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
.belt{position:fixed;left:78px;bottom:calc(env(safe-area-inset-bottom,0px) + 100px);display:flex;gap:6px;padding:6px;border-radius:16px;background:rgba(16,26,68,.97);border:2px solid var(--line);z-index:5;box-shadow:0 10px 24px rgba(2,6,28,.5)}
.belt[hidden]{display:none}
.belt button{width:66px;min-height:66px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-radius:12px;border:2px solid var(--lines);background:rgba(8,15,43,.9);color:var(--ink);font:700 10px var(--fb);cursor:pointer}
.belt button svg{width:30px;height:30px}.belt button[aria-pressed=true]{border-color:var(--gold);background:var(--surf3)}
.titled .belt-b,.titled .belt,.building .belt-b,.building .belt,.editing .belt-b,.editing .belt{display:none!important}

.crbtn{border-color:#a78bff!important;background:linear-gradient(180deg,#3a2c8a,#22337e)!important}
.creating .ed:not(.cr){display:none!important}
.testing #cr{display:none!important}
.cr{gap:7px}.cr-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none;-webkit-overflow-scrolling:touch}.cr-chips::-webkit-scrollbar{display:none}
.crc{flex:0 0 auto;min-height:38px;padding:0 12px;border-radius:999px;border:2px solid var(--lines);background:rgba(8,15,43,.9);color:var(--ink);font:700 13px var(--fb);white-space:nowrap;cursor:pointer}
#cr-mic{flex:0 0 46px;padding:0;display:flex;align-items:center;justify-content:center}#cr-mic.on{border-color:var(--coral,#ff9d5c);background:rgba(255,157,92,.25)}
.cr-say{margin:0 0 8px;padding:10px 12px;border-radius:12px;background:rgba(167,139,255,.16);border:2px solid rgba(167,139,255,.5);font:700 14px var(--fb);color:var(--ink)}
.cr-cards{list-style:none;margin:0 0 6px;padding:0;display:flex;flex-direction:column;gap:5px}.cr-cards li{padding:7px 10px;border-radius:10px;background:rgba(8,15,43,.7);border:1px solid var(--lines);font:600 13px var(--fb);color:var(--mut)}.cr-cards b{color:var(--gold);margin-right:6px}
.cr-code{margin:6px 0 0;padding:8px;border-radius:10px;background:#06102a;color:#bfe0ff;font:500 11px ui-monospace,Menlo,monospace;white-space:pre-wrap;max-height:160px;overflow:auto}

.wt.lab{border-color:#a78bff}.mp-stat{margin:0;font:700 14px var(--fb);color:var(--ink);line-height:1.5}.mp-row .ctl[hidden]{display:none}

.cgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin:2px 0}.cg{min-height:46px;border-radius:10px;border:2px solid var(--lines);background:rgba(8,15,43,.9);color:var(--ink);font:800 22px var(--fd);cursor:pointer}.cg.on{border-color:var(--gold);color:var(--gold)}.cg:disabled{opacity:.7;cursor:default}
.cprog{display:flex;gap:5px}.cp{flex:1;min-height:42px;border-radius:10px;border:2px dashed var(--line);background:rgba(8,15,43,.85);color:var(--ink);font:700 12px var(--fd)}.cp:not(:disabled){border-style:solid;border-color:var(--sky)}.cp.bad{border-color:#ff5a4d;background:rgba(255,90,77,.2)}
.pseq{display:flex;gap:5px;flex-wrap:wrap}.pseq span{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font:800 15px var(--fd);border:2px solid rgba(255,255,255,.5)}.pseq span.q{background:rgba(8,15,43,.9);border:2px solid var(--gold);color:var(--gold)}
</style>
</head>
<body>
<canvas id="c" aria-label="ToyVentor World. Tap the ground to walk, tap bolts to unscrew them, and use the move buttons."></canvas>
<div class="bar bar1" role="tablist" aria-label="Worlds"><button class="wt" role="tab" data-w="garden" type="button">Garden</button><button class="wt" role="tab" data-w="sky" type="button">Sky Meadow</button><button class="wt" role="tab" data-w="junk" type="button">Junkyard</button><button class="wt" role="tab" data-w="beach" type="button">Beach</button><button class="wt" role="tab" data-w="snow" type="button">Snow Peak</button><button class="wt" role="tab" data-w="room" type="button">Toy Room</button><button class="wt lab" role="tab" data-w="lab1" type="button">Lab 1</button><button class="wt lab" role="tab" data-w="lab2" type="button">Lab 2</button><button class="wt lab" role="tab" data-w="lab3" type="button">Lab 3</button><button class="wt lab" role="tab" data-w="lab4" type="button">Lab 4</button><button class="wt lab" role="tab" data-w="lab5" type="button">Lab 5</button><button class="wt lab" role="tab" data-w="lab6" type="button">Lab 6</button></div>
<div class="bar bar2"><button class="ctl" id="home" type="button" aria-label="Home"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10.5V20h12v-9.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M10 20v-5h4v5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg></button><button class="ctl primary" id="build" type="button">Build</button><button class="ctl" id="zoom" type="button" aria-label="Zoom: Close"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15 15 L20 20" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg><span class="zd"><i></i><i></i><i></i></span></button><span class="chip grow" id="found">Found 0 of 15</span><button class="ctl" id="snd" type="button" aria-pressed="true" aria-label="Sound on"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9 h4 l5 -4 v14 l-5 -4 h-4 z" fill="currentColor"/><path class="w" d="M16 8.5 a5 5 0 0 1 0 7 M18.5 6 a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="x" d="M16.5 9.5 l5 5 M21.5 9.5 l-5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></div>
<p class="how">Tap or hold anywhere to walk, and drag to steer. A move walks you to the nearest hidden part it can find. Tap a junk machine to unscrew it.<span class="kb"> Keys: arrows to walk, 1 to 4 for moves, E to unscrew, B to build.</span></p>
<div class="tray" id="tray"></div>
<button class="belt-b" id="beltb" type="button" aria-label="Tool belt" aria-expanded="false"><span id="belt-ic"></span></button><div class="belt" id="belt" hidden role="group" aria-label="Tool belt"></div>
<div class="sheet" id="sheet" hidden role="dialog" aria-label="Build your toy">
<div class="sh-top"><b id="sh-ti">Build your toy</b><button class="ctl" id="forgeb" type="button" aria-pressed="false">Forge</button><button class="ctl primary" id="done" type="button">Done</button></div>
<div id="forge" hidden></div>
<div class="chips" id="types"></div>
<div class="chips" id="slots"></div>
<div class="opts" id="opts"></div>
<div class="paint"><div id="seg"></div><div id="sw"></div></div>
<div id="moves"></div>
<div class="check" id="check"></div>
<button class="link" id="reset" type="button">Reset hidden parts</button>
</div>
<div class="title" id="title"><div class="logo">ToyVentor<span>World</span></div><p class="tag">Build it. Play it. Make it real.</p><p class="toy-tag" id="toy-tag" hidden></p><div class="tbtns"><button class="ctl primary big" id="play" type="button">Play</button><button class="ctl big" id="tbuild" type="button">Build first</button><button class="ctl big crbtn" id="tcreate" type="button">Create a world</button><button class="link tlink" id="tlab" type="button">STEM Playground</button><button class="link tlink" id="tedit" type="button">Level editor</button></div></div>
<div class="pcard" id="pcard" hidden role="status"><div class="pc-ic" id="pc-ic"></div><div class="pc-t"><b id="pc-n"></b><span id="pc-m"></span></div><div class="pc-b"><button class="ctl primary" id="pc-try" type="button">Try it</button><button class="ctl" id="pc-x" type="button">Keep exploring</button></div></div>
<div class="mp" id="mp" hidden role="region" aria-label="Mission"><div class="mp-h"><div><span class="mp-k">Mission</span><b id="mp-t"></b></div><button class="ctl sm" id="mp-x" type="button">Later</button></div><p id="mp-g"></p><div id="mp-slots"></div><div class="mp-row"><button class="ctl primary" id="mp-go" type="button">Test it</button><button class="ctl" id="mp-forge" type="button">Forge parts</button></div><p class="mp-bin" id="mp-bin"></p></div>
<div class="pcard mr" id="mr" hidden role="status"><div class="pc-t"><b>Mission complete!</b><span id="mr-l"></span></div><div class="pc-b"><button class="ctl primary" id="mr-f" type="button">Open the Forge</button><button class="ctl" id="mr-x" type="button">Keep exploring</button></div></div>
<div class="intro" id="intro" aria-live="polite"><b id="in-n"></b><span id="in-s"></span></div>
<div class="ed" id="ed" hidden role="region" aria-label="Level editor">
<div class="ed-row"><b class="grow">Level editor</b><button class="ctl primary" id="ed-play" type="button">Play it</button><button class="ctl" id="ed-exit" type="button">Exit</button></div>
<div class="ed-row"><input id="ed-name" class="grow" aria-label="Level name" maxlength="40"><select id="ed-theme" aria-label="Theme"><option value="garden">Garden</option><option value="sky">Sky Meadow</option><option value="junk">Junkyard</option><option value="beach">Beach</option><option value="snow">Snow Peak</option><option value="room">Toy Room</option></select><select id="ed-new" aria-label="Start a new level"><option value="">New…</option><option value="blank:garden">Blank Garden</option><option value="blank:sky">Blank Sky Meadow</option><option value="blank:junk">Blank Junkyard</option><option value="blank:beach">Blank Beach</option><option value="blank:snow">Blank Snow Peak</option><option value="blank:room">Blank Toy Room</option><option value="copy:garden">Copy of Garden</option><option value="copy:sky">Copy of Sky Meadow</option><option value="copy:junk">Copy of Junkyard</option><option value="copy:beach">Copy of Beach</option><option value="copy:snow">Copy of Snow Peak</option><option value="copy:room">Copy of Toy Room</option></select></div>
<div class="ed-row"><button class="ctl" id="ed-undo" type="button">Undo</button><button class="ctl" id="ed-redo" type="button">Redo</button><button class="ctl" id="ed-zo" type="button" aria-label="Zoom out">−</button><button class="ctl" id="ed-zi" type="button" aria-label="Zoom in">+</button><button class="ctl" id="ed-export" type="button">Export</button><button class="ctl" id="ed-import" type="button">Import</button></div>
<div class="ed-row" id="ed-tabs" role="group" aria-label="Editor panels"><button class="ctl" type="button" data-tab="spots">Hiding spots</button><button class="ctl" type="button" data-tab="props">Scenery</button><button class="ctl" type="button" data-tab="checks">Checks</button></div>
<div class="ed-body" id="ed-body"></div>
</div>
<div class="ed cr" id="cr" hidden role="region" aria-label="Create a world">
<div class="ed-row"><b class="grow">Create a world</b><button class="ctl primary" id="cr-play" type="button">Play it</button><button class="ctl" id="cr-exit" type="button">Exit</button></div>
<div class="ed-row"><input id="cr-in" class="grow" maxlength="160" placeholder="Tell me your world…" aria-label="Describe your world"><button class="ctl" id="cr-mic" type="button" aria-label="Speak"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></div>
<div class="cr-chips" id="cr-chips" role="group" aria-label="Picture words"></div>
<div class="ed-row"><button class="ctl primary" id="cr-make" type="button">Make it!</button><button class="ctl" id="cr-undo" type="button">Go back</button><button class="ctl" id="cr-keep" type="button">Keep it</button></div>
<div class="ed-body"><p class="cr-say" id="cr-say" aria-live="polite"></p><ul class="cr-cards" id="cr-cards"></ul><button class="link" id="cr-code-t" type="button">Show the code</button><pre class="cr-code" id="cr-code" hidden></pre></div>
</div>
<button class="ctl primary ed-back" id="ed-back" type="button" hidden>Back to editor</button>
<div class="ed-io" id="ed-io" hidden role="dialog" aria-label="Level file"><div class="box"><b id="ed-io-t">Level file</b><textarea id="ed-txt" spellcheck="false" aria-label="Level file"></textarea><div class="ed-row"><button class="ctl primary" id="ed-copy" type="button">Copy</button><button class="ctl primary" id="ed-load" type="button">Import</button><button class="ctl" id="ed-close" type="button">Close</button></div></div></div>
<div id="fade"></div>
<div class="toast" id="toast" role="status"></div><div class="bubble" id="bub"></div>
<div class="load" id="load">Loading the worlds…</div>
''' + scripts(three_src) + '''
''' + engine + '''
</script>
</body>
</html>'''
open(os.path.join(OUT, "ToyVentor-World.html"), "w").write(page("https://cdn.jsdelivr.net/npm/three@%s/" % THREE_VERSION))
open(os.path.join(TEST_OUT, "test-25v2.html"), "w").write(page("file:///tmp/shot/node_modules/three/"))
print("built; em dashes:", engine.count("\u2014"))
