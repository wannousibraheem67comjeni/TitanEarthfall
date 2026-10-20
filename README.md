# Titan Earthfall Run

A lane runner in the spirit of **Subway Surfers** and **Talking Tom Gold Run**, with
**real-time multiplayer races** as its headline feature. You swipe between three lanes, jump and roll past
barriers, run along train roofs and grab power-ups while a Titan chases you. Gold you collect rebuilds your
home village.

> **ملخص بالعربية:** لعبة جري لا نهائية على ثلاث حارات مستوحاة من Subway Surfers وTom Gold Run، وأهم ميزاتها
> **السباقات الجماعية عبر الإنترنت**. يجري كل اللاعبين على نفس المسار (من نفس البذرة/الـ seed)، ويُملأ أي مقعد فارغ
> بروبوت ذكي. وتعمل أيضاً بدون إنترنت كسباق ضد الروبوتات. افتح المشروع في Unity، ثم افتح مشهداً فارغاً واضغط Play.
> لتشغيل خادم السباقات: `dotnet run --project Server/TitanEarthfall.Server`.

## Play it in Unity (about a minute)

1. Open this folder as a project in **Unity 2021.3 LTS or newer** (2022.3 LTS and Unity 6 work too).
2. Open any empty scene and press **Play**. `RunnerAutoBootstrap` spawns `RunnerGame`, which builds the
   camera, light, track, characters, audio and UI procedurally, so no prefabs or assets are needed.
   - It does not auto-start in scenes that contain the free-roam `PlayerController` or `GameBootstrap`.
   - Add `TITAN_NO_RUNNER_AUTOBOOT` to *Scripting Define Symbols* to disable it, or add `RunnerGame` to a scene yourself.
3. Controls: **swipe** (touch or mouse drag), or **Arrows / WASD** with **Space** to jump. **Esc** pauses.

Both the legacy Input Manager and the new Input System package are supported.

## What's in the game

| Feature | Details |
|---|---|
| Lane running | 3 lanes, jump, roll, fast-drop, coyote time and jump buffering; speed ramps from 14 to 30 m/s |
| Obstacles | Hurdles (jump), overhead barriers (roll), trains (dodge), and ramps that lead onto train roofs |
| The chaser | A Titan follows you. One side-bump brings it close; a second within 6 s and you're caught |
| Power-ups | Coin Magnet, Jetpack (sky-coin trail), Super Sneakers (jump onto roofs), 2x Multiplier, Shield Board |
| Pickups | Coins → Gold, Gems, Mystery Boxes (gold / credits / troca / gems / jackpot) |
| Revive | Spend 1 Credit to continue (up to 3 times per run) |
| Missions | 3 at a time; finishing a set raises your permanent score multiplier and pays a Credit |
| Upgrades | Spend Gold to extend power-up durations (5 levels each) |
| Home | Spend Gems to build the house, workshop and vault; every tier adds +1 score multiplier |
| Biomes | All 16 biomes, from Mountain Heights to Cyber Metropolis, each with its own palette and scenery |
| Presentation | Procedural characters and animation, chase camera, synthesized SFX and music loop |

## Multiplayer

**The design:** every racer runs the **same seeded track**. Each device simulates its own runner, so input
feels instant even on a bad connection. Devices stream compact snapshots (15/s) to the race server, which
relays a world state (10/s). Other runners appear as translucent racers in their lanes, interpolated 150 ms
in the past for smooth motion.

| Mode | How it works |
|---|---|
| **Race vs Bots** (offline) | Runs the same lobby and room code in-process, through the same binary protocol. No server needed. |
| **Quick Match** | Join a public room. It starts 8 s after someone is ready, and empty seats become bots. |
| **Private Room** | Create a room, share the 4-letter code, and it starts when everyone is ready. |

Races are first to 1,500 m. Finishers rank by time, everyone else by distance. The podium earns bonus gold.

**Server authority and anti-cheat:** the server owns matchmaking, the seed, bots, the race clock and the
final standings. It rejects impossible progress (faster than top speed), keeps distance monotonic, refuses
finish times earlier than physically possible or earlier than it received them, sanitizes names, limits
message size and rate, and drops malformed packets.

