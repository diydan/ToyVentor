// What the game calls the toy PARTS that Describe & Build shows ("blue car chassis", "chasis de coche azul"). Describe & Build
// never invents a part: its matcher only picks from the 30 curated parts in parts/kip/viewer/kip-describe-parts.json, so a table
// covers it completely (tests/part-names.test.ts fails if a part id is added there without names here).
//
// Parts carry no colour of their own (a printed part is one colour chosen at print time), so the colour spoken is the one the
// exploded view DRAWS for that part, which the tab sends along as a hex. Same vocabulary rules as propNames.ts: the word order and
// the adjective agreement are built, not looked up.
//
// Forge makes free-form parts, which no table can cover. The plan for it (not built, there is no Forge screen yet): the generator
// returns its object's name in all seven languages in the same call, and the Worker signs it so /api/voice can speak it without
// becoming an open text-to-speech endpoint.
import { nounPhrase, type ColorKey, type LangCode, type Noun } from "./propNames";

const CODES = { m: ["m", false], f: ["f", false], n: ["n", false], mp: ["m", true], fp: ["f", true], np: ["n", true] } as const;
/** "f:rueda deportiva" -> a feminine noun; a trailing p means plural ("mp:brazos"). Turkish never uses the gender. */
function noun(spec: string): Noun {
  const i = spec.indexOf(":");
  const [g, pl] = CODES[spec.slice(0, i) as keyof typeof CODES];
  return pl ? { w: spec.slice(i + 1), g, pl: true } : { w: spec.slice(i + 1), g };
}

