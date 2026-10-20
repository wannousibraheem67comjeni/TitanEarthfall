using System;
using System.Collections.Generic;
using TitanEarthfall.Runner.Net;
using TitanEarthfall.Runner.View;
using UnityEngine;
using UnityEngine.Rendering;

namespace TitanEarthfall.Runner.Game
{
    public enum RunnerScreen
    {
        MainMenu,
        Upgrades,
        Home,
        Missions,
        OnlineSetup,
        Connecting,
        Lobby,
        Countdown,
        Playing,
        Paused,
        Revive,
        GameOver,
        RaceWaiting,
        RaceResults
    }

    /// <summary>Another racer as seen by this client.</summary>
    public sealed class RemoteRunner
    {
        public readonly SnapshotInterpolator Buffer = new SnapshotInterpolator();
        public RacePlayerInfo Info;
        public Color Color;
        public RunnerAvatar Avatar;
        public RunnerNetState Display;
        public bool HasState;
    }

    /// <summary>What the last run paid out.</summary>
    public sealed class RunEarnings
    {
        public int Score;
        public int Distance;
        public int Coins;
        public int Gems;
        public int Gold;
        public int Credits;
        public int Troca;
        public int Place;
        public bool NewBest;
        public bool MultiplierRaised;
        public bool Finished;
        public DeathCause Cause;
    }

    public struct LiveStanding
    {
        public string Name;
        public float Distance;
        public bool Alive;
        public bool Finished;
        public float FinishTime;
        public bool IsLocal;
        public Color Color;
    }

    public struct Toast
    {
        public string Text;
        public Color Color;
        public float Remaining;
    }

