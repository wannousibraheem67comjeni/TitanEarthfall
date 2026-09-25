# Titan Earthfall Architecture

## Runtime layers

- **Core** — startup/composition and service contracts.
- **Player** — movement, survival state and player-facing interactions.
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

## Current foundation

The repository currently contains the first gameplay systems plus the Core composition root and service contract. The next implementation phase should move toward ScriptableObject-driven configuration, versioned save data, world streaming, and automated tests.
