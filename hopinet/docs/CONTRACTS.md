> **OWNERSHIP RULE (read first):** before building, check `/home/user/Hopinet/docs/locks/<your-module>.lock`
> (module = critter, vehicles, obstacles, backdrop, props, house, audio). If that lock file already exists
> and your module is **not** `critter` or `vehicles`, another builder owns your module: do NOT touch any file,
> reply immediately with `summary: "skipped: already owned by another builder"` and empty `files`/`exports`.
> Builders that own a module create their lock file as their very first action.

# Hopinet module contracts

Hopinet is a 3D endless runner (three.js r170, ES modules, bundled with esbuild) that runs in an Android
WebView and in browsers. Sources are in `/home/user/Hopinet/web/src`. The game data (worlds, characters,
vehicles, power-ups, constants) is in `config.js`: **read it first**.

## Look and feel
Premium modern mobile-game art: stylized, smooth, rounded shapes, bold saturated colours with clean
palettes, emissive accents, soft blob shadows, tasteful detail. Not "primitive boxes": silhouettes must be
recognizable and charming. All geometry is procedural (no external files, no textures from disk; canvas
textures are fine). Everything must read well on a phone at a distance of 5-15 metres.

## Conventions
* `import * as THREE from 'three'`; add-ons from `three/examples/jsm/...` are allowed
  (e.g. `BufferGeometryUtils.mergeGeometries` to merge static parts and keep draw calls low).
* Units are metres. +Y is up. Gameplay runs toward **-Z** (the player faces -Z). Models face **-Z** and
  have their origin at the ground contact point / water line centre, unless stated otherwise.
* Lanes are at x = -2.4, 0, +2.4 (`LANES`); the road is 8.6 m wide (`ROAD_EDGE` = 5.7 from the centre
  to the kerb), a ground tile is 30 m long (`TILE`).
* From `./models.js` you may import ONLY these helpers (their names/behaviour are guaranteed stable):
  `G(key, factory)` cached geometry, `M(color, opts)` cached MeshLambertMaterial
  (`opts`: `emissive`, `ei` emissive intensity, `opacity`, `side: true` = DoubleSide, `flat`, `map`, `fog`),
  `Basic(color, opts)` cached MeshBasicMaterial (`opacity`, `blend: true` = additive, `side`, `map`, `fog`),
  `blobShadowTex()` soft round shadow texture, `sparkTex()` soft glow texture.
  You may also use `MeshStandardMaterial` / `ShaderMaterial` yourself when it clearly pays off, but keep
  everything light enough for a mid-range phone.
* Only `three`, `./config.js` and the helpers above may be imported. No network, no DOM except canvases.
* Performance budget (strict, phones!): merge static geometry per material; instance repeated things.
  Characters/vehicles: <= 100 draw calls each. Props chunk (one 30 m tile, one side): <= 20 draw calls.
  Ground tile: <= 10 draw calls. Water tile: <= 4. Backdrop total: <= 40. Home: <= 450 draw calls total.
* Dispose-free design: functions are called many times, so cache geometries/materials (`G`, `M`).
* No `Math.random()` inside per-frame update functions except for tiny cosmetic jitter.

## How to test your module (required)
Do not edit any file except your own module(s) listed in your task. Create a throw-away test page in
`/tmp/hopinet-test/<your-module>/`:
1. `entry.js` importing your module by absolute path (`/home/user/Hopinet/web/src/<module>.js`), building a
   `THREE.Scene` with a camera + lights + `WebGLRenderer`, animating a few frames and exposing
   `window.__ready = true`.
2. Bundle: `cd /home/user/Hopinet/web && node -e "require('esbuild').build({entryPoints:['/tmp/hopinet-test/<m>/entry.js'],bundle:true,format:'iife',outfile:'/tmp/hopinet-test/<m>/out.js'})"`
3. Screenshot with Playwright (`/opt/node22/lib/node_modules/playwright`), launched with args
   `['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']`.
