// Static world catalogue for the native runtime (5A Unit 2).
//
// Part catalog, world/mission tables, and pure part helpers lifted verbatim
// from runtime/world.ts. No live state here: everything exported is built
// once at import time and never mutated afterwards (PART/BYSLOT freeze after
// the ROWS build below).
//
// NOTE: this module is type-checked. The tables below rely on inference;
// only the part registry and helper signatures are annotated.

/* ---------- data ---------- */
export var LOOK={n:"Looks only",m:"no move",c:"#8a96c8"};
export var STATS={speed:{n:"Speed",m:"Dash",c:"#52b7ff"},spin:{n:"Spin",m:"Whirl",c:"#ffd24d"},glow:{n:"Glow",m:"Glow pulse",c:"#5af0b0"},torque:{n:"Torque",m:"Shove",c:"#a78bff"}};
export interface ToyTypeDef {
  n: string;
  slots: string[];
  sn: Record<string, string>;
}
export var TYPES: Record<string, ToyTypeDef> = {character:{n:"Character",slots:["base","eyes","ears","hat","back","tail","prop","boots"],sn:{base:"Head",eyes:"Face",ears:"Ears",hat:"Crown",back:"Back",tail:"Tail",prop:"Hand",boots:"Boots"}},robot:{n:"Robot",slots:["head","torso","arms","legs","top"],sn:{head:"Head",torso:"Torso",arms:"Arms",legs:"Legs",top:"Top"}},vehicle:{n:"Vehicle",slots:["chassis","wheels","shell","front","rear"],sn:{chassis:"Chassis",wheels:"Wheels",shell:"Shell",front:"Front",rear:"Rear"}}};
export var UI_TYPES=["character","vehicle"];
export var ROBOT_TO_KIP: Record<string, { slot: string }> = {"robot.head.box":{slot:"base"},"robot.head.dome":{slot:"base"},"robot.head.cams":{slot:"base"},"robot.head.tv":{slot:"base"},"robot.head.visor":{slot:"base"},"robot.top.antenna":{slot:"hat"},"robot.top.siren":{slot:"hat"},"robot.top.gearcrown":{slot:"hat"},"robot.top.radar":{slot:"hat"},"robot.top.bulb":{slot:"hat"},"robot.torso.box":{slot:"back"},"robot.torso.tank":{slot:"back"},"robot.torso.barrel":{slot:"back"},"robot.torso.core":{slot:"back"},"robot.torso.jet":{slot:"back"},"robot.arms.claws":{slot:"prop"},"robot.arms.hands":{slot:"prop"},"robot.arms.tools":{slot:"prop"},"robot.arms.magnets":{slot:"prop"},"robot.arms.propellers":{slot:"prop"},"robot.legs.walkers":{slot:"boots"},"robot.legs.treads":{slot:"boots"},"robot.legs.wheels":{slot:"boots"},"robot.legs.springs":{slot:"boots"},"robot.legs.hover":{slot:"boots"}};
export var KIP_BASE_LABELS: Record<string, string> = {"character.base.creature":"Kip Classic","character.base.vinyl":"Critter Pal","character.base.block":"Explorer Kid"};
export var WN={garden:"the Garden",sky:"Sky Meadow",junk:"the Junkyard",beach:"the Beach",snow:"Snow Peak",room:"the Toy Room"};
export var ROWS: [string, string, string, string, string, string, string][] = [["character","base","creature","Creature Pal","Snap","spin",""],["character","base","vinyl","Vinyl Pal","Snap","glow",""],["character","base","block","Figure Pal","Pro","torque",""],
["character","eyes","big","Big eyes","Snap","glow",""],["character","eyes","sleepy","Sleepy eyes","Snap","torque","snow"],["character","eyes","happy","Happy eyes","Snap","speed",""],["character","eyes","cyclops","One big eye","Snap","spin",""],["character","eyes","sparkle","Sparkle eyes","Snap","glow","sky"],
["character","ears","horns","Horns","Snap","torque",""],["character","ears","bear","Bear ears","Snap","torque","snow"],["character","ears","cat","Cat ears","Snap","speed",""],["character","ears","bunny","Bunny ears","Snap","spin",""],["character","ears","antennae","Antennae","Snap","glow","garden"],["character","ears","none","No ears","Snap","none",""],
["character","hat","none","No hat","Snap","none",""],["character","hat","wizard","Wizard hat","Snap","glow",""],["character","hat","crown","Crown","Snap","glow","room"],["character","hat","propcap","Propeller cap","Snap","spin",""],["character","hat","cap","Cap","Snap","speed","beach"],["character","hat","flower","Flower crown","Snap","glow","garden"],
["character","back","none","Nothing","Snap","none",""],["character","back","backpack","Backpack","Snap","torque",""],["character","back","jetpack","Jetpack","Snap","speed","room"],["character","back","cape","Cape","Snap","speed","garden"],["character","back","wings","Wings","Snap","speed","sky"],
["character","tail","curly","Curly tail","Snap","spin",""],["character","tail","fox","Fox tail","Snap","speed",""],["character","tail","dragon","Dragon tail","Snap","torque",""],["character","tail","puff","Puff tail","Snap","glow","beach"],["character","tail","none","No tail","Snap","none",""],

["robot","head","box","Box head","Snap","glow",""],["robot","head","dome","Dome head","Snap","glow",""],["robot","head","cams","Twin cams","Snap","spin","sky"],
["robot","torso","box","Box torso","Snap","torque",""],["robot","torso","tank","Tank torso","Pro","torque",""],["robot","torso","barrel","Barrel torso","Snap","speed","junk"],
["robot","arms","claws","Claws","Pro","torque",""],["robot","arms","hands","Hands","Snap","speed",""],["robot","arms","tools","Tools","Pro","spin","junk"],
["robot","legs","walkers","Walkers","Pro","speed",""],["robot","legs","treads","Treads","Pro","torque",""],["robot","legs","wheels","Wheels","Snap","speed","junk"],
["robot","top","antenna","Antenna","Snap","glow",""],["robot","top","siren","Siren","Snap","glow",""],["robot","top","gearcrown","Gear crown","Pro","spin","sky"],
["vehicle","chassis","car","Car chassis","Snap","speed",""],["vehicle","chassis","truck","Truck chassis","Snap","torque",""],["vehicle","chassis","buggy","Buggy chassis","Snap","speed","sky"],
["vehicle","wheels","small","Small wheels","Snap","spin",""],["vehicle","wheels","big","Big wheels","Snap","torque",""],["vehicle","wheels","tread","Tread","Pro","torque","junk"],
["vehicle","shell","sedan","Sedan shell","Snap","glow",""],["vehicle","shell","open","Open cab","Snap","speed","room"],["vehicle","shell","bubble","Bubble shell","Snap","glow","garden"],
["vehicle","front","bumper","Bumper","Snap","torque",""],["vehicle","front","plow","Plow","Pro","torque","snow"],["vehicle","front","lightbar","Light bar","Snap","glow","garden"],
["vehicle","rear","spoiler","Spoiler","Snap","speed",""],["vehicle","rear","booster","Booster","Snap","speed","beach"],["vehicle","rear","hook","Hook","Pro","torque","junk"],
["robot","head","tv","TV head","Snap","glow","room"],["robot","head","visor","Visor helmet","Pro","speed",""],
["robot","torso","core","Core torso","Snap","glow","snow"],["robot","torso","jet","Jet torso","Pro","speed",""],
["robot","arms","magnets","Magnets","Snap","torque",""],["robot","arms","propellers","Propellers","Snap","spin","beach"],
["robot","legs","springs","Spring legs","Snap","spin","snow"],["robot","legs","hover","Hover jets","Pro","speed",""],
["robot","top","radar","Radar dish","Snap","spin","beach"],["robot","top","bulb","Light bulb","Snap","glow","room"]];
export interface PartDef {
  k: string;
  t: string;
  s: string;
  id: string;
  n: string;
  l: string;
  st: string;
  w: string;
}
export var PART: Record<string, PartDef> = {},
  BYSLOT: Record<string, string[]> = {},
  HIDDEN = 0;
