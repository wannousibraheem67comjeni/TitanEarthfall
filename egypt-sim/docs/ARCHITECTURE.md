# Architecture

This document covers how Egypt 3D is put together:

- where data comes from;
- how a single terrain function serves every system;
- how work is split between the main thread and the workers;
- how each layer manages its level of detail;
- how the frame loop ties everything together.

The README covers features and usage.

## Big picture

```mermaid
flowchart LR
  subgraph Offline["Offline (tools/)"]
    NE[Natural Earth 10m] --> BAKE[bake-gis.mjs]
    TT[AWS Terrain Tiles] --> BAKE
    SRTM[USGS SRTM via GDAL] -. build-dem.sh .-> BAKE
    BAKE --> PD[(public/data<br/>egypt-gis.json<br/>egypt-dem.v1.bin<br/>context-dem.v1.bin)]
  end

  subgraph Main["Main thread"]
    PD --> BW[buildWorld]
    JSON[(src/data/*.json)] --> BW
    BW --> W[World]
    W --> TM[TerrainManager]
    W --> CM[CityManager]
    W --> LM[LandmarkManager]
    W --> WR[WaterRibbons]
    W --> CAM[GeoCameraController]
    ENV[Environment + SkyDome] --> R[WebGLRenderer]
    TM & CM & LM & WR --> R
    UI[Hud / Labels / Minimap] --> CAM
  end

  subgraph Workers["Geo workers (2–4)"]
    WW[World replica] --> BN[buildTerrainNode]
    WW --> CG[CityGenerator]
    LD[LiveDemProvider] --> BN
  end

  W -- "init: transferable buffers" --> WW
  TM -- "terrain job" --> BN -- "typed arrays" --> TM
  CM -- "city job (+ OSM)" --> CG -- "typed arrays" --> CM
```

The design rests on one rule: **the world is a pure function of position**. `World`, assembled in `src/gis/world.ts`, bundles:

- the projection;
- the DEMs;
- the rasters;
- the water model;
- the districts;
- the terrain model.

Nothing in it depends on the renderer or the camera. The same code runs on the main thread, in the workers and in the Node test suite. As a result:

- a terrain vertex, a building plot, the camera's collision height and a cursor raycast always agree;
- the tests exercise the same code the renderer uses, against the real baked data.

## Coordinate frame

`GeoProjection` (`src/gis/projection.ts`) is a spherical Transverse Mercator projection with its origin at 30.8°E, 26.8°N.

| Axis | Direction |
|---|---|
| X | east |
| Z | south, so north is −Z (the Three.js default) |
| Y | up, in metres above sea level |

Scale distortion stays under 0.5% inside Egypt, so the world can be treated as flat and metric. The geometry ignores the Earth's curvature. Only the atmosphere shaders model a spherical planet, so the horizon and sky stay correct from orbit.

Values that must be exact in geographic terms are stored per vertex: the lon/lat lookup used for imagery, the governorate borders, and the relief textures. This avoids round-tripping through the projection in shaders.

## Start-up

`App.start()` in `src/app/App.ts` runs these steps in order:

1. **Fetch the data.** It fetches `egypt-gis.json` and both DEM containers in parallel. `dem.ts` decodes `EGDEM1`: a gunzipped 56-byte header, then row-delta Int16 values. In development builds it also validates the JSON datasets.
2. **Build the world.** `buildWorld` assembles `GeoRasters` (`rasters.ts`): lon/lat grids rasterised from the vectors with scanline coverage and 2×2 supersampling. The grids are:
   - land, Egypt and lake-ID coverage;
   - chamfer distance fields: distance to rivers (with the river surface propagated along them), to water, and to the coast.
3. **Start the workers.** It starts the worker pool and broadcasts `init`. Each worker receives the world as transferable buffers through `toTransfer` and `fromTransfer`, then rebuilds its own replica.
4. **Build the macro texture.** The workers build the land-use macro texture in row bands. It holds fertility, urban, rock, sand and water at half the national DEM resolution.
5. **Assemble the scene.** It builds the relief textures (slopes and masks), then creates the scene, the UI, and the camera pose from the URL hash.
6. **Wait for the root node.** It waits until the terrain root node exists, so the first visible frame is never empty.

## The terrain function

`TerrainModel.sample(x, z, spacing, out, elevation?)` in `src/gis/terrainModel.ts` is the heart of the simulation. Callers pass the **vertex spacing** they will render at. The function then returns only detail that spacing can represent.