### Run the race server

```bash
dotnet run --project Server/TitanEarthfall.Server          # listens on http://0.0.0.0:5080
# or with Docker, from the repository root:
docker build -f Server/TitanEarthfall.Server/Dockerfile -t titan-race . && docker run -p 5080:5080 titan-race
```

- In the game, pick **Online Race** and enter the server address, e.g. `ws://192.168.1.20:5080/race`
  (same Wi-Fi) or `ws://10.0.2.2:5080/race` (Android emulator). Use `wss://` behind TLS.
- `GET /health` returns connection and room counts. Hosts that provide `$PORT` (Render, Fly.io, Heroku) are
  supported. Race rules can be tuned in `appsettings.json` (`Race` section).
- Online play needs a native build (Standalone, Android, iOS). WebGL has no `ClientWebSocket`.

## How it fits the existing foundation

- **EconomyManager**: run payouts go to Gold, Gems, Credits and Troca; revives spend Credits.
- **HomeUpgradeSystem**: provides the Home screen. Runtime-created instances get default tracks via `EnsureTracks`.
- **BiomeManager**: the runner moves through biomes by distance and mirrors them with `SetBiome`. Its default
  definitions now list every biome in order (they used to list only Mountain Heights).
- **Bug fix:** several existing methods were written on the same line as their `/// <summary>` comment, which
  turned the whole method into a comment. As a result, `EconomyManager.TryConsumeReviveCredit`,
  `HomeUpgradeSystem.GetTier/TryUpgrade/ResetProgress`, `ChestInteractable.TryOpen` and
  `PredatorAI.SetTarget` did not exist. They are now on their own lines and compile.

## Project layout

```
Assets/Scripts/Runner/Core/        Engine-independent rules (asmdef, noEngineReferences)
  TrackGenerator, Track             seeded procedural track (fairness rules, chunk streaming)
  RunnerSimulation                  fixed-step runner: lanes, physics, collisions, power-ups, chaser
  RunnerBot                         look-ahead AI (bots, fairness proof)
  Progression                       missions, upgrades, profile data
  Net/                              protocol, RaceRoom, RaceLobby, WebSocket + local connections, interpolation
Assets/Scripts/Runner/View/         TrackView, RunnerAvatar, RunnerCameraRig, RunnerAudio, BiomePalette
Assets/Scripts/Runner/Game/         RunnerGame (flow), RunnerHud (UI), input, profile store, auto-bootstrap
Assets/Tests/EditMode/              NUnit tests (run in Unity's Test Runner and with dotnet)
Server/TitanEarthfall.Server/       ASP.NET Core WebSocket race server (compiles the same Core sources)
Server/TitanEarthfall.Server.Tests/ End-to-end tests over real WebSockets
Tools/CoreTests/                    Runs Assets/Tests/EditMode outside Unity
Tools/UnityCompileCheck/            Compiles all Unity scripts against UnityEngine 2021.3 reference assemblies
```

## Tests

```bash
dotnet test Tools/CoreTests/CoreTests.csproj                               # rules, generator, bots, protocol, rooms
dotnet test Server/TitanEarthfall.Server.Tests                             # server over real WebSockets
dotnet build Tools/UnityCompileCheck/UnityCompileCheck.csproj              # Unity scripts compile (legacy input)
dotnet build Tools/UnityCompileCheck/UnityCompileCheck.csproj -p:InputSystem=true
```

The strongest test is `PerfectBot_SurvivesLongRun`: a flawless bot must survive 5 km on every seed, which
shows the generator never builds an impossible pattern. During development it was also checked against 600
seeds × 8 km. CI (`.github/workflows/ci.yml`) runs all of the above.

## Next production steps

- Art pass: replace the primitive visuals with characters, rigs, VFX and authored train sets
  (`TrackView` and `RunnerAvatar` are the only places to change).
- Arabic UI: IMGUI cannot shape right-to-left text. Move the HUD to TextMeshPro with an RTL plugin for Arabic.
- Accounts and global leaderboards, daily rewards, cosmetics, and store/ads integration.
- Full server-side movement validation (re-simulating client inputs) if competitive stakes grow.