export function key(t: string, s: string, i: string): string {
  return t + "." + s + "." + i;
}
ROWS.forEach(function(r){var k=key(r[0],r[1],r[2]);PART[k]={k:k,t:r[0],s:r[1],id:r[2],n:r[3],l:r[4],st:r[5],w:r[6]};(BYSLOT[r[0]+"."+r[1]]=BYSLOT[r[0]+"."+r[1]]||[]).push(k);if(r[6])HIDDEN++});
export var SKINS=["#ffd9bd","#f2b98c","#d8955e","#a8673f","#6e4027","#c9b8ff"];
export var PAINTS=["#ff5a4d","#ff9d5c","#ffd24d","#5af0b0","#52b7ff","#a78bff"];
export function stockSel(){return{character:{base:"creature",eyes:"big",ears:"horns",hat:"none",back:"none",tail:"curly",prop:"none",boots:"none"},robot:{head:"box",torso:"box",arms:"claws",legs:"walkers",top:"antenna"},vehicle:{chassis:"car",wheels:"small",shell:"sedan",front:"bumper",rear:"spoiler"}}}
export function stockCol(){return{c1:"#ffd24d",c2:"#52b7ff",skin:"#f2b98c"}}
export function slotPartKey(t: string, s: string, v: string): string {
  if (!v || v === "none") {
    return t === "character" && (s === "prop" || s === "boots")
      ? `character.${s}.none`
      : key(t, s, "none");
  }
  if (v.indexOf("robot.") === 0) return v;
  return key(t, s, v);
}
export function slotPartObj(t: string, s: string, v: string): PartDef {
  const k = slotPartKey(t, s, v);
  return PART[k] ?? {
    k,
    t,
    s,
    id: "none",
    n: s === "prop" ? "Empty hand" : "Classic boots",
    l: "Snap",
    st: "none",
    w: "",
  };
}
export interface OptionRow {
  k: string;
  optId: string;
  n: string;
  l: string;
  st: string;
  w: string;
}
export function slotOptionList(t: string, s: string): OptionRow[] {
  if (t !== "character") {
    return (BYSLOT[`${t}.${s}`] ?? []).map((k) => {
      const p = PART[k] as PartDef;
      return { k, optId: p.id, n: p.n, l: p.l, st: p.st, w: p.w };
    });
  }
  const out: OptionRow[] = (BYSLOT[`character.${s}`] ?? []).map((k) => {
    const p = PART[k] as PartDef;
    return { k, optId: p.id, n: KIP_BASE_LABELS[k] ?? p.n, l: p.l, st: p.st, w: p.w };
  });
  if (s === "prop" || s === "boots") {
    out.push({
      k: `character.${s}.none`,
      optId: "none",
      n: s === "prop" ? "Empty hand" : "Classic boots",
      l: "Snap",
      st: "none",
      w: "",
    });
  }
  Object.keys(ROBOT_TO_KIP).forEach((rk) => {
    const alias = ROBOT_TO_KIP[rk];
    const rp = PART[rk];
    if (alias && alias.slot === s && rp) {
      out.push({ k: rk, optId: rk, n: rp.n, l: rp.l, st: rp.st, w: rp.w });
    }
  });
  return out;
}
/* ---------- 3D part library: rigid parts on pivots ---------- */
export var INK="#1c2550";
/* ---------- worlds as recipes ---------- */
export var WORLDS: Record<string, Record<string, unknown>> = {
 garden:{n:"Garden",night:true,sky:["#060d2c","#16226a","#463f9e"],fog:0x1d2470,ground:"#2b7f70",hemi:[0x9aa8ff,0x1d5c6e,.5],sun:[0xe4e9ff,.9],hills:["#24387f","#1f3277","#1a2766"],orb:[30,26,-80,"#f4f7ff"],
  extras:{grass:"#3fb0a0",flowers:1,stones:1,fireflies:"rgba(255,244,160,1)"}},
 sky:{n:"Sky Meadow",night:false,sky:["#1f4fc0","#5d9ee8","#cfe8ff"],fog:0xbcd8f8,ground:"#a9c8f0",hemi:[0xffffff,0x9fbfe8,.7],sun:[0xfff3d6,.82],hills:["#7fb0ea","#6ea3e3","#5f95da"],orb:[34,30,-90,"#fff3b8"],
  extras:{cloudFloor:1,fireflies:"rgba(255,255,255,1)"}},
 junk:{n:"Junkyard",night:true,sky:["#0d1440","#3a3a82","#e0805c"],fog:0x3d2f5c,ground:"#2c3668",hemi:[0xffc0a0,0x2a2f5a,.45],sun:[0xffc7a0,.9],hills:["#2c2858","#24224c","#1d1b40"],orb:null,
  extras:{gravel:"#4a5590",puddles:1,fireflies:"rgba(255,170,110,1)"}}
};
/* ===== content layer: themes, hiding spots, scenery, and level files ===== */
export var THEME_DEF: Record<string, Record<string, unknown>> = {};
["garden","sky","junk"].forEach(function(k: string){
  var w = (WORLDS as Record<string, Record<string, unknown>>)[k] as Record<string, unknown>;
  var t: Record<string, unknown> = {};
  for(var f in w)if(f!=="props"&&f!=="spots"&&f!=="n")t[f]=w[f];
  THEME_DEF[k]=t
});
export interface HideDef {
  t: string;
  z: number;
  n: string;
  y?: number;
}
export var HIDE: Record<string, HideDef> = {scarecrow:{t:"junk",z:-.7,n:"Scarecrow"},kite:{t:"junk",z:-.7,n:"Kite"},oldbot:{t:"junk",z:-.7,n:"Old robot"},radio:{t:"junk",z:-.7,n:"Old radio"},snowcannon:{t:"junk",z:-.7,n:"Snow cannon"},jackbox:{t:"junk",z:-.7,n:"Jack-in-the-box"},
 bush:{t:"glow",z:-.7,n:"Dark bush"},fog:{t:"glow",z:-.6,n:"Fog bank"},pipe:{t:"glow",z:-1.2,n:"Pipe"},cave:{t:"glow",z:-.8,n:"Sea cave"},icecave:{t:"glow",z:-.8,n:"Ice cave"},bed:{t:"glow",z:-.7,n:"Under the bed"},
 rock:{t:"torque",z:-.9,n:"Rock"},cloudblock:{t:"torque",z:-.9,n:"Cloud block"},crates:{t:"torque",z:-1,n:"Crates"},beachball:{t:"torque",z:-.9,n:"Beach ball"},snowball:{t:"torque",z:-.9,n:"Snowball"},toyblocks:{t:"torque",z:-1,n:"Toy blocks"},
 branch:{t:"speed",z:-.4,y:3.75,n:"Branch"},island:{t:"speed",z:-.4,y:3.75,n:"Floating island"},crane:{t:"speed",z:-.4,y:3.75,n:"Crane"},tower:{t:"speed",z:-.4,y:3.75,n:"Lifeguard tower"},ledge:{t:"speed",z:-.4,y:3.75,n:"Ice ledge"},shelf:{t:"speed",z:-.4,y:3.75,n:"Bookshelf"},
 pond:{t:"spin",z:2,n:"Lily pond"},windmill:{t:"spin",z:-1.4,n:"Windmill"},pile:{t:"spin",z:-.8,n:"Scrap pile"},sandmound:{t:"spin",z:-.8,n:"Sand mound"},drift:{t:"spin",z:-.8,n:"Snow drift"},laundry:{t:"spin",z:-.8,n:"Sock pile"}};