4. Open the PNG with the Read tool and critically review it (shape, colours, proportions, clipping,
   z-fighting, anything black/empty). Iterate until it looks good. Check console errors.
The machine is shared with other builders (4 CPUs): keep tests short.

## Module APIs

### audio.js  (replaces the old file completely)
```js
export const Audio = {
  unlock(), suspend(), resume(),               // AudioContext lifecycle (unlock on first user gesture)
  setSfx(bool), setMusic(bool),
  play(name),                                  // one-shot effect, see names below
  engine(kind | null),                         // looping vehicle engine: 'car'|'boat'|'ship'|'plane'|null
  jet(bool),                                   // looping jet-pack roar
  startMusic(mode, opts),                      // mode: 'lobby'|'run'|'boss'|'map'; opts: { world: 'harbor'|'neon'|'coral'|'jungle'|'frost'|'dunes' }
  setMode(mode),                               // smoothly switch the arrangement while running (run <-> boss <-> plane <-> water)
  setIntensity(x /*0..1*/),                    // more layers/energy as speed grows (smoothed internally)
  setMuffle(x /*0..1*/),                       // HELMET: whole mix (music + sfx) gets muddy: low-pass + slight distortion, smooth
  setUnderwater(bool),                         // diving: stronger muffle + bubbly filter wobble, smooth
  stopMusic(),
  mode, ctx,                                   // current mode string; AudioContext (null before unlock)
};
```
SFX names that must exist: `coin gem jump slide land lane stumble crash powerup shieldBreak kick explode alarm
drop laugh click buy build reward fanfare tick error whoosh splash dive swim bubble mount horn cannon wave
finish star vacuum pop ring hit`.
Music: procedurally generated (no files), driving and exciting. Tempo ~140-150 BPM in runs (lobby ~110,
boss ~160), strong kick/snare/hats, punchy bass, chord stabs, arpeggios, catchy lead melody, risers/fills
every 8 bars, intensity layers (kick+bass+hats at 0; +chords; +arp; +lead; +percussion fills). Each world has
its own scale/instrumentation/groove (harbor: bright major pop; neon: synthwave minor; coral: tropical
mixolydian/steel-drum; jungle: tribal toms + pentatonic; frost: shimmering lydian bells; dunes: hijaz/phrygian
dominant with oud-like plucks and darbuka). Mix must never clip (use a compressor + limiter style master),
target about -16 dBFS RMS for music, sfx clearly audible over it. Add `Audio.analyser` (AnalyserNode on the
master output) so it can be tested objectively; verify non-silence, no NaN, no clipping, correct tempo, and that
`setMuffle(1)` lowers high-frequency energy a lot but keeps the music recognizable.

### backdrop.js
```js
export function makeBackdrop(world /*config WORLDS entry*/, opts /*{ quality:'high'|'low', lobby?:bool }*/)
   // -> THREE.Group with .userData.update(timeSeconds, camera). The caller adds it to the scene and calls
   // update every frame; update() moves the group to the camera's x/z (y stays 0) and animates.
export function makeWaterTile(world, len /*metres*/)
   // -> Group, origin z=0 extending to z=-len. A swimmable sea surface 14.6 m wide at y = WATER_Y with
   // animated waves/foam/sparkles, lane guide buoy chains at x=+-1.2, translucent so a darker sea floor shows.
export function setWaterTime(t)   // updates the shared time uniform of every water/sea material
```
The backdrop must make the whole horizon beautiful and **never black or empty**, from every camera angle,
including behind the player: gradient sky with sun/moon disc and glow, soft volumetric-looking clouds, an
animated sea reaching the horizon at y = SEA_Y with sun glitter, haze that blends into `world.fog`, and distant
scenery rings per world (harbor: lighthouse, sailboats, cranes + hills with villages; neon: glowing skyline
across the bay with a lit bridge, harbour lights, drifting lanterns; coral: tiny palm islets, reef lagoon colours,
sailing dhows; jungle: misty emerald hills, tall waterfalls, giant tree silhouettes, birds; frost: ice mountains
and glaciers, aurora ribbons, icebergs; dunes: layered golden dune ranges, pyramids/minarets skyline, distant
oasis with the sea beyond). Add gently flying birds/seagulls and boats where fitting. `quality:'low'` = fewer
objects and no per-frame shader work beyond the sea. Everything is distant (radius 250-420 m), fog-immune
where needed, with depthWrite off for sky.