1. **Base elevation.**
   - It takes a bicubic (Catmull–Rom) sample of the national DEM.
   - Toward the edge of the national grid, it blends over a 0.15° band into the context DEM.
   - When the live DEM is on, the worker passes an `elevation` callback backed by Terrarium tiles at the matching zoom.
2. **Band-limited detail.** It adds fBm and ridged noise. Each octave is weighted by how well the spacing resolves it, so coarse nodes are smooth and fine nodes gain rocks and ripples, without aliasing between levels. Seif dunes, which are oriented linear ridges, are added in the sand seas from `regions.json`.
3. **Surface classes.** It computes per-vertex weights for these classes:
   - **fertility**: distance to the Nile, scaled up in the low Delta, plus oases;
   - **urban**: district density, plus villages in farmland;
   - **rock**: slope and altitude;
   - **sand**;
   - **foreign**: outside Egypt.
4. **Water.** `WaterModel.query` (`hydrography.ts`) returns the nearest water body's kind, signed shore distance, surface level and half-width. It uses exact vector distances from `SegmentGrid` and point-in-polygon tests from `RingIndex` (both in `core/spatialIndex.ts`). The rasters only serve as early-outs. Then:
   - **Rivers and canals** carve a channel 1–7 m below the fitted water surface, as wide as the river or 1.25 vertex spacings, whichever is larger. This keeps channels continuous at every level.
   - **Sea and lake beds** sit below the surface.
   - **Banks and beaches** are graded toward the water level within 2.5 km.
5. **Landmark sites** are flattened to a pad inside each `clearRadius`. This step is skipped inside river channels.

`buildTerrainNode` (`src/terrain/buildNode.ts`) samples a (S+3)² bordered grid, with one extra ring of samples for central-difference normals. It packs the results into compact attributes:

| Attribute | Contents |
|---|---|
| `position` | Float32: local x/z, absolute y |
| `normal` | Int8, normalised; flat over water |
| `aSurfA` | unorm8: fertility, urban, rock, sand |
| `aSurfB` | unorm8: foreign, log₂ spacing code, water-body kind |
| `aGeo` | Float32: lon, lat, water depth, signed shore distance |

A ring of skirt vertices hangs below each edge, which hides cracks between levels. All nodes share one index buffer, built on the main thread.

## Terrain level of detail

`selectNodes` (`src/terrain/quadtree.ts`) walks the quadtree every frame:

- **Tree shape.** The root covers 3,277 km, with 15 levels below it. With 32 segments per node, vertex spacing runs from about 100 km down to about 3 m.
- **Splitting.** A node splits while the camera is closer than `size × 2.4` to its 3D bounding box. Height bounds come from the built node, or conservatively from its nearest built ancestor.
- **No holes.** A node is drawn in place of its children until every visible child is built. Unbuilt nodes go on a `wanted` list sorted by `level × 0.25 + distance / size`.
- **Culling.** Children outside the frustum are skipped.

`TerrainManager` handles the rest:

- It issues at most `min(free worker capacity, 12 in flight)` jobs per frame.
- It keeps an LRU cache of 900 meshes, and marks the ancestors of every rendered node as used so zooming out is instant.
- It discards results from a stale generation, for example after the live DEM is toggled.
- Its `heightAt` and `raycast` methods call the terrain function directly. They do not read meshes, so the queries work at any LOD.

## Terrain shading

`terrainMaterial.ts` extends `MeshStandardMaterial` through `onBeforeCompile`, so it inherits shadows, lights and tone mapping. It adds these layers:

1. **Albedo.**
   - Base colour comes from the surface classes. Coarse nodes, where spacing is about 1 km or more, read surface, water and relief from the national and context textures instead of vertex attributes, so they never look blocky.
   - Farmland is drawn as rotated parcels; there are also dune streaks, rock strata and urban fabric.
   - The basement granite of Sinai and the Red Sea Hills is darkened.
2. **Footprint fading.** Every procedural pattern fades by its screen-space footprint, computed with `fwidth` in metres per pixel. At distance and at grazing angles the patterns average out instead of aliasing.
3. **Satellite imagery** (optional). `ImageryManager` keeps near and far 4×4 tile mosaics around the camera target. They are reprojected to linear latitude, so the shader can address them with the per-vertex lon/lat.
4. **Water.**
   - The signed shore distance interpolates linearly across triangles, so its zero crossing traces a smooth shoreline rather than triangle edges.
   - Colour comes from depth, with silt in rivers and turquoise reef shallows.
   - Two scrolling octaves give wave normals.
   - It adds Fresnel sky reflection (`uSkyReflect`, taken from the hemisphere light), shore foam and wet sand.