export var HKIND=[["junk","Junk machine","Unscrew",["scarecrow","kite","oldbot","radio","snowcannon","jackbox"]],["glow","Dark","Glow pulse",["bush","fog","pipe","cave","icecave","bed"]],["torque","Blocked","Shove",["rock","cloudblock","crates","beachball","snowball","toyblocks"]],["speed","High","Dash",["branch","island","crane","tower","ledge","shelf"]],["spin","Covered","Whirl",["pond","windmill","pile","sandmound","drift","laundry"]]];
export interface PropDef {
  z: number;
  n: string;
  y?: number;
}
export var PROPS: Record<string, PropDef> = {lantern:{z:-1.6,n:"Lantern"},tree:{z:-4,n:"Tree"},bushes:{z:-2.5,n:"Bushes"},windmill:{z:-5.5,n:"Windmill"},cottage:{z:-16,n:"Cottage"},cloud:{z:-18,n:"Cloud"},island:{z:-15,y:6,n:"Floating island"},tire:{z:-2,n:"Tire"},drum:{z:-2.2,n:"Oil drum"},shed:{z:-12,n:"Shed"},cranebg:{z:-14,n:"Big crane"},
 palm:{z:-3,n:"Palm tree"},umbrella:{z:-2.2,n:"Beach umbrella"},sandcastle:{z:-2.6,n:"Sandcastle"},pine:{z:-4,n:"Pine tree"},snowman:{z:-2.4,n:"Snowman"},igloo:{z:-7,n:"Igloo"},lamp:{z:-3,n:"Floor lamp"},blocks:{z:-3.5,n:"Toy blocks"},books:{z:-2.6,n:"Book stack"}};