    /// <summary>
    /// Composition root and flow controller for the lane runner: menus, endless runs, offline and online
    /// races, revives and rewards. Gameplay rules live in the engine-independent core; this class wires
    /// them to Unity views and to the existing Economy, Home and Biome services.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RunnerGame : MonoBehaviour
    {
        private const int MenuSeed = 20240;
        private static readonly Vector3 MenuStage = new Vector3(0f, 0f, 150f);

        private static readonly Color[] GhostColors =
        {
            new Color(0.2f, 0.85f, 1f),
            new Color(0.55f, 1f, 0.3f),
            new Color(1f, 0.35f, 0.85f),
            new Color(1f, 0.9f, 0.25f),
            new Color(0.7f, 0.5f, 1f)
        };

        [Header("Gameplay")]
        [SerializeField] private RunnerConfig config = new RunnerConfig();
        [SerializeField] private RaceRoomSettings offlineRace = new RaceRoomSettings();
        [SerializeField, Min(1f)] private float reviveOfferSeconds = 5f;
        [SerializeField, Min(0)] private int maxRevivesPerRun = 3;
        [SerializeField, Min(0)] private int starterGold = 200;
        [SerializeField, Min(0)] private int starterCredits = 3;

        [Header("Networking")]
        [SerializeField, Min(1f)] private float snapshotsPerSecond = 15f;
        [SerializeField, Min(0f)] private float interpolationDelay = 0.15f;

        private readonly List<RunnerCommand> commands = new List<RunnerCommand>(4);
        private readonly List<RunnerEvent> events = new List<RunnerEvent>(32);
        private readonly List<MissionState> completedMissions = new List<MissionState>();
        private readonly Dictionary<byte, RemoteRunner> remotes = new Dictionary<byte, RemoteRunner>();
        private readonly List<Toast> toasts = new List<Toast>();
        private readonly RunnerInputReader input = new RunnerInputReader();

        private EconomyManager economy;
        private HomeUpgradeSystem home;
        private BiomeManager biomes;
        private Transform worldRoot;
        private TrackView trackView;
        private RunnerAvatar player;
        private RunnerAvatar chaser;
        private RunnerCameraRig cameraRig;
        private RunnerAudio sound;

        private IRaceConnection connection;
        private JoinRoomMessage lastJoin;
        private bool offlineRaceMode;
        private bool localReady;
        private bool finishedSent;
        private bool runCommitted;
        private bool clockSynced;
        private float serverClock;
        private float pingTimer;

        private Track track;
        private float accumulator;
        private float snapshotTimer;
        private int revivesUsed;
        private int lastCountdownBeep;
        private int rewardGold;
        private int rewardCredits;
        private int rewardTroca;
        private int rewardGems;
        private float chaserX;
        private BiomeTheme theme;
        private Color skyColor;

        public static RunnerGame Instance { get; private set; }

        public RunnerConfig Config => config;
        public RunnerScreen CurrentScreen { get; private set; }
        public bool IsRace { get; private set; }
        public bool IsOfflineRace => IsRace && offlineRaceMode;
        public bool IsOfflineMode => offlineRaceMode;
        public bool IsOnline => connection is WebSocketRaceConnection;
        public RunnerSimulation Simulation { get; private set; }
        public RunnerProfileData Profile { get; private set; }
        public MissionTracker Missions { get; private set; }
        public EconomyManager Economy => economy;
        public HomeUpgradeSystem Home => home;
        public RunEarnings LastEarnings { get; private set; }
        public string StatusMessage { get; private set; }
        public byte LocalPlayerId { get; private set; }
        public string RoomCode { get; private set; }
        public RoomStateMessage Room { get; private set; }
        public RaceStartMessage RaceStart { get; private set; }
        public RaceResultMessage RaceResult { get; private set; }
        public bool LocalReady => localReady;
        public float LobbyAutoStart { get; private set; } = -1f;
        public float CountdownRemaining { get; private set; }
        public float ReviveRemaining { get; private set; }
        public float ReviveDuration => reviveOfferSeconds;
        public double PingMilliseconds { get; private set; } = -1;
        public IReadOnlyDictionary<byte, RemoteRunner> Remotes => remotes;
        public IReadOnlyList<Toast> Toasts => toasts;
        public Camera MainCamera => cameraRig ? cameraRig.Camera : null;
        public bool Muted => sound && sound.Muted;
        public bool CanPause => CurrentScreen == RunnerScreen.Playing && !IsOnline;
        public string BiomeName => theme.Name;
        public int ScoreMultiplier => 1 + Profile.MissionMultiplier + HomeBonus;

        /// <summary>Each building tier at home permanently adds +1 to the score multiplier.</summary>
        public int HomeBonus
        {
            get
            {
                if (!home) return 0;
                int tiers = 0;
                foreach (var upgrade in home.Tracks)
                    if (upgrade != null && !string.IsNullOrEmpty(upgrade.id)) tiers += home.GetTier(upgrade.id);
                return tiers;
            }
        }

        private void Awake()
        {
            if (Instance && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            Application.targetFrameRate = 60;
            Screen.sleepTimeout = SleepTimeout.NeverSleep;

            EnsureServices();
            LoadProfile();
            BuildScene();
            if (!GetComponent<RunnerHud>()) gameObject.AddComponent<RunnerHud>();
            ShowMenu();
        }

        private void OnDestroy()
        {
            DisposeConnection();
            if (Instance == this) Instance = null;
        }

        private void OnApplicationPause(bool paused)
        {
            if (paused && CanPause) Pause();
        }

        private void Update()
        {
            float dt = Time.deltaTime;
            PumpConnection(dt);
            UpdateToasts(dt);
            if (IsRace) serverClock += dt;

            switch (CurrentScreen)
            {
                case RunnerScreen.Lobby:
                    if (LobbyAutoStart > 0f) LobbyAutoStart = Mathf.Max(0f, LobbyAutoStart - dt);
                    UpdatePing(dt);
                    break;
                case RunnerScreen.Countdown:
                    UpdateCountdown(dt);
                    break;
                case RunnerScreen.Playing:
                    UpdatePlaying(dt);
                    break;
                case RunnerScreen.Paused:
                    if (input.PausePressed()) Resume();
                    break;
                case RunnerScreen.Revive:
                    ReviveRemaining -= dt;
                    if (ReviveRemaining <= 0f) DeclineRevive();
                    break;
            }
            UpdateRemotes();
        }

        private void LateUpdate()
        {
            float dt = Time.deltaTime;
            skyColor = Color.Lerp(skyColor, theme.Sky, 1f - Mathf.Exp(-1.5f * dt));
            ApplyAtmosphere();

            if (Simulation == null)
            {
                player.SetVisible(true);
                player.Apply(MenuStage, RunnerPose.Running, 0, 3f, dt);
                chaser.SetVisible(false);
                trackView.Refresh(MenuStage.z, false, Time.time);
                cameraRig.Frame(MenuStage, dt);
                return;
            }

            var sim = Simulation;
            float alpha = CurrentScreen == RunnerScreen.Playing ? Mathf.Clamp01(accumulator / config.FixedDeltaTime) : 1f;
            var position = new Vector3(
                Mathf.Lerp(sim.PreviousX, sim.X, alpha),
                Mathf.Lerp(sim.PreviousY, sim.Y, alpha),
                Mathf.Lerp(sim.PreviousDistance, sim.Distance, alpha));
            bool moving = CurrentScreen == RunnerScreen.Playing;
            var state = sim.ToNetState();

            player.SetVisible(!sim.IsInvulnerable || Mathf.Repeat(Time.time * 10f, 2f) > 0.7f);
            player.Apply(position, sim.Pose, state.PowerUps, moving ? sim.Speed : 0f, dt);

            float gap = sim.ChaserGap;
            bool showChaser = !sim.IsAlive || gap < config.ChaserFarGap - 1f;
            chaser.SetVisible(showChaser && !sim.IsFinished);
            if (showChaser)
            {
                chaserX = Mathf.Lerp(chaserX, position.x, 1f - Mathf.Exp(-4f * dt));
                var chaserPose = sim.IsAlive ? RunnerPose.Running : RunnerPose.Finished;
                chaser.Apply(new Vector3(chaserX, 0f, position.z - Mathf.Max(gap, 1f) - 0.4f), chaserPose, 0, moving ? sim.Speed : 0f, dt);
            }

            trackView.Refresh(position.z, sim.IsActive(PowerUpKind.Jetpack), Time.time);

            foreach (var remote in remotes.Values)
            {
                var d = remote.Display;
                bool visible = remote.HasState && Mathf.Abs(d.Distance - position.z) < 90f;
                remote.Avatar.SetVisible(visible);
                if (visible)
                    remote.Avatar.Apply(new Vector3(d.X, d.Y, d.Distance), d.Pose, d.PowerUps, d.Alive && !d.Finished ? config.SpeedAt(d.Distance) : 0f, dt);
            }

            float speed01 = Mathf.InverseLerp(config.BaseSpeed, config.MaxSpeed, sim.Speed);
            cameraRig.Follow(position, speed01, sim.IsActive(PowerUpKind.Jetpack), dt);
        }

        // ------------------------------------------------------------------ Flow (called by the HUD)

        public void OpenScreen(RunnerScreen screen)
        {
            if (screen == RunnerScreen.MainMenu || screen == RunnerScreen.Upgrades || screen == RunnerScreen.Home
                || screen == RunnerScreen.Missions || screen == RunnerScreen.OnlineSetup)
            {
                CurrentScreen = screen;
            }
        }

        public void StartEndless()
        {
            DisposeConnection();
            ClearRemotes();
            IsRace = false;
            RaceStart = null;
            RaceResult = null;
            StartRun(UnityEngine.Random.Range(int.MinValue, int.MaxValue), 0f);
            CurrentScreen = RunnerScreen.Playing;
            ShowToast("Swipe to dodge - don't let the Titan catch you!", Color.white);
        }

        public void StartOfflineRace()
        {
            DisposeConnection();
            offlineRaceMode = true;
            StatusMessage = null;
            connection = new LocalRaceConnection(config, offlineRace, UnityEngine.Random.Range(int.MinValue, int.MaxValue));
            lastJoin = new JoinRoomMessage { CreatePrivate = true, FillWithBots = true };
            connection.Send(new HelloMessage { Name = Profile.PlayerName });
            connection.Send(lastJoin);
            connection.Send(new ReadyMessage { Ready = true });
            CurrentScreen = RunnerScreen.Connecting;
        }

        /// <summary>Connects to a race server. Empty code = quick match; <paramref name="createPrivate"/> makes a room code to share.</summary>
        public void StartOnline(string url, string playerName, string roomCode, bool createPrivate)
        {
            Profile.PlayerName = RaceProtocol.SanitizeName(playerName);
            Profile.ServerUrl = (url ?? "").Trim();
            RunnerProfileStore.Save(Profile);
#if UNITY_WEBGL && !UNITY_EDITOR
            StatusMessage = "Online races need a native build (Android, iOS, desktop). WebGL is not supported yet.";
            return;
#else
            if (!Uri.TryCreate(Profile.ServerUrl, UriKind.Absolute, out var uri) || (uri.Scheme != "ws" && uri.Scheme != "wss"))
            {
                StatusMessage = "Server address must look like ws://host:5080/race";
                return;
            }
            DisposeConnection();
            offlineRaceMode = false;
            StatusMessage = null;
            connection = WebSocketRaceConnection.Connect(uri);
            lastJoin = new JoinRoomMessage
            {
                RoomCode = createPrivate ? "" : (roomCode ?? "").Trim().ToUpperInvariant(),
                CreatePrivate = createPrivate,
                FillWithBots = true
            };
            connection.Send(new HelloMessage { Name = Profile.PlayerName });
            connection.Send(lastJoin);
            CurrentScreen = RunnerScreen.Connecting;
#endif
        }

        public void ToggleReady()
        {
            if (connection == null || CurrentScreen != RunnerScreen.Lobby) return;
            localReady = !localReady;
            connection.Send(new ReadyMessage { Ready = localReady });
        }

        /// <summary>Leaves the current lobby or race and returns to the main menu.</summary>
        public void LeaveRace()
        {
            if (connection != null && connection.IsOpen) connection.Send(new LeaveMessage());
            DisposeConnection();
            ShowMenu();
        }

        public void RaceAgain()
        {
            if (offlineRaceMode || connection == null || !connection.IsOpen)
            {
                if (offlineRaceMode) StartOfflineRace();
                else OpenScreen(RunnerScreen.OnlineSetup);
                return;
            }
            ClearRace();
            lastJoin = lastJoin != null && lastJoin.CreatePrivate
                ? new JoinRoomMessage { CreatePrivate = true, FillWithBots = true }
                : new JoinRoomMessage { FillWithBots = true };
            connection.Send(lastJoin);
            CurrentScreen = RunnerScreen.Connecting;
        }

        public void Pause()
        {
            if (!CanPause) return;
            CurrentScreen = RunnerScreen.Paused;
            sound.SetMusic(false);
        }

        public void Resume()
        {
            if (CurrentScreen != RunnerScreen.Paused) return;
            accumulator = 0f;
            CurrentScreen = RunnerScreen.Playing;
            sound.SetMusic(true);
        }

        public void QuitToMenu()
        {
            if (Simulation != null && !runCommitted) CommitRun(0);
            LeaveRace();
        }

        public void AcceptRevive()
        {
            if (CurrentScreen != RunnerScreen.Revive) return;
            if (economy.TryConsumeReviveCredit() && Simulation.Revive())
            {
                revivesUsed++;
                accumulator = 0f;
                CurrentScreen = RunnerScreen.Playing;
                ShowToast("Back in the run!", new Color(0.4f, 1f, 0.5f));
                return;
            }
            EndRun();
        }

        public void DeclineRevive()
        {
            if (CurrentScreen == RunnerScreen.Revive) EndRun();
        }

        public bool UpgradePowerUp(PowerUpKind kind)
        {
            int level = Profile.PowerUpLevels[(int)kind];
            int cost = PowerUpUpgrades.CostForNextLevel(level);
            if (cost < 0 || !economy.TrySpendGold(cost))
            {
                sound.Play(RunnerSound.Stumble, 0.5f);
                return false;
            }
            Profile.PowerUpLevels[(int)kind] = level + 1;
            RunnerProfileStore.Save(Profile);
            sound.Play(RunnerSound.PowerUp);
            return true;
        }

        public bool UpgradeHome(string trackId)
        {
            if (!home || !home.TryUpgrade(trackId))
            {
                sound.Play(RunnerSound.Stumble, 0.5f);
                return false;
            }
            sound.Play(RunnerSound.Mystery);
            ShowToast($"Built! Score multiplier is now x{ScoreMultiplier}", new Color(1f, 0.85f, 0.3f));
            return true;
        }

        public void ToggleMute()
        {
            sound.Muted = !sound.Muted;
        }

        public void PlayClick() => sound.Play(RunnerSound.Click, 0.6f);

        /// <summary>Live race order: finishers by time, then everyone else by distance.</summary>
        public void GetLiveStandings(List<LiveStanding> into)
        {
            into.Clear();
            if (Simulation == null) return;
            into.Add(new LiveStanding
            {
                Name = Profile.PlayerName,
                Distance = Simulation.Distance,
                Alive = Simulation.IsAlive,
                Finished = Simulation.IsFinished,
                FinishTime = Simulation.FinishTime,
                IsLocal = true,
                Color = new Color(1f, 0.55f, 0.15f)
            });
            foreach (var remote in remotes.Values)
            {
                if (!remote.HasState) continue;
                into.Add(new LiveStanding
                {
                    Name = remote.Info.Name,
                    Distance = remote.Display.Distance,
                    Alive = remote.Display.Alive,
                    Finished = remote.Display.Finished,
                    FinishTime = remote.Display.FinishTime,
                    Color = remote.Color
                });
            }
            into.Sort((a, b) =>
            {
                if (a.Finished != b.Finished) return a.Finished ? -1 : 1;
                if (a.Finished) return a.FinishTime.CompareTo(b.FinishTime);
                return b.Distance.CompareTo(a.Distance);
            });
        }

        public static string PowerUpName(PowerUpKind kind)
        {
            switch (kind)
            {
                case PowerUpKind.Magnet: return "Coin Magnet";
                case PowerUpKind.Jetpack: return "Jetpack";
                case PowerUpKind.SuperSneakers: return "Super Sneakers";
                case PowerUpKind.Multiplier: return "2x Multiplier";
                default: return "Shield Board";
            }
        }

        public static string PowerUpDescription(PowerUpKind kind)
        {
            switch (kind)
            {
                case PowerUpKind.Magnet: return "Pulls every nearby coin into your pocket.";
                case PowerUpKind.Jetpack: return "Fly above the chaos through a trail of sky coins.";
                case PowerUpKind.SuperSneakers: return "Jump high enough to land on train roofs.";
                case PowerUpKind.Multiplier: return "Doubles every point you earn.";
                default: return "Absorbs one crash or one capture.";
            }
        }

        // ------------------------------------------------------------------ Setup

        private void EnsureServices()
        {
            economy = EconomyManager.Instance ? EconomyManager.Instance : new GameObject("EconomyManager").AddComponent<EconomyManager>();
            home = HomeUpgradeSystem.Instance ? HomeUpgradeSystem.Instance : new GameObject("HomeUpgradeSystem").AddComponent<HomeUpgradeSystem>();
            home.EnsureTracks(DefaultHomeTracks());
            biomes = FindFirstObjectByType<BiomeManager>();
            if (!biomes) biomes = new GameObject("BiomeManager").AddComponent<BiomeManager>();
        }

        private void LoadProfile()
        {
            Profile = RunnerProfileStore.Load();
            Missions = new MissionTracker(Profile);
            if (Profile.StarterPackGranted) return;
            economy.AddGold(starterGold);
            economy.AddCredits(starterCredits);
            Profile.StarterPackGranted = true;
            RunnerProfileStore.Save(Profile);
        }

        private void BuildScene()
        {
            var cam = Camera.main;
            if (!cam)
            {
                var go = new GameObject("Main Camera") { tag = "MainCamera" };
                cam = go.AddComponent<Camera>();
            }
            if (!FindFirstObjectByType<AudioListener>()) cam.gameObject.AddComponent<AudioListener>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.nearClipPlane = 0.1f;
            cam.farClipPlane = 260f;
            cameraRig = cam.GetComponent<RunnerCameraRig>();
            if (!cameraRig) cameraRig = cam.gameObject.AddComponent<RunnerCameraRig>();

            Light sun = null;
            foreach (var light in FindObjectsByType<Light>(FindObjectsSortMode.None))
                if (light.type == LightType.Directional) sun = light;
            if (!sun)
            {
                sun = new GameObject("Sun").AddComponent<Light>();
                sun.type = LightType.Directional;
            }
            sun.transform.rotation = Quaternion.Euler(50f, -35f, 0f);
            sun.intensity = 1.15f;
            sun.shadows = LightShadows.Soft;

            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogStartDistance = 55f;
            RenderSettings.fogEndDistance = 190f;

            worldRoot = new GameObject("Runner World").transform;
            worldRoot.SetParent(transform, false);
            trackView = new GameObject("Track").AddComponent<TrackView>();
            trackView.transform.SetParent(worldRoot, false);
            player = RunnerAvatar.Create(worldRoot, "Player", new Color(1f, 0.82f, 0.66f), new Color(1f, 0.45f, 0.1f),
                new Color(0.15f, 0.3f, 0.7f), new Color(1f, 0.85f, 0.2f));
            chaser = RunnerAvatar.Create(worldRoot, "Titan", new Color(0.45f, 0.55f, 0.45f), new Color(0.2f, 0.22f, 0.25f),
                new Color(0.12f, 0.12f, 0.14f), new Color(0.55f, 0.1f, 0.1f), 1.6f, chaser: true);
            chaser.SetVisible(false);

            sound = GetComponent<RunnerAudio>();
            if (!sound) sound = gameObject.AddComponent<RunnerAudio>();
            sound.SetMusic(true);
        }

        private static HomeUpgradeSystem.UpgradeTrack[] DefaultHomeTracks()
        {
            HomeUpgradeSystem.UpgradeTier Tier(string name, int gems, string text) =>
                new HomeUpgradeSystem.UpgradeTier { displayName = name, gemCost = gems, description = text };
            return new[]
            {
                new HomeUpgradeSystem.UpgradeTrack
                {
                    id = "house",
                    tiers = new[]
                    {
                        Tier("Foundation", 3, "Clear the rubble and pour a stone foundation."),
                        Tier("Walls", 6, "Raise sturdy walls against the Titans."),
                        Tier("Roof", 10, "A proper roof - finally a dry night's sleep."),
                        Tier("Garden", 16, "Fresh food and a place to rest."),
                        Tier("Watchtower", 25, "See the Titans coming from miles away.")
                    }
                },
                new HomeUpgradeSystem.UpgradeTrack
                {
                    id = "workshop",
                    tiers = new[]
                    {
                        Tier("Workbench", 4, "Repair your gear between runs."),
                        Tier("Forge", 9, "Smelt the gold you rescued."),
                        Tier("Gadget Lab", 18, "Tinker with jetpacks and magnets.")
                    }
                },
                new HomeUpgradeSystem.UpgradeTrack
                {
                    id = "vault",
                    tiers = new[]
                    {
                        Tier("Strongbox", 5, "Keep your savings safe."),
                        Tier("Gold Vault", 12, "A vault worthy of a champion."),
                        Tier("Titan Treasury", 30, "The richest hall in the land.")
                    }
                }
            };
        }

        // ------------------------------------------------------------------ Runs

        private void ShowMenu()
        {
            ClearRace();
            IsRace = false;
            offlineRaceMode = false;
            Simulation = null;
            // Scenery-only track for the menu backdrop, so the hero never stands inside an obstacle.
            track = new Track(MenuSeed, config, index => new TrackChunk
            {
                Index = index,
                StartZ = index * config.ChunkLength,
                EndZ = (index + 1) * config.ChunkLength,
                DecorSeed = DeterministicRandom.Hash(MenuSeed, index),
                Items = Array.Empty<TrackItem>()
            });
            trackView.Bind(track, null, 0f);
            SetTheme(0, true);
            sound.SetMusic(true);
            CurrentScreen = RunnerScreen.MainMenu;
        }

        private void StartRun(int seed, float finishDistance)
        {
            track = new Track(seed, config);
            Simulation = new RunnerSimulation(track, new RunnerModifiers
            {
                ScoreMultiplier = ScoreMultiplier,
                PowerUpLevels = (int[])Profile.PowerUpLevels.Clone(),
                FinishDistance = finishDistance
            });
            trackView.Bind(track, Simulation.IsConsumed, finishDistance);
            accumulator = 0f;
            snapshotTimer = 0f;
            revivesUsed = 0;
            finishedSent = false;
            runCommitted = false;
            rewardGold = rewardCredits = rewardTroca = rewardGems = 0;
            chaserX = Simulation.X;
            LastEarnings = null;
            Missions.BeginRun();
            if (biomes)
            {
                biomes.ResetStageOneTimer();
                biomes.SetBiome(0);
            }
            SetTheme(0, true);
            sound.SetMusic(true);
        }

        private void UpdatePlaying(float dt)
        {
            if (input.PausePressed() && CanPause)
            {
                Pause();
                return;
            }
            commands.Clear();
            input.Poll(commands);
            foreach (var command in commands) Simulation.Enqueue(command);

            accumulator += Mathf.Min(dt, 0.1f);
            float step = config.FixedDeltaTime;
            int steps = 0;
            while (accumulator >= step && steps++ < 10)
            {
                Simulation.Step();
                accumulator -= step;
            }

            ProcessEvents();
            Missions.ObserveRun((int)Simulation.Distance, Simulation.Score);
            AnnounceMissions();

            if (IsRace && connection != null)
            {
                snapshotTimer -= dt;
                if (snapshotTimer <= 0f)
                {
                    snapshotTimer = 1f / snapshotsPerSecond;
                    connection.Send(new SnapshotMessage { RaceTime = Simulation.Time, State = Simulation.ToNetState() });
                }
            }

            if (Simulation.IsFinished) OnFinishLine();
            else if (!Simulation.IsAlive) OnDeath();
        }

        private void ProcessEvents()
        {
            events.Clear();
            Simulation.DrainEvents(events);
            foreach (var e in events)
            {
                Missions.Observe(e);
                switch (e.Type)
                {
                    case RunnerEventType.Coin:
                        sound.Play(RunnerSound.Coin, 0.8f);
                        break;
                    case RunnerEventType.Gem:
                        sound.Play(RunnerSound.Gem);
                        ShowToast("+1 GEM", new Color(0.3f, 0.95f, 1f));
                        break;
                    case RunnerEventType.Jump:
                        sound.Play(RunnerSound.Jump, 0.7f);
                        break;
                    case RunnerEventType.Roll:
                        sound.Play(RunnerSound.Roll, 0.7f);
                        break;
                    case RunnerEventType.LaneChange:
                        sound.Play(RunnerSound.Lane, 0.6f);
                        break;
                    case RunnerEventType.BlockedLaneChange:
                        cameraRig.Shake(0.08f);
                        break;
                    case RunnerEventType.PowerUp:
                        sound.Play(RunnerSound.PowerUp);
                        ShowToast(PowerUpName((PowerUpKind)e.Value).ToUpperInvariant() + "!", new Color(0.75f, 0.55f, 1f));
                        break;
                    case RunnerEventType.MysteryBox:
                        OnMysteryBox((MysteryReward)e.Value);
                        break;
                    case RunnerEventType.Stumble:
                        sound.Play(RunnerSound.Stumble);
                        cameraRig.Shake(0.25f);
                        if (Simulation.IsAlive) ShowToast("Careful! The Titan is right behind you!", new Color(1f, 0.55f, 0.2f));
                        break;
                    case RunnerEventType.ShieldBreak:
                        sound.Play(RunnerSound.ShieldBreak);
                        cameraRig.Shake(0.3f);
                        ShowToast("Shield saved you!", new Color(0.4f, 0.75f, 1f));
                        break;
                    case RunnerEventType.Crash:
                    case RunnerEventType.Caught:
                        sound.Play(RunnerSound.Crash);
                        cameraRig.Shake(0.6f);
#if UNITY_ANDROID || UNITY_IOS
                        Handheld.Vibrate();
#endif
                        break;
                    case RunnerEventType.Finish:
                        sound.Play(RunnerSound.Finish);
                        break;
                    case RunnerEventType.Revive:
                        sound.Play(RunnerSound.PowerUp);
                        break;
                    case RunnerEventType.BiomeChanged:
                        if (biomes) biomes.SetBiome(e.Value);
                        SetTheme(e.Value, false);
                        ShowToast("Entering " + theme.Name, Color.white);
                        break;
                }
            }
        }

        private void OnMysteryBox(MysteryReward reward)
        {
            int amount = MysteryRewards.Amount(reward);
            string label;
            switch (reward)
            {
                case MysteryReward.Credits:
                    rewardCredits += amount;
                    label = amount == 1 ? "CREDIT" : "CREDITS";
                    break;
                case MysteryReward.Troca:
                    rewardTroca += amount;
                    label = "TROCA";
                    break;
                case MysteryReward.Gems:
                    rewardGems += amount;
                    label = "GEMS";
                    break;
                case MysteryReward.Jackpot:
                    rewardGold += amount;
                    label = "GOLD - JACKPOT!";
                    break;
                default:
                    rewardGold += amount;
                    label = "GOLD";
                    break;
            }
            sound.Play(RunnerSound.Mystery);
            ShowToast($"MYSTERY BOX: +{amount} {label}", new Color(0.8f, 0.5f, 1f));
        }

        private void AnnounceMissions()
        {
            completedMissions.Clear();
            Missions.DrainNewlyCompleted(completedMissions);
            foreach (var mission in completedMissions)
            {
                sound.Play(RunnerSound.Mystery, 0.8f);
                ShowToast("Mission complete: " + MissionTracker.Describe(mission), new Color(0.45f, 1f, 0.45f));
            }
        }

        private void UpdateCountdown(float dt)
        {
            CountdownRemaining -= dt;
            int whole = Mathf.CeilToInt(CountdownRemaining);
            if (whole > 0 && whole != lastCountdownBeep)
            {
                lastCountdownBeep = whole;
                sound.Play(RunnerSound.Beep);
            }
            if (CountdownRemaining > 0f) return;
            accumulator = 0f;
            CurrentScreen = RunnerScreen.Playing;
            sound.Play(RunnerSound.Go);
        }

        private void OnDeath()
        {
            if (revivesUsed < maxRevivesPerRun && economy.Credits > 0)
            {
                ReviveRemaining = reviveOfferSeconds;
                CurrentScreen = RunnerScreen.Revive;
                return;
            }
            EndRun();
        }

        private void OnFinishLine()
        {
            ShowToast("FINISHED!", new Color(1f, 0.85f, 0.3f));
            EndRun();
        }

        private void EndRun()
        {
            if (IsRace && connection != null)
            {
                if (!finishedSent)
                {
                    finishedSent = true;
                    connection.Send(new FinishedMessage { State = Simulation.ToNetState() });
                }
                CurrentScreen = RunnerScreen.RaceWaiting;
                return;
            }
            CommitRun(0);
            CurrentScreen = RunnerScreen.GameOver;
        }

        private void CommitRun(int place)
        {
            if (runCommitted || Simulation == null) return;
            runCommitted = true;
            var sim = Simulation;
            var earnings = new RunEarnings
            {
                Score = sim.Score,
                Distance = (int)sim.Distance,
                Coins = sim.Coins,
                Gems = sim.Gems + rewardGems,
                Gold = sim.Coins + rewardGold,
                Credits = rewardCredits,
                Troca = rewardTroca,
                Place = place,
                Finished = sim.IsFinished,
                Cause = sim.DeathCause
            };
            if (place == 1)
            {
                earnings.Gold += 100;
                Profile.RaceWins++;
            }
            else if (place == 2)
            {
                earnings.Gold += 50;
            }
            else if (place == 3)
            {
                earnings.Gold += 25;
            }

            economy.AddGold(earnings.Gold);
            economy.AddGems(earnings.Gems);
            economy.AddCredits(earnings.Credits);
            economy.AddTroca(earnings.Troca);

            Profile.TotalRuns++;
            if (earnings.Score > Profile.BestScore)
            {
                Profile.BestScore = earnings.Score;
                earnings.NewBest = true;
            }
            Profile.BestDistance = Math.Max(Profile.BestDistance, earnings.Distance);
            if (Missions.TryAdvanceSet())
            {
                earnings.MultiplierRaised = true;
                economy.AddCredits(1);
                ShowToast($"All missions done! Multiplier is now x{ScoreMultiplier} (+1 Credit)", new Color(1f, 0.85f, 0.3f));
            }
            RunnerProfileStore.Save(Profile);
            LastEarnings = earnings;
        }

        // ------------------------------------------------------------------ Networking

        private void PumpConnection(float dt)
        {
            if (connection == null) return;
            if (CurrentScreen != RunnerScreen.Paused) connection.Update(dt);
            while (connection != null && connection.TryReceive(out var message)) Handle(message);
            if (connection != null && !connection.IsOpen && !connection.IsConnecting)
                OnConnectionLost(connection.LastError ?? "Disconnected from the race server.");
        }

        private void Handle(IRaceMessage message)
        {
            switch (message)
            {
                case WelcomeMessage welcome:
                    LocalPlayerId = welcome.PlayerId;
                    RoomCode = welcome.RoomCode;
                    localReady = offlineRaceMode;
                    Room = null;
                    RaceResult = null;
                    StatusMessage = null;
                    LobbyAutoStart = -1f;
                    if (!offlineRaceMode) CurrentScreen = RunnerScreen.Lobby;
                    break;
                case RoomStateMessage room:
                    Room = room;
                    LobbyAutoStart = room.AutoStartIn;
                    break;
                case RaceStartMessage start:
                    BeginRace(start);
                    break;
                case WorldStateMessage world:
                    OnWorldState(world);
                    break;
                case RaceResultMessage result:
                    OnRaceResult(result);
                    break;
                case ErrorMessage error:
                    StatusMessage = error.Text;
                    if (CurrentScreen == RunnerScreen.Connecting)
                    {
                        DisposeConnection();
                        CurrentScreen = RunnerScreen.OnlineSetup;
                    }
                    else
                    {
                        ShowToast(error.Text, new Color(1f, 0.4f, 0.35f));
                    }
                    break;
                case PongMessage pong:
                    PingMilliseconds = (Time.realtimeSinceStartupAsDouble - pong.ClientTime) * 1000.0;
                    break;
            }
        }

        private void BeginRace(RaceStartMessage start)
        {
            ClearRemotes();
            RaceStart = start;
            RaceResult = null;
            IsRace = true;
            clockSynced = false;
            serverClock = -start.Countdown;
            int colorIndex = 0;
            foreach (var info in start.Players)
            {
                if (info.Id == LocalPlayerId) continue;
                var color = GhostColors[colorIndex++ % GhostColors.Length];
                var remote = new RemoteRunner { Info = info, Color = color };
                remote.Avatar = RunnerAvatar.Create(worldRoot, "Racer " + info.Name, new Color(1f, 0.85f, 0.7f), color,
                    Color.Lerp(color, Color.black, 0.45f), Color.white, 1f, translucent: true);
                remote.Avatar.SetVisible(false);
                remotes[info.Id] = remote;
            }
            StartRun(start.Seed, start.RaceLength);
            CountdownRemaining = start.Countdown;
            lastCountdownBeep = int.MaxValue;
            CurrentScreen = RunnerScreen.Countdown;
        }

        private void OnWorldState(WorldStateMessage world)
        {
            if (!clockSynced || Mathf.Abs(serverClock - world.RaceTime) > 0.5f)
            {
                serverClock = world.RaceTime;
                clockSynced = true;
            }
            else
            {
                serverClock += (world.RaceTime - serverClock) * 0.1f;
            }
            foreach (var entry in world.Players)
                if (entry.Id != LocalPlayerId && remotes.TryGetValue(entry.Id, out var remote))
                    remote.Buffer.Add(world.RaceTime, entry.State);
        }

        private void UpdateRemotes()
        {
            if (!IsRace) return;
            float renderTime = serverClock - interpolationDelay;
            foreach (var remote in remotes.Values)
            {
                if (!remote.Buffer.TrySample(renderTime, out var state)) continue;
                remote.Display = state;
                remote.HasState = true;
            }
        }

        private void OnRaceResult(RaceResultMessage result)
        {
            RaceResult = result;
            int place = 0;
            foreach (var standing in result.Standings)
                if (standing.Id == LocalPlayerId) place = standing.Place;
            finishedSent = true;
            CommitRun(place);
            CurrentScreen = RunnerScreen.RaceResults;
            sound.Play(place == 1 ? RunnerSound.Finish : RunnerSound.Beep);
        }

        private void OnConnectionLost(string reason)
        {
            DisposeConnection();
            StatusMessage = reason;
            switch (CurrentScreen)
            {
                case RunnerScreen.Connecting:
                case RunnerScreen.Lobby:
                case RunnerScreen.Countdown:
                    ShowMenu();
                    CurrentScreen = RunnerScreen.OnlineSetup;
                    break;
                case RunnerScreen.Playing:
                case RunnerScreen.Revive:
                case RunnerScreen.Paused:
                    ShowToast("Connection lost - your run continues offline.", new Color(1f, 0.6f, 0.3f));
                    break;
                case RunnerScreen.RaceWaiting:
                    CommitRun(0);
                    CurrentScreen = RunnerScreen.GameOver;
                    break;
            }
        }

        private void UpdatePing(float dt)
        {
            if (!IsOnline) return;
            pingTimer -= dt;
            if (pingTimer > 0f) return;
            pingTimer = 2f;
            connection.Send(new PingMessage { ClientTime = Time.realtimeSinceStartupAsDouble });
        }

        private void DisposeConnection()
        {
            connection?.Dispose();
            connection = null;
            PingMilliseconds = -1;
        }

        private void ClearRace()
        {
            ClearRemotes();
            Room = null;
            RaceStart = null;
            RaceResult = null;
            localReady = false;
        }

        private void ClearRemotes()
        {
            foreach (var remote in remotes.Values)
                if (remote.Avatar) Destroy(remote.Avatar.gameObject);
            remotes.Clear();
        }

        // ------------------------------------------------------------------ Presentation helpers

        private void SetTheme(int biome, bool instant)
        {
            theme = BiomePalette.Get(biome);
            if (instant) skyColor = theme.Sky;
            ApplyAtmosphere();
        }

        private void ApplyAtmosphere()
        {
            if (cameraRig) cameraRig.Camera.backgroundColor = skyColor;
            RenderSettings.fogColor = skyColor;
            RenderSettings.ambientLight = Color.Lerp(skyColor, Color.white, 0.5f) * 0.85f;
        }

        public void ShowToast(string text, Color color)
        {
            if (toasts.Count >= 4) toasts.RemoveAt(0);
            toasts.Add(new Toast { Text = text, Color = color, Remaining = 2.6f });
        }

        private void UpdateToasts(float dt)
        {
            for (int i = toasts.Count - 1; i >= 0; i--)
            {
                var toast = toasts[i];
                toast.Remaining -= dt;
                if (toast.Remaining <= 0f) toasts.RemoveAt(i);
                else toasts[i] = toast;
            }
        }
    }
}