### house.js
```js
export function makeHome(world, stage /*0..5 built stages*/, items /*array of owned HOME_ITEMS ids*/)
   // -> Group: a complete home plot on a small island (see below), front facing +Z toward the camera.
export function setHomeStage(home, stage)    // 0 = construction site ... 5 = grand finale; shows/hides parts, no rebuild
export function setHomeItems(home, ids)      // shows the owned luxury items, hides the rest
export function updateHome(home, t, dt)      // animation: water, smoke, flags, lights flicker, particles...
// home.userData = { bounds:{ radius, height }, setNight?(bool) }
```
A luxurious, finished-looking home, one distinct architectural design per world style
(`world.house.style`): `villa` (Mediterranean seaside villa, white stucco, terracotta roof, blue shutters,
terraces, pergola, harbour dock), `penthouse` (glass-and-neon cyber tower house, rooftop lounge, drone pad,
sunset glow), `bungalow` (overwater bungalow resort on stilts, thatched roofs, decks, hammocks, lagoon),
`treehouse` (giant tree lodge with rope bridges, lanterns, waterfall), `chalet` (alpine timber chalet, glass
A-frame, hot tub, snow, aurora glow), `palace` (sandstone desert palace, domes, minarets, arches, courtyard,
oasis, palms). The plot is a round island (~radius 12) with beach ring, paths, trees and a small sea around it.
Stages: 0 construction site (fence, scaffolding, crane/excavator, material piles, plan board), 1 foundation and
structure, 2 roof and facade, 3 windows/doors/interior lights and furniture glimpsed through glass, 4 garden,
driveway, paths, trees, flowers, 5 grand finale (landscape lighting, banners/flags, chimney smoke or similar
life). Items (all ten must have a model, placed at fixed non-overlapping spots around the house so any subset
looks right): `lights` lamp posts + string lights, `garden` flower beds/topiary/hedges, `fountain` animated
water, `pool` infinity pool with animated water and loungers, `gazebo` lounge with cushions and canopy,
`solar` panels on the roof/ground, `supercar` a sleek supercar on the driveway, `helipad` pad with a small
helicopter, `yacht` luxury yacht moored at a dock on the sea side, `statue` golden statue of a courier animal
on a plinth. Use the player's colours: the statue is gold. The home must look good from the lobby camera
(about 14 m from the plot centre, 5 m high, looking slightly down) and while slowly rotating.