export var THEMES={garden:0,sky:1,junk:2,beach:3,snow:4,room:5},KCOL={junk:"#f4f7ff",glow:"#5af0b0",torque:"#a78bff",speed:"#52b7ff",spin:"#ffd24d"};
/* level files: each world is data in the same format the editor exports */
export interface LevelPropRef {
  type: string;
  x: number;
  z?: number;
  y?: number;
}
export interface LevelSpotRef {
  hide: string;
  part: string;
  x: number;
  z?: number;
}
export interface LevelMissionRef {
  type: string;
  x: number;
  free?: boolean;
  [k: string]: unknown;
}
export interface LevelDef {
  format: string;
  id: string;
  name: string;
  theme: string;
  props: LevelPropRef[];
  spots: LevelSpotRef[];
  missions?: LevelMissionRef[];
}
export var LEVELS: LevelDef[] = [
 {"format":"toyventor.level/1","id":"garden","name":"Garden","theme":"garden","props":[{"type":"lantern","x":3},{"type":"lantern","x":17,"z":-1.7},{"type":"lantern","x":32},{"type":"lantern","x":38.2},{"type":"windmill","x":23},{"type":"cottage","x":33},{"type":"tree","x":-4},{"type":"bushes","x":44}],
  "spots":[{"part":"character.hat.flower","hide":"scarecrow","x":6},{"part":"character.ears.antennae","hide":"bush","x":13},{"part":"character.back.cape","hide":"rock","x":20},{"part":"vehicle.front.lightbar","hide":"branch","x":28.9},{"part":"vehicle.shell.bubble","hide":"pond","x":36}],"missions":[{"type":"bridge","x":40.9}]},
 {"format":"toyventor.level/1","id":"sky","name":"Sky Meadow","theme":"sky","props":[{"type":"cloud","x":3,"z":-17},{"type":"cloud","x":18,"z":-20},{"type":"cloud","x":31},{"type":"cloud","x":44,"z":-19},{"type":"island","x":9},{"type":"island","x":30,"z":-20,"y":8},{"type":"island","x":44,"z":-14,"y":5}],
  "spots":[{"part":"character.back.wings","hide":"kite","x":6},{"part":"vehicle.chassis.buggy","hide":"island","x":13.9},{"part":"character.eyes.sparkle","hide":"fog","x":20},{"part":"robot.head.cams","hide":"cloudblock","x":27},{"part":"robot.top.gearcrown","hide":"windmill","x":35}]},
 {"format":"toyventor.level/1","id":"junk","name":"Junkyard","theme":"junk","props":[{"type":"tire","x":3,"z":-1.8},{"type":"tire","x":11,"z":-2.4},{"type":"drum","x":17},{"type":"tire","x":31,"z":-1.9},{"type":"shed","x":24},{"type":"cranebg","x":42},{"type":"lantern","x":23,"z":-1.8},{"type":"lantern","x":33.5,"z":-1.8}],
  "spots":[{"part":"robot.legs.wheels","hide":"oldbot","x":6},{"part":"robot.torso.barrel","hide":"crates","x":13},{"part":"robot.arms.tools","hide":"pile","x":20},{"part":"vehicle.wheels.tread","hide":"pipe","x":28},{"part":"vehicle.rear.hook","hide":"crane","x":36.9}],"missions":[{"type":"lift","x":40.6}]},
 {"format":"toyventor.level/1","id":"beach","name":"Beach","theme":"beach","props":[{"type":"palm","x":2},{"type":"umbrella","x":9.5},{"type":"sandcastle","x":16.5},{"type":"palm","x":24,"z":-4.5},{"type":"umbrella","x":32},{"type":"palm","x":40,"z":-3.6},{"type":"sandcastle","x":44}],
  "spots":[{"part":"robot.top.radar","hide":"radio","x":6},{"part":"character.hat.cap","hide":"cave","x":13},{"part":"vehicle.rear.booster","hide":"beachball","x":20},{"part":"robot.arms.propellers","hide":"tower","x":28.9},{"part":"character.tail.puff","hide":"sandmound","x":36}]},
 {"format":"toyventor.level/1","id":"snow","name":"Snow Peak","theme":"snow","props":[{"type":"pine","x":2},{"type":"pine","x":9.5,"z":-5},{"type":"snowman","x":16.5},{"type":"igloo","x":24},{"type":"pine","x":33,"z":-4.5},{"type":"pine","x":39,"z":-6},{"type":"snowman","x":43.5}],
  "spots":[{"part":"character.ears.bear","hide":"snowcannon","x":6},{"part":"robot.torso.core","hide":"icecave","x":13},{"part":"vehicle.front.plow","hide":"snowball","x":20},{"part":"robot.legs.springs","hide":"ledge","x":28.9},{"part":"character.eyes.sleepy","hide":"drift","x":36}]},
 {"format":"toyventor.level/1","id":"room","name":"Toy Room","theme":"room","props":[{"type":"lamp","x":2},{"type":"blocks","x":9.5},{"type":"books","x":16.5},{"type":"lamp","x":24,"z":-5.5},{"type":"blocks","x":32.5,"z":-4.2},{"type":"books","x":40},{"type":"lamp","x":44}],
  "spots":[{"part":"robot.head.tv","hide":"jackbox","x":6},{"part":"character.back.jetpack","hide":"bed","x":13},{"part":"vehicle.shell.open","hide":"toyblocks","x":20},{"part":"robot.top.bulb","hide":"shelf","x":28.9},{"part":"character.hat.crown","hide":"laundry","x":36}]}
];
/* ===== missions: collect scrap, forge Pro parts in the Factory, use them to solve STEM missions ===== */
export var TOOLS={beam:{n:"Beam",cost:2,d:"A straight Pro beam that spans gaps."},brace:{n:"Triangle brace",cost:2,d:"Triangles keep their shape, so a bridge stops sagging."},sgear:{n:"Small gear",cost:1,d:"Fast but weak."},bgear:{n:"Big gear",cost:3,d:"Slow but strong."},gearpair:{n:"Pro gear pair",cost:4,d:"A real gear set for your Pro toys."}};
export var MDEF={bridge:{t:"Bridge the river",goal:"Build a bridge over the river. Put parts in the slots, then press Test it.",act:"Test it",slots:[{id:"deck",n:"Deck",acc:["beam"]},{id:"support",n:"Support",acc:["brace"]}],rew:{bp:["bgear"],scrap:2,txt:"Blueprint: Big gear. You will need it in the Junkyard."}},
 lift:{t:"Gear lift",goal:"Lift the toy to the ledge. Put gears on the tower, then press Turn crank.",act:"Turn crank",slots:[{id:"mid",n:"Middle gear",acc:["sgear","bgear"]},{id:"drum",n:"Drum gear",acc:["sgear","bgear"]}],rew:{bp:["gearpair"],scrap:3,txt:"Blueprint: Pro gear pair, a real gear set you can 3D print."}}};