// en | es | fr | de | it | pt | tr
const TABLE: Record<string, readonly [string, string, string, string, string, string, string]> = {
  veh_car_chassis: ["m:car chassis", "m:chasis de coche", "m:châssis de voiture", "n:Auto-Chassis", "m:telaio dell'auto", "m:chassi do carro", "m:araba şasisi"],
  veh_car_hood_cover: ["m:hood", "m:capó", "m:capot", "f:Motorhaube", "m:cofano", "m:capô", "m:kaput"],
  veh_cab_roof_cover: ["m:cab roof", "m:techo de la cabina", "m:toit de cabine", "n:Kabinendach", "m:tetto della cabina", "m:teto da cabine", "m:kabin çatısı"],
  veh_truck_chassis: ["m:truck chassis", "m:chasis de camión", "m:châssis de camion", "n:Lkw-Chassis", "m:telaio del camion", "m:chassi do caminhão", "m:kamyon şasisi"],
  veh_truck_bed_cover: ["m:truck bed", "f:caja del camión", "f:benne du camion", "f:Ladefläche", "m:cassone del camion", "f:caçamba do caminhão", "m:kamyon kasası"],
  veh_scooter_frame: ["m:scooter frame", "m:cuadro del patinete", "m:cadre de trottinette", "m:Rollerrahmen", "m:telaio del monopattino", "m:quadro do patinete", "m:scooter gövdesi"],
  veh_handlebar_fork: ["m:handlebar", "m:manillar", "m:guidon", "m:Lenker", "m:manubrio", "m:guidão", "m:gidon"],
  prop_skateboard_deck: ["m:skateboard", "m:monopatín", "m:skateboard", "n:Skateboard", "m:skateboard", "m:skate", "m:kaykay"],
  shaft_tu05: ["m:axle", "m:eje", "m:essieu", "f:Achse", "m:asse", "m:eixo", "m:aks"],
  racer_axle: ["m:racer axle", "m:eje de carreras", "m:essieu de course", "f:Rennachse", "m:asse da corsa", "m:eixo de corrida", "m:yarış aksı"],
  veh_wheel_sport: ["m:sport wheel", "f:rueda deportiva", "f:roue sport", "n:Sportrad", "f:ruota sportiva", "f:roda esportiva", "m:spor tekerlek"],
  veh_wheel_offroad: ["m:off-road wheel", "f:rueda todoterreno", "f:roue tout-terrain", "n:Geländerad", "f:ruota fuoristrada", "f:roda off-road", "m:arazi tekerleği"],
  veh_wheel_moto: ["m:motorbike wheel", "f:rueda de moto", "f:roue de moto", "n:Motorradrad", "f:ruota della moto", "f:roda de moto", "m:motosiklet tekerleği"],
  racer_wheel: ["m:racing wheel", "f:rueda de carreras", "f:roue de course", "n:Rennrad", "f:ruota da corsa", "f:roda de corrida", "m:yarış tekerleği"],
  racer_spoiler: ["m:spoiler", "m:alerón", "m:aileron", "m:Spoiler", "m:alettone", "m:aerofólio", "m:spoyler"],
  racer_roof_rack: ["m:roof rack", "f:baca", "f:galerie de toit", "m:Dachgepäckträger", "m:portapacchi", "m:bagageiro", "m:tavan bagajı"],
  racer_bull_bar: ["m:bull bar", "f:defensa delantera", "m:pare-buffle", "m:Frontschutzbügel", "m:paraurti rinforzato", "m:protetor frontal", "m:ön koruma"],
  char_legs_seated: ["mp:legs", "fp:piernas", "fp:jambes", "np:Beine", "fp:gambe", "fp:pernas", "mp:bacaklar"],
  robot_torso_core: ["m:torso", "m:torso", "m:torse", "m:Oberkörper", "m:busto", "m:tronco", "m:gövde"],
  robot_arms_grabber: ["mp:arms", "mp:brazos", "mp:bras", "np:Arme", "fp:braccia", "mp:braços", "mp:kollar"],
  char_head_kid: ["m:kid head", "f:cabeza de niño", "f:tête d'enfant", "m:Kinderkopf", "f:testa da bambino", "f:cabeça de criança", "m:çocuk kafası"],
  char_head_tall: ["m:tall head", "f:cabeza alta", "f:tête haute", "m:hoher Kopf", "f:testa alta", "f:cabeça alta", "m:uzun kafa"],
  char_faceplate: ["m:face plate", "f:cara", "m:visage", "n:Gesicht", "f:faccia", "m:rosto", "m:yüz"],
  robot_legs_stomper: ["mp:robot legs", "fp:piernas de robot", "fp:jambes de robot", "np:Roboterbeine", "fp:gambe da robot", "fp:pernas de robô", "mp:robot bacakları"],
  robot_head_visor: ["m:robot head", "f:cabeza de robot", "f:tête de robot", "m:Roboterkopf", "f:testa da robot", "f:cabeça de robô", "m:robot kafası"],
  robot_back_jetpack: ["m:jetpack", "f:mochila propulsora", "m:jetpack", "m:Raketenrucksack", "m:zaino a reazione", "f:mochila a jato", "m:jet paketi"],
  hair_bob: ["m:hair", "m:pelo", "mp:cheveux", "np:Haare", "mp:capelli", "m:cabelo", "m:saç"],
  hat_cowboy: ["m:cowboy hat", "m:sombrero de vaquero", "m:chapeau de cow-boy", "m:Cowboyhut", "m:cappello da cowboy", "m:chapéu de vaqueiro", "m:kovboy şapkası"],
  hat_tophat: ["m:top hat", "m:sombrero de copa", "m:chapeau haut-de-forme", "m:Zylinder", "m:cilindro", "f:cartola", "m:silindir şapka"],
  hat_ranger: ["m:ranger hat", "m:sombrero de guardabosques", "m:chapeau de ranger", "m:Rangerhut", "m:cappello da ranger", "m:chapéu de guarda-florestal", "m:korucu şapkası"],
};

const LANG_ORDER: readonly LangCode[] = ["en", "es", "fr", "de", "it", "pt", "tr"];

export const PART_IDS: readonly string[] = Object.keys(TABLE);

export function isPartId(id: unknown): id is string {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(TABLE, id);
}

export function partNoun(id: string, lang: LangCode): Noun | null {
  const row = TABLE[id];
  const spec = row?.[LANG_ORDER.indexOf(lang)];
  return spec ? noun(spec) : null;
}

/** "blue car chassis" / "chasis de coche azul": the part and the colour the exploded view drew for it. */
export function partPhrase(id: string, color: ColorKey | null, lang: LangCode): string | null {
  const nn = partNoun(id, lang);
  return nn ? nounPhrase(nn, color, lang) : null;
}