### critter.js
```js
export function makeCritter(species, skin, opts /*{ jet?:bool, backpack?:bool }*/)
   // species: 'rabbit'|'fox'|'bear'|'cat'|'frog'|'owl'|'dino'; skin = { fur, belly, accent, scarf, lens } (hex numbers)
export function animateCritter(root, mode, phase, t, extra /*{ flip?:0..1, vy?:number, bank?:number, speed?:number }*/)
export function makeVillain()                   // Captain Krab: pirate crab (red shell, tricorn hat, eye patch, hook claw, loot sack)
export function animateVillain(v, mode, phase, t) // modes: 'run' (sideways scuttle) | 'wave' | 'idle' | 'taunt' | 'fly' | 'fall'
export function critterPortraitSVG(species, skin, size /*px*/)  // returns an SVG string of the head for UI cards
```
Little courier animals: about 1.9 m tall, big expressive heads, goggles with `skin.lens`, a flowing scarf in
`skin.scarf` (the tail of the scarf flutters), a small delivery backpack with a gold coin emblem. Distinct species
silhouettes: rabbit (long ears, fluffy tail, buck teeth), fox (pointed ears, snout, big bushy tail with a light
tip), bear (round ears, round muzzle, stubby tail), cat (pointy ears, whiskers, long curved tail), frog (wide
mouth, big eyes on top, webbed feet), owl (round face, big eyes, beak, wings as arms, ear tufts), dino (snout,
back spikes, thick tail, tiny teeth). `root.userData` must contain `{ rig, legL, legR, armL, armR, head, torso,
jet, shadow, tail, ears:[...], scarfTail }` where `rig` is the group animated for lean/flip, `jet` is a
jet-pack group (flames) that is `visible=false` unless `opts.jet`, `shadow` is a blob shadow plane at y=0.02.
`animateCritter` modes: `run` (phase is distance-based radians, lean forward, arms/legs swing, ears flop),
`jump` (tucked; `extra.flip` 0..1 performs a full forward somersault of `rig`), `slide` (low, leaning back, one
hand trailing), `fly` (jet pack: superhero pose), `fall` (tumbling/ragdoll-ish), `wave`, `idle` (breathing,
looking around, blinking), `swim` (front crawl: body nearly horizontal, alternating arm strokes, kicking, head
bobbing; rig is lowered so only the upper body shows above the water line y=0), `dive` (underwater glide, head
down, streamlined), `ride` (seated in a vehicle: hands forward on a wheel, body low, ears streaming back),
`plane` (seated pilot leaning into the turn using `extra.bank`), `cheer` (arms up, jumping), `hurt`.
Reset every transform each call (animations must not accumulate state).

### vehicles.js
```js
export function makeVehicle(kind /*'car'|'boat'|'ship'|'plane'*/, world)
   // -> Group facing -Z, origin at ground/water level centre. userData: { seat:{x,y,z}, width, length, height,
   //    wheels:[...], prop, hitHalfWidth }  (seat = where the rider's feet go, in the vehicle's local space)
export function animateVehicle(v, t, speed, extra /*{ bank?, pitch?, steer? }*/)   // wheels roll, prop spins, hull bobs, flags flutter
export function makeVehiclePickup(kind, world)
   // -> Group: the vehicle parked on the track as a collectible: slowly bobbing, with a glowing ring and big
   //    chevron arrows hovering above ("get in!"). userData.hitHalfWidth, hitLength for gameplay.
export function makeBossAirship()
   // -> Group: flying pirate airship seen from behind (stern faces +Z toward the player): wooden hull with stern
   //    windows, balloon with a skull-and-crab emblem, sails, propellers, cannons. userData: { deck:{x,y,z}, cannons:[...], props:[...] }
export function animateBossAirship(g, t, state /*{ firing:0..1, hit:0..1, defeat:0..1 }*/)
```
Vehicle sizes: car 2.0 x 3.6 (open sports buggy, big wheels, roll bar, headlights), boat 2.0 x 4.2 (speedboat with
windshield, outboard motor, foam wake), ship 7.0 x 14 (toy-like cruise ship/pirate galleon hybrid with funnel,
decks, rails, lifeboats; wide enough to cover all three lanes), plane 7.0 wingspan x 5.5 (bright propeller
biplane with open cockpit). Body colours come from `world.palette`/`VEHICLES[kind].color`. The seat position must
put a 1.9 m tall critter sitting believably (legs hidden inside the vehicle).