export var GR={sgear:.34,bgear:.66};
/* ===== tool kit: a tool belt, and fasteners that each need the right tool ===== */
export var TK={screwdriver:{n:"Screwdriver",fits:"screw",say:"It turns screws."},spanner:{n:"Spanner",fits:"bolt",say:"It turns bolts."},hammer:{n:"Claw hammer",fits:"nail",say:"Its claw pulls nails out."},drill:{n:"Drill",fits:null,say:"It makes holes for screws."}};
export var FITS={screw:"screwdriver",bolt:"spanner",nail:"hammer"},FTN={screw:"screw",bolt:"bolt",nail:"nail"};
/* zoom: Close (the old view), Mid, Far */
export var ZN=["Close","Mid","Far"];
export var CHIPS=["🌸 garden","☁️ sky","🔩 junkyard","🏖️ beach","❄️ snow","🧸 toy room","🌲 trees","⛄ snowmen","🌴 palm trees","🏰 sandcastles","💡 lanterns","🧱 toy blocks","📚 books","☁️ clouds","🕳️ a cave to hide a part","🗼 a high tower","⚽ a giant ball","🤖 a junk machine","lots of","three","more","no"];
export var TNAME={garden:"Garden",sky:"Sky Meadow",junk:"Junkyard",beach:"Beach",snow:"Snow Peak",room:"Toy Room"};
export var GATES=[{g:"OR",tag:"either plate opens it"},{g:"AND",tag:"both plates must be pressed"},{g:"NOT",tag:"the opposite: a pressed plate keeps it shut"}];
export var RIT={log:{n:"Log",b:3,w:1},barrel:{n:"Barrel",b:4,w:1},crate:{n:"Crate",b:1,w:2},rock:{n:"Rock",b:0,w:3}};
export var CSH={h:10,v:5,ne:3,es:6,sw:12,wn:9},CCY=["","h","v","ne","es","sw","wn"],CGL={"":"·",h:"─",v:"│",ne:"└",es:"┌",sw:"┐",wn:"┘"};
export var CNEED={walk:"walk",rock:"shove",gap:"dash",pile:"whirl"},CNM={walk:"Walk",shove:"Shove",dash:"Dash",whirl:"Whirl"},CON={walk:"path",rock:"rock",gap:"gap",pile:"pile"};
export var PB={red:{c:"#ff5a4d",s:"●",f:523},blue:{c:"#52b7ff",s:"▲",f:659},yellow:{c:"#ffd24d",s:"■",f:784},mint:{c:"#5af0b0",s:"★",f:880}},PR=[{seq:["red","blue","red","blue"],ans:["red"]},{seq:["yellow","yellow","mint","yellow","yellow"],ans:["mint"]},{seq:["red","blue","yellow","red","blue"],ans:["yellow","red"]},{seq:["red","blue","yellow","mint","red","blue"],ans:["mint","yellow","red"]}];
export var CWHY={"mop>crumbs":"Mopping crumbs just makes mush. Dry crumbs need the vacuum.","sponge>crumbs":"Crumbs stick to the sponge. Dry crumbs need the vacuum.","vacuum>puddle":"Vacuums are for dry things. A puddle is a liquid, so use the mop.","sponge>puddle":"The sponge fills up fast. A big puddle needs the mop.","vacuum>jam":"Jam is too sticky to suck up. Soap and water break sticky things apart.","mop>jam":"The mop just smears sticky jam. Try the soapy sponge."},CFIT={crumbs:"vacuum",puddle:"mop",jam:"sponge"},CTN={vacuum:"Vacuum",mop:"Mop",sponge:"Soapy sponge"},FXN={nail:"hammer",bolt:"spanner",screw:"screwdriver"};
THEME_DEF.beach={night:false,sky:["#2b86d6","#7cc8f2","#fff0c4"],fog:0xcfeaf6,ground:"#e3c08a",hemi:[0xffffff,0xe0c08a,.75],sun:[0xfff1d0,.95],hills:["#4fae86","#3f9c76","#8cc6e6"],orb:[34,30,-90,"#fff4c0"],extras:{sea:1,shells:1,fireflies:"rgba(255,255,255,1)"}};
THEME_DEF.snow={night:true,sky:["#06102e","#142a66","#2f4f99"],fog:0x1c2f66,ground:"#bccbea",hemi:[0xbcd0ff,0x3a4f8a,.48],sun:[0xd6e2ff,.78],hills:["#7f98cf","#6f89c4","#3f5a9c"],orb:[30,26,-80,"#f4f7ff"],extras:{snowfall:1,aurora:1}};
THEME_DEF.room={night:true,sky:["#1a1440","#2a2160","#3a2c7a"],fog:0x2a2058,ground:"#9a6a40",hemi:[0xffd7b0,0x3a2a60,.55],sun:[0xffe4c0,.85],hills:null,orb:null,extras:{wall:1,rug:1,fireflies:"rgba(255,224,170,1)"}};
export function levelWorld(L: { theme: string; name?: string; props?: LevelPropRef[]; spots?: LevelSpotRef[]; missions?: LevelMissionRef[] }): Record<string, unknown> {var b=THEME_DEF[L.theme]||THEME_DEF.garden,w: Record<string, unknown>={};for(var k in b)w[k]=b[k];w.n=L.name||"My world";w.theme=L.theme;
 w.props=(L.props||[]).filter(function(p){return PROPS[p.type]}).map(function(p){var d=PROPS[p.type] as PropDef,a=[p.type,p.x,p.z!=null?p.z:d.z];if(p.y!=null||d.y!=null)a.push(p.y!=null?p.y:(d.y as number));else if(p.type==="lantern"&&L.theme==="junk")a.push("#ff9d5c");return a});
 w.spots=(L.spots||[]).filter(function(s){return HIDE[s.hide]}).map(function(s){var h=HIDE[s.hide] as HideDef,o: { k: string; t: string; x: number; z: number; obj?: string; cover?: string; y?: number }={k:s.part,t:h.t,x:s.x,z:s.z!=null?s.z:h.z};if(h.t==="junk")o.obj=s.hide;else o.cover=s.hide;if(h.y)o.y=h.y;return o});w.missions=(L.missions||[]).slice();return w}