5. **Night lights.**
   - Up close, lamp dots fill 25 m cells.
   - At mid range they average to a soft wash.
   - From orbit they merge into a smooth aggregate glow, so the Nile Valley reads as a ribbon of light.
6. **Aerial perspective** comes from the shared atmosphere GLSL (see below).

Rivers and canals are often narrower than the terrain's vertex spacing (the Suez Canal is about 300 m wide). `WaterRibbons` therefore draws them as vector strips, built from the same polylines and water levels the terrain carves to:

- They sit 0.15 m above the carved bed level and use a polygon offset.
- They are split wherever they enter standing water, which the terrain already draws.
- Mitred joins are carried across chunk seams.

## Cities

**Districts.** `src/city/districts.ts` turns `cities.json` into oriented ellipses with a falloff. `DistrictIndex` provides:

- `owner(x, z)`: the highest-priority district at a point, with centrality as the tie-break;
- `urban(x, z)`: density, which also tints the terrain.

**Tile generation.** `CityGenerator.generate` (`cityGenerator.ts`) runs in workers on 1 km tiles:

1. Each tile samples the terrain once into a 41×41 `TileContext` grid. Building bases and water checks read from this grid, not the full terrain function.
2. For each district that touches the tile, it lays out a warped grid aligned to the district's `gridDeg`. Avenues appear every N streets. Neighbouring blocks merge into 2×2 superblocks according to the profile's `merge` setting.
3. Each block is inset per edge by half its street width. Ownership is decided once per block centroid, which prevents two districts from building the same spot.
4. Each block gets a layout from its profile:
   - `subdivide`: recursive splits along the longest edge until lots reach `lotArea`;
   - `perimeter`: a courtyard ring;
   - `towers`: a plaza with slim towers;
   - `resort`: a beach strip with pools.
5. Plots in water or in a landmark's clear zone are skipped. Each building's base is sunk below the lowest ground point of its footprint, so it never floats on a slope.
6. **LOD 0** emits roof clutter (stair huts, water tanks), occasional neighbourhood mosques with domes and minarets, street ribbons, palms (instanced), and lamp points.
7. **LOD 1** emits one extrusion per block, using the average height.
8. **OSM.** When OSM is live, `CityManager` fetches Overpass footprints for detail tiles. The generator then builds those buildings and roads, with heights from tags or the profile.

`MeshBuilder` accumulates the geometry into flat typed arrays. Each vertex carries a colour and facade data (style, floor height, seed), so a whole tile is a single draw call per material. The facade shader in `cityMaterials.ts` handles every building:

- It draws windows from per-vertex wall coordinates (metres along and up the wall, plus a per-building seed), with the style packed into the colour's alpha. There are eight styles: brick frame, plaster, glass, stone, resort, water, landmark stone and plain.
- It averages windows into a mean colour when they fall below a pixel.
- It lights a hashed fraction of windows at night (`uWindowLit`).

`CityManager` streams tiles in rings around the camera:

- **Ranges:** LOD 0 within 2.6 km, LOD 1 within 9 km.
- **Caps:** at most 36 detail tiles and 220 massing tiles.
- **Stability:** a hysteresis margin keeps tiles from switching back and forth, and the old group stays in place until its replacement arrives.
- **Scope:** it considers only tiles inside some district.

## Landmarks

`src/landmarks/models.ts` maps each `LandmarkModel` variant to a parametric generator. Pyramids are built from base, height and cap. Temples are built from pylons, courts and hypostyle halls. Dams and bridges are built from length, width and heading. Each generator returns **detail** and **simple** meshes plus a bounding radius.

`LandmarkManager` wraps each landmark in a `THREE.LOD`:

| Level | Shown when |
|---|---|
| Detail | Up close |
| Simple | Beyond max(500 m, 6 × radius) |
| Nothing | Beyond max(15 km, 120 × radius), where the DOM label carries it |

Each landmark is placed on the terrain at its pad height and rotated to `headingDeg`. The Avenue of Sphinxes is a single `InstancedMesh` along the 2.7 km processional way.

Other linear features:

- `SuezTraffic` moves two convoys of nine container ships along the canal polyline, timed by simulation time.
- `MapOverlays` draws the Nile, the canals and the borders as screen-space `Line2` lines. They fade in with altitude, and a selected governorate is highlighted.

## Atmosphere and lighting

`src/environment/atmosphere.ts` holds one GLSL chunk used by the sky and by every lit material:

- **Constants.** Rayleigh coefficients for Earth. Mie density, scale height, anisotropy and tint come from the current weather preset.
- **`SkyDome`.** A Nishita sky: 24 view samples, quadratically spaced so samples concentrate near the camera, and 8 light samples, with midpoint optical depth. It works from any altitude, inside or above the atmosphere, and handles rays that miss the planet. It draws into a separate **background pass**, followed by a depth clear, so the logarithmic depth buffer is never shared between the sky and the 1,500 km scene.
- **Aerial perspective** (`injectAtmosphere`). Every material computes optical depth between the camera and the fragment analytically, as an exponential atmosphere integrated along the segment. It applies transmittance and in-scatter. In-scatter is scaled by opacity, so thin haze does not wash out the ground. In dense dust, the khamaseen preset blends the Mie phase toward isotropic (`uMieMulti`), standing in for multiple scattering.

`Environment.ts` drives the following each frame:

- the sun and moon (`solar.ts`, NOAA equations) at the camera target;
- Egypt's DST rule;
- sun colour from air mass and transmittance;
- the hemisphere sky and ground colours;
- exposure, from 1.0 by day to 2.2 at night;
- window lighting, which follows a local-time schedule;
- the shadow frustum, fitted around the focus and active below 6 km;
- automatic weather, which blends between coastal and desert presets using the coast-distance raster.

## Navigation

`GeoCameraController` is an orbit camera defined by a target point on the ground, a distance, a heading and a pitch.

**Input.**

- **Pan.** The grab point is projected onto the plane at its height and kept under the cursor.
- **Zoom** moves toward the cursor's ground point.
- **Pinch** and two-finger rotate are supported.
- **Inertia** follows each gesture.

**Constraints.**

- **Pitch limits.** `minPitch(distance)` and `preferredPitch(distance)` keep the camera top-down from orbit and allow horizon views near the ground.
- **Collision.** The camera stays at least 1.8 m above `heightAt`.
- **Clip planes.** Near and far planes scale with altitude.

**Flights.** `flyTo` follows `zoomPanPath` (`flightPath.ts`), the van Wijk–Nuij (2003) optimal path through (position, zoom) space:

- Long hops rise until both endpoints are in view, then descend.
- The perceived speed stays constant.
- Heading and pitch are eased alongside.
- Any user input cancels the flight.

## Threading and the frame loop

`WorkerPool` (`src/workers/WorkerPool.ts`) runs 2–4 module workers with up to three jobs queued per worker:

- `capacity` reports the free slots. The terrain and city managers use it to share the pool fairly.
- Responses transfer their `ArrayBuffer`s without copying.
- The protocol is small: `init`, `terrain`, `macro` and `city` (`protocol.ts`).

`App.frame()` runs each frame in this order:

```
controller.update(dt)                    input, inertia, flights, collision
env.update(...)                          sun, moon, weather, exposure, shadows
sky.update(camera)
terrain.update(camera, maxJobs)          LOD selection, job dispatch, LRU
cities.update(camera, ground)            tile rings, uses the remaining capacity
landmarks / suez / overlays / imagery update
render(background) → clearDepth → render(scene)
labels.update(...)                       DOM labels, decluttered
throttled: HUD (5 Hz), cursor pick (8 Hz), URL hash (1 Hz)
```

Near the ground (below 12 km), terrain jobs leave three worker slots free for city tiles, so buildings load as quickly as the ground under them.

`trackPerformance` adjusts the pixel ratio between 0.6× and the device maximum to stay above about 40 fps.

## Testing strategy

Because everything above the renderer is pure, the tests (`tests/*.test.ts`, vitest in Node) load the real baked data with `tests/helpers.ts` and run real code:

- the terrain function, the hydrography and the quadtree selection;
- city generation, the landmark generators and the dataset validators;
- the solar ephemeris and the flight path.

Visual checks of shaders and lighting were done with headless Chromium (SwiftShader) screenshots. These are the views in `docs/images/`.

## Extension points

| Goal | Where |
|---|---|
| New data source for elevation | `LIVE_SOURCES.dem` in `config.ts` (Terrarium or Mapbox encoding), or bake a new DEM with `build-dem.sh` |
| Different imagery provider | `LIVE_SOURCES.imagery` in `config.ts` |
| Self-hosted Overpass | `LIVE_SOURCES.overpass` |
| New landmark geometry type | Add a variant to `LandmarkModel` (`schema.ts`) and a generator case in `models.ts` |
| New city style | Add a profile to `profiles.ts`; reuse a lot layout or add one in `cityGenerator.ts` |
| Terrain look | `terrainMaterial.ts` (shading) and `terrainModel.ts` (shape and classes) |
| Weather preset | `WEATHER` in `atmosphere.ts` |
| LOD budgets | `TERRAIN` and `CITY` in `config.ts` |