### obstacles.js
```js
export function makeWaterObstacle(kind, world)   // kinds: 'buoy' (low) | 'mine' (cone) | 'sharkfin' (block) | 'rock' (block) | 'driftnet' (high) | 'speedboat' (mover)
export function makeSkyObstacle(kind)            // kinds: 'balloon' | 'drone' | 'storm' | 'kite'  (sizes in userData.size {w,h,d})
export function makeRing(color)                  // glowing flight ring, outer radius 1.6, faces -Z, userData.radius
export function makeDock(world, kind)            // 'enter' = road ends in a wooden pier ramp down into water, 'exit' = ramp up out of water; 8.6 m wide, 6 m long, z from 0 to -6
export function makeGapEdge(world, kind)         // 'start' | 'end' broken-bridge edge (splintered planks, bent rails), 8.6 m wide, 2.5 m deep, z from 0 to -2.5
export function makeWarningSign(kind)            // 'water' | 'gap' roadside warning sign
export function makeCoinStack(...)               // not needed
```
Water collision sizes the game will use (design the visuals to match; all positions relative to the origin on the
water surface y=0): `buoy` 1.8 wide, 0.9 tall; `mine` 0.8 wide, 0.9 tall (spiky sea mine); `sharkfin` 1.4 wide, 1.1
tall above water; `rock` 2.2 wide, 2.4 tall; `driftnet` 2.2 wide, solid from 0.2 to 1.8 above the water (a floating
gate/net you must dive under; open beneath); `speedboat` 2.0 wide x 3.4 long, 1.2 tall. Frost world: use ice
floes/icebergs instead of rocks/buoys (tint by world.id). Sky obstacles: balloon 2.2 diameter, drone 2.0 wide,
storm cloud 3.0 wide x 2.4 tall, kite 1.6 wide.

### props.js
```js
export function makeProps(world, side /*-1 left | +1 right*/, len /*30*/, rng /*()=>0..1*/)
   // -> Group: roadside decoration for one 30 m tile on one side. Origin z=0, extends to z=-len. Land spans
   //    |x| from ROAD_EDGE (5.7) to GROUND_HALF[world.id]; keep props inside it (tall landmarks may stand
   //    further out only if the world's land is wide). Close props (x 6-9) must stay under 3.5 m tall so the
   //    view of the sea/backdrop is not blocked; taller landmarks go further out.
export function makeGroundTile(world, len, kind /*'road'|'gap'|'water'*/)
   // -> Group: textured road (asphalt/boards/sand-road per world, lane markings, kerbs, sidewalks) + the land on
   //    both sides up to GROUND_HALF with gradient edges and a beach/shoreline where it meets the sea
   //    (sea itself is provided elsewhere at y = SEA_Y = -0.9, so land must sit at y >= 0 and slope down to the shore).
   //    Land and props must look right from the gameplay camera (about 7 m behind and 4 m above the player).
   //    'gap' = same tile but with a 6 m wide gap cut across the road (z from -12 to -18): no road surface there,
   //    show the broken-bridge edges (build them yourself, do NOT import ./obstacles.js) and nothing below but sea.
   //    The land beside the road stays.
   //    'water' = the road is flooded: NO road surface, kerbs or lane markings; only the land on both sides, starting
   //    at |x| = 7.3 with a sloping beach/shoreline into the swim channel, which is 14.6 m wide (a separate animated
   //    water tile from backdrop.js is placed there by the game at y = WATER_Y = -0.12, so land edges must slope
   //    down below y=-0.3 at the channel edges).
```
World props (all ambient and charming, never blocking lanes): harbor (cargo containers, cranes, lighthouse,
moored sailboats on the sea side, warehouses, bollards, flags, lamp posts, crates), neon (skyscrapers with emissive
window textures, billboards, holo signs, neon palms, monorail pylons, lantern strings), coral (palm trees,
tiki bars, beach umbrellas, surfboards, lifeguard towers, hammocks, bungalows, coral rocks), jungle (giant
trees with vines, mossy ruins, glowing mushrooms, ferns, rope bridges, waterfalls on rocks), frost (snowy
pines, ice formations, igloos, log cabins with smoke, snowmen, frozen lamp posts), dunes (sandstone arches,
domes, minarets, palms, market tents, obelisks, camel statues, dune ridges).