LEVELS.push({"format":"toyventor.level/1","id":"lab1","name":"Lab 1: Bridges","theme":"garden","props":[{"type":"lantern","x":3},{"type":"tree","x":-4},{"type":"lantern","x":17},{"type":"lantern","x":30},{"type":"bushes","x":44}],"spots":[],"missions":[{"type":"bridge","x":10,"free":true},{"type":"measure","x":23,"free":true},{"type":"balance","x":36,"free":true}]},
 {"format":"toyventor.level/1","id":"lab2","name":"Lab 2: Machines","theme":"junk","props":[{"type":"tire","x":3,"z":-1.8},{"type":"drum","x":24},{"type":"shed","x":28},{"type":"cranebg","x":20}],"spots":[],"missions":[{"type":"logic","x":15,"free":true},{"type":"lift","x":40.6,"free":true}]},
 {"format":"toyventor.level/1","id":"lab4","name":"Lab 4: Levers and Lights","theme":"snow","props":[{"type":"pine","x":2},{"type":"snowman","x":20},{"type":"pine","x":24,"z":-5},{"type":"igloo","x":41}],"spots":[],"missions":[{"type":"lever","x":12,"free":true},{"type":"circuit","x":32,"free":true}]},
 {"format":"toyventor.level/1","id":"lab5","name":"Lab 5: Code and Patterns","theme":"sky","props":[{"type":"cloud","x":3,"z":-17},{"type":"island","x":22},{"type":"cloud","x":40,"z":-19}],"spots":[],"missions":[{"type":"code","x":13,"free":true},{"type":"pattern","x":31,"free":true}]},
 {"format":"toyventor.level/1","id":"lab6","name":"Lab 6: Clean-up","theme":"room","props":[{"type":"lamp","x":3},{"type":"books","x":9},{"type":"blocks","x":30,"z":-4},{"type":"lamp","x":42}],"spots":[],"missions":[{"type":"clean","x":20,"free":true}]},
 {"format":"toyventor.level/1","id":"lab3","name":"Lab 3: Water","theme":"beach","props":[{"type":"palm","x":2},{"type":"umbrella","x":8},{"type":"palm","x":30},{"type":"sandcastle","x":36}],"spots":[],"missions":[{"type":"raft","x":16,"free":true}]});
Object.keys(WORLDS).forEach(function(k){delete WORLDS[k]});LEVELS.forEach(function(L){WORLDS[L.id]=levelWorld(L)});
