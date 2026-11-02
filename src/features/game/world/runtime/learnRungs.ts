import { PACK_CAR_RECIPE, TIDY_ONE_THING_RECIPE, stepsFromCarry } from "./level2Recipes";

// Panel content for carousel rungs with no in-world lab mission
// (carousel spec §10.2 new ids: little.*, early.*, daily.*,
// gears.ratio, gears.gearbox, circuits.series). Each rung is a short
// sequence of pick-one steps played in the MissionPanel (C2); C3+
// converts the little/early/daily rungs to world-first play. Pure
// data: world.ts drives the steps through the normal mission
// attempts/win instrumentation, so scoring needs no special case.

export interface LearnStep {
  /** What the panel asks. */
  say: string;
  choices: [string, string, string];
  /** Index of the right choice. */
  answer: 0 | 1 | 2;
  /** Said when a different choice is picked. */
  hint: string;
}

export interface LearnRungDef {
  missionId: string;
  title: string;
  goal: string;
  steps: LearnStep[];
  /** Toast when the last step lands. */
  winText: string;
}

const s = (
  say: string,
  choices: [string, string, string],
  answer: 0 | 1 | 2,
  hint: string,
): LearnStep => ({ say, choices, answer, hint });

const d = (
  missionId: string,
  title: string,
  goal: string,
  steps: LearnStep[],
  winText: string,
): LearnRungDef => ({ missionId, title, goal, steps, winText });

export const LEARN_RUNGS: LearnRungDef[] = [
  // --- Little ones (ages 2-3): one idea per step, big friendly picks ---
  d("little.pop", "Pop the bubbles", "Pop every bubble. Big ones first!", [
    s("Which bubble is the biggest?", ["Tiny bubble ·", "BIG bubble ●", "Little bubble ∘"], 1, "Look for the bubble that takes up the most room."),
    s("Pop! Which bubble is left now?", ["The tiny one ·", "No bubbles", "A square"], 0, "One little bubble is still floating."),
  ], "Pop, pop! Every bubble is popped."),
  d("little.animals", "Animal friends", "Say hello to the animals.", [
    s("Who says moo?", ["🐮 Cow", "🐶 Dog", "🐱 Cat"], 0, "Moo comes from the farm animal with patches."),
    s("Who can fly?", ["🐟 Fish", "🐦 Bird", "🐢 Turtle"], 1, "Wings help this animal fly."),
    s("Who hops?", ["🐌 Snail", "🐸 Frog", "🐙 Octopus"], 1, "Hop, hop! This animal jumps with big legs."),
  ], "Hello, animal friends!"),
  // level/2: steps generated from the carry recipe (runtime/level2Recipes.ts) so panel and primitive agree.
  d("little.pack", "Pack the car", PACK_CAR_RECIPE.card.goal, stepsFromCarry(PACK_CAR_RECIPE.interaction.params), "All packed. Beep beep, off we go!"),
  d("little.peek", "Peekaboo", "Find who is hiding.", [
    s("Someone is hiding behind the bush. Who is it?", ["🐰 Bunny ears", "🪨 Just a rock", "Nothing there"], 0, "Two long ears are poking out at the top."),
    s("Peekaboo! The bunny is…", ["Asleep", "Hiding still", "Here! 🙈➡️🐰"], 2, "Peekaboo means: now you see me!"),
  ], "Peekaboo! You found the bunny."),
  d("little.gogo", "Go, car, go!", "Help the little car go.", [
    s("The light is green. What does the car do?", ["Stop", "GO! 🚗💨", "Sleep"], 1, "Green means go!"),
    s("Uh oh, a duck is crossing. What now?", ["Go faster", "Beep loudly", "Stop and wait 🦆"], 2, "Cars wait and let the duck cross safely."),
  ], "Go, car, go! You drove safely."),
  d("little.tidy", "Tidy one thing", TIDY_ONE_THING_RECIPE.card.goal, stepsFromCarry(TIDY_ONE_THING_RECIPE.interaction.params), "Tidy! One thing at a time is how tidying works."),
  // --- Early learning (ages 3-4) ---
  d("early.colors", "Colors", "Name the colors.", [
    s("What color is a banana?", ["🔵 Blue", "🟡 Yellow", "🟣 Purple"], 1, "Bananas are the color of sunshine."),
    s("What color is grass?", ["🟢 Green", "⚫ Black", "🟠 Orange"], 0, "Grass and leaves share this color."),
    s("Red and blue mixed together make…", ["🟢 Green", "🟣 Purple", "⚪ White"], 1, "Try it with paint: red + blue makes a grape color."),
  ], "Colors mastered. Rainbows beware!"),
  d("early.numbers", "Numbers", "Count with me.", [
    s("How many apples? 🍎🍎🍎", ["2", "3", "5"], 1, "Count slowly: one, two…"),
    s("What number comes after 4?", ["3", "6", "5"], 2, "Count up: 1, 2, 3, 4, …"),
    s("How many wheels does a car have?", ["4", "2", "8"], 0, "Two at the front and two at the back."),
  ], "Counting star! Numbers are yours."),
  d("early.words", "Words", "Words name the world.", [
    s("Which word is an animal?", ["Run", "Cat", "Blue"], 1, "One of these is a furry friend with whiskers."),
    s("Which word tells something you DO?", ["Jump", "Table", "Happy"], 0, "Doing words are actions. You can DO this one."),
  ], "Word wizard! Every word has a job."),
  d("early.phrases", "Phrases", "Put words together.", [
    s("Finish it: “The dog is…”", ["…sleeping 😴", "…banana the", "…up down"], 0, "Pick the ending that makes sense."),
    s("Which one says what you want, kindly?", ["GIMME THAT!", "Please may I have it?", "Mine. Now."], 1, "Kind words use “please.”"),
  ], "Lovely talking! Phrases unlocked."),
  // --- Daily life (in-game practice; real-life routines stay separate) ---
  d("daily.wash", "Wash hands", "Play: wash hands like a pro.", [
    s("Hands are muddy. What is first?", ["Dry them", "Wet them + soap 🧼", "Shake them"], 1, "Soap needs water to make bubbles."),
    s("How long do we scrub?", ["1 second", "Sing a short song 🎵", "All day"], 1, "Scrub while you sing, about 20 seconds."),
    s("All bubbly! What is last?", ["More mud", "Rinse + dry", "Touch the bin"], 1, "Rinse the bubbles away, then dry."),
  ], "Squeaky clean! Soap + water + song = clean hands."),
  d("daily.brush", "Brush teeth", "Play: brush every tooth.", [
    s("What goes on the brush?", ["Jam", "A pea of toothpaste", "Glitter"], 1, "Just a pea-sized blob is plenty."),
    s("Which teeth get brushed?", ["Only the front", "Only one", "All of them 🦷"], 2, "Back teeth hide snacks too. Brush them all."),
  ], "Sparkly teeth! Brush, brush, shine."),
  d("daily.dress", "Get dressed", "Play: get dressed in order.", [
    s("What goes on first?", ["Shoes", "Underwear + clothes", "Hat"], 1, "Clothes first, then everything else."),
    s("It is raining. What else do we need?", ["Swimsuit", "Sunglasses", "Rain coat 🌧️"], 2, "Dress for the weather outside."),
  ], "Dressed and ready for the day!"),
  d("daily.toys", "Clean up toys", "Play: every toy goes home.", [
    s("Blocks are everywhere. Where do they live?", ["Toy box 🧺", "Under the rug", "In the sink"], 0, "Toys sleep in the toy box."),
    s("One doll is left. Are we done?", ["Yes, close enough", "Not yet — doll goes home too", "Hide it"], 1, "Clean-up is done when everything is home."),
  ], "All toys home. The floor says thank you!"),
  d("daily.tidy", "Tidy the room", "Play: make the whole room tidy.", [
    s("The room is messy. Best first step?", ["Shove it in a closet", "Sort: one kind at a time", "Close the door"], 1, "Sorting one kind at a time makes it easy."),
    s("Books, clothes, toys are mixed. Sorting means…", ["Same kinds together", "Biggest on top", "Hide the small stuff"], 0, "Groups of the same kind are easy to put away."),
  ], "Room tidied! Sorting is a superpower."),
  d("daily.cook", "Help cook", "Play: help make a snack.", [
    s("Before cooking, what do good chefs do?", ["Wash hands 🧼", "Taste everything raw", "Run around"], 0, "Clean hands keep food safe."),
    s("The recipe says 2 spoons of flour. That means…", ["Any amount", "Count: 1 spoon, 2 spoons", "The whole bag"], 1, "Recipes count so the snack turns out right."),
    s("The oven is hot. Who opens it?", ["Me, quickly", "The cat", "A grown-up"], 2, "Hot things are a grown-up job. Always."),
  ], "Top chef helper! Measure, count, stay safe."),
  d("daily.meal", "Family meal", "Play: share a meal together.", [
    s("Everyone is at the table. Nice first words?", ["“Mine!”", "“Thank you for dinner”", "Silence forever"], 1, "Thanking the cook makes meals happy."),
    s("You want more peas. How do you ask?", ["Grab the bowl", "“More peas, please”", "Point and shout"], 1, "Asking with please works wonders."),
  ], "What a lovely meal together!"),
  d("daily.clean", "Clean up after meals", "Play: your mess, your clean-up.", [
    s("Dinner is done. Your plate goes…", ["On the floor", "Left on the table", "To the sink 🍽️"], 2, "Plates travel to the sink after meals."),
    s("Crumbs spilled! What now?", ["Wipe them up 🧽", "Blow them away", "Pretend not to see"], 0, "A quick wipe makes it clean again."),
  ], "Clean-up hero! The kitchen sparkles."),
  // --- Banded extras with no lab equivalent ---
  d("gears.ratio", "Exact ratio", "Pick gears to hit the exact speed.", [
    s("A 12-tooth gear drives a 24-tooth gear. The big gear turns…", ["Twice as fast", "Half as fast", "The same speed"], 1, "More teeth on the driven gear means slower turning: 12/24 = 1/2."),
    s("You need the output 3× faster. Driver 30 teeth needs a driven gear of…", ["10 teeth", "30 teeth", "90 teeth"], 0, "Speed multiplies by driver÷driven: 30÷10 = 3."),
    s("Two meshing gears always turn…", ["The same way", "Opposite ways", "One stops"], 1, "Meshing teeth flip the direction every mesh."),
  ], "Exact! Gear ratios are just tooth counts divided."),
  d("gears.gearbox", "Gearbox", "Chain gears to trade speed for strength.", [
    s("A gearbox with two 2:1 stages in a row gives…", ["2× slower", "4× slower, 4× stronger", "No change"], 1, "Stages multiply: 2 × 2 = 4."),
    s("A heavy gate needs lifting. Best gearbox pick?", ["Fast + weak", "Slow + strong", "No gears"], 1, "Slow and strong wins for heavy loads — like the lift."),
  ], "Gearbox built! Slow gears, mighty muscles."),
  d("circuits.series", "Series or parallel", "Wire lamps so they all shine.", [
    s("Two lamps in series share one loop. If one breaks…", ["Both go out", "One stays on", "Both get brighter"], 0, "Series is one path: a break stops everything."),
    s("Two lamps in parallel each get their own loop. If one breaks…", ["Both go out", "The other stays on", "The battery breaks"], 1, "Parallel gives each lamp its own path home."),
    s("House lights are wired in parallel so that…", ["All fail together", "Each works on its own", "They share one switch"], 1, "That is why one dead bulb never darkens the house."),
  ], "Series and parallel sorted. Bright work!"),
];

export const learnRungDef = (missionId: string): LearnRungDef | undefined =>
  LEARN_RUNGS.find((def) => def.missionId === missionId);
