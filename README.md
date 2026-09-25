# TitanEarthfall — Unity Runner Foundation

Initial production-oriented gameplay foundation for a third-person procedural survival/adventure runner.

## Core scripts
- `Assets/Scripts/PlayerController.cs` — third-person locomotion, sprint, variable jump, slide, dodge, swim and dive; keyboard/gamepad/touch hooks.
- `Assets/Scripts/BiomeManager.cs` — ordered biome progression with a strict 360-second Mountain Heights Stage 1 timer.
- `Assets/Scripts/PredatorAI.cs` — configurable Patrol/Detect/Chase/Pounce/Flee FSM for ground, flying and aquatic predators.
- `Assets/Scripts/ObstacleHazard.cs` — modular environmental hazard volume for damage, fall zones, currents, quicksand, ice, rockfall, avalanche and pressure/oxygen hooks.
- `Assets/Scripts/EconomyManager.cs` — persistent Gold, Credits, Troca, Gems and Cece balances with atomic spend/revive operations.
- `Assets/Scripts/ChestInteractable.cs` — Troca-gated weighted chest loot for Gems and Cece.
- `Assets/Scripts/HomeUpgradeSystem.cs` — persistent Gem-funded village/home upgrade tracks.

## Integration notes
Create a Unity LTS project, place these scripts under `Assets/Scripts/`, configure a Player tagged `Player`, and add the managers to a bootstrap scene. Enable the Input System package for modern input; the controller also contains a legacy Input fallback.

This is the code foundation only. Procedural segment streaming, authored scenes/prefabs, animation, UI, audio, shaders, save/cloud services, analytics and automated tests remain subsequent production layers.