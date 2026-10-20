# Titan Earthfall Architecture

## Runtime layers

- **Core** — startup/composition and service contracts.
- **Runner Core** — engine-independent lane-runner rules shared by the Unity client, bots and the race server.
- **Runner View / Game** — Unity presentation and flow for the runner (views, HUD, input, persistence).
- **Player** — free-roam movement, survival state and player-facing interactions.
- **World** — biome selection, streaming and procedural world systems.
- **AI** — predators, fauna and perception/state machines.
- **Hazards** — environmental damage, movement modifiers and status effects.
- **Economy** — currencies, loot and progression.
- **Home** — village/home upgrades and persistent progression.
- **UI** — presentation only; gameplay systems expose events/data rather than owning rules.
- **Save** — versioned persistence and profile migration.
- **Tests** — EditMode and PlayMode coverage.

## Dependency rule

Gameplay layers may depend on Core contracts, but presentation should not own gameplay state. Cross-system communication should prefer interfaces/events over direct singleton coupling.

## Runner architecture

```
            ┌──────────────────────── Runner Core (no UnityEngine, asmdef) ────────────────────────┐
            │ TrackGenerator → Track      RunnerSimulation      RunnerBot      MissionTracker        │
            │ Net: RaceProtocol · RaceRoom · RaceLobby · IRaceConnection · SnapshotInterpolator     │
            └───────────────▲───────────────────────────▲──────────────────────────▲───────────────┘
                            │                           │                          │
   Unity client (Assembly-CSharp)          Race server (ASP.NET Core)        Tests (NUnit, dotnet + Unity)
   RunnerGame ─ RunnerHud                  RaceHub: WebSocket ⇄ RaceLobby    generator fairness, physics,
   TrackView · RunnerAvatar · Camera       RaceServerApp: /race, /health     protocol, rooms, end-to-end
   EconomyManager · HomeUpgradeSystem · BiomeManager (existing services)
```

- **Determinism where it matters.** Tracks come only from `(seed, chunk index)` via a platform-independent PRNG,
  so every racer and bot sees identical obstacles regardless of generation order.
- **Fixed-step simulation.** `RunnerSimulation` advances in 1/60 s steps; the view interpolates between steps.
  It emits `RunnerEvent`s that drive audio, VFX, missions and rewards without coupling the rules to Unity.
- **Fairness by construction.** Rows keep a reaction gap, every row is passable, and train blocks always leave a
  train-free lane. `RunnerBot` at skill 1 surviving long runs on many seeds is the regression test for this.

## Multiplayer data flow

1. Client → `Hello`, `JoinRoom` (quick match, room code or create private) → `Welcome` + `RoomState`.
2. Everyone is ready (or the quick-match timer runs out) → the room fills empty seats with bots → `RaceStart(seed, length, countdown)`.
3. Each client simulates its own runner and sends `Snapshot`s; the room validates them, steps the bots and broadcasts `WorldState`.
4. Clients interpolate remote runners about 150 ms in the past (`SnapshotInterpolator`) on a clock synced to the server.
5. A client sends `Finished` when it crosses the line or gives up. When all humans are done, the remaining bots are
   resolved instantly and the room broadcasts `RaceResult`.

`RaceLobby` is transport-agnostic. `RaceHub` (server) feeds it from WebSockets, and `LocalRaceConnection` feeds it
in-process for offline races. Both go through the same binary encoder, so offline play exercises the online code path.

## Current foundation

The repository contains the first gameplay systems, the Core composition root and service contract, and a complete
lane-runner vertical slice with multiplayer. The next implementation phase should move toward ScriptableObject-driven
configuration, an art pass for runner visuals, versioned cloud saves, and PlayMode tests.
