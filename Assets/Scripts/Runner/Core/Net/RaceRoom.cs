using System;
using System.Collections.Generic;

namespace TitanEarthfall.Runner.Net
{
    [Serializable]
    public sealed class RaceRoomSettings
    {
        public int MaxPlayers = 4;
        public float CountdownSeconds = 3f;
        public float RaceLength = 1500f;
        public float TimeLimitSeconds = 240f;
        public float BroadcastInterval = 0.1f;
        /// <summary>Public rooms start this long after the first human is ready, filling empty seats with bots.</summary>
        public float QuickMatchAutoStartSeconds = 8f;
        public float ResultsLingerSeconds = 10f;
        /// <summary>Distance tolerance (meters) before a snapshot counts as a speed violation.</summary>
        public float SnapshotTolerance = 10f;
        public float[] BotSkills = { 0.985f, 0.95f, 0.9f, 0.85f };
        public string[] BotNames = { "Titan Tom", "Rusty", "Blaze", "Nova", "Dune", "Pixel", "Echo", "Rook" };
    }

    public sealed class RacePlayer
    {
        public byte Id;
        public string Name;
        public bool IsBot;
        public bool Ready;
        public bool Connected = true;
        /// <summary>Out of the race: finished, crashed for good or disconnected.</summary>
        public bool Done;
        public RunnerNetState State;
        public int Violations;

        internal RunnerSimulation BotSim;
        internal RunnerBot Bot;

        public RacePlayerInfo ToInfo() => new RacePlayerInfo { Id = Id, Name = Name, IsBot = IsBot, Ready = Ready, Connected = Connected };
    }

    public readonly struct RaceOutbound
    {
        /// <summary>Player id the message is for; 0 means every player in the room.</summary>
        public readonly byte Target;
        public readonly IRaceMessage Message;

        public RaceOutbound(byte target, IRaceMessage message)
        {
            Target = target;
            Message = message;
        }
    }

    /// <summary>
    /// Engine-independent race room state machine (Lobby → Countdown → Racing → Results → Closed).
    /// Every client simulates its own runner on the shared seeded track; the room relays snapshots,
    /// sanity-checks them, simulates bots and decides the final standings.
    /// </summary>
    public sealed class RaceRoom
    {
        private readonly RunnerConfig config;
        private readonly RaceRoomSettings settings;
        private readonly List<RacePlayer> players = new List<RacePlayer>();
        private readonly List<RaceOutbound> outbound = new List<RaceOutbound>();
        private Track track;
        private float phaseTimer;
        private float autoStartTimer = -1f;
        private float broadcastTimer;
        private float botAccumulator;
        private byte nextId = 1;
        private float minimumFinishTime;

        public RaceRoom(string code, bool isPrivate, int seed, RunnerConfig config, RaceRoomSettings settings)
        {
            Code = code;
            IsPrivate = isPrivate;
            Seed = seed;
            this.config = config ?? throw new ArgumentNullException(nameof(config));
            this.settings = settings ?? throw new ArgumentNullException(nameof(settings));
        }

        public string Code { get; }
        public bool IsPrivate { get; }
        public int Seed { get; }
        public bool FillWithBots { get; set; } = true;
        public RoomPhase Phase { get; private set; } = RoomPhase.Lobby;
        public float RaceTime { get; private set; }
        public RaceResultMessage Result { get; private set; }
        public IReadOnlyList<RacePlayer> Players => players;
        public bool HasFreeSlot => Phase == RoomPhase.Lobby && players.Count < settings.MaxPlayers;

        public int ConnectedHumans
        {
            get
            {
                int count = 0;
                foreach (var p in players) if (!p.IsBot && p.Connected) count++;
                return count;
            }
        }

        public RacePlayer Find(byte id)
        {
            foreach (var p in players) if (p.Id == id) return p;
            return null;
        }

        /// <summary>Adds a human in the lobby. Returns the new player id, or 0 when the room cannot take them.</summary>
        public byte AddHuman(string name)
        {
            if (!HasFreeSlot) return 0;
            var player = new RacePlayer { Id = nextId++, Name = RaceProtocol.SanitizeName(name) };
            players.Add(player);
            BroadcastRoomState();
            return player.Id;
        }

        public void RemovePlayer(byte id)
        {
            var player = Find(id);
            if (player == null) return;
            if (Phase == RoomPhase.Lobby)
            {
                players.Remove(player);
                if (ConnectedHumans == 0) Phase = RoomPhase.Closed;
                else BroadcastRoomState();
                return;
            }
            player.Connected = false;
            player.Done = true;
            if (ConnectedHumans == 0 && Phase != RoomPhase.Results) Phase = RoomPhase.Closed;
        }

        public void SetReady(byte id, bool ready)
        {
            var player = Find(id);
            if (player == null || player.IsBot || Phase != RoomPhase.Lobby || player.Ready == ready) return;
            player.Ready = ready;
            if (!IsPrivate && autoStartTimer < 0f && ready) autoStartTimer = settings.QuickMatchAutoStartSeconds;
            BroadcastRoomState();
        }

        public void HandleSnapshot(byte id, SnapshotMessage message)
        {
            var player = Find(id);
            if (player == null || player.IsBot || player.Done || Phase != RoomPhase.Racing) return;
            player.State = Validate(player, message.State, false);
        }

        public void HandleFinished(byte id, FinishedMessage message)
        {
            var player = Find(id);
            if (player == null || player.IsBot || player.Done) return;
            if (Phase != RoomPhase.Racing && Phase != RoomPhase.Countdown) return;
            player.State = Validate(player, message.State, true);
            player.Done = true;
        }

        public void Tick(float deltaTime)
        {
            if (deltaTime <= 0f) return;
            switch (Phase)
            {
                case RoomPhase.Lobby:
                    TickLobby(deltaTime);
                    break;
                case RoomPhase.Countdown:
                    phaseTimer -= deltaTime;
                    if (phaseTimer <= 0f)
                    {
                        Phase = RoomPhase.Racing;
                        RaceTime = 0f;
                        broadcastTimer = 0f;
                    }
                    break;
                case RoomPhase.Racing:
                    TickRace(deltaTime);
                    break;
                case RoomPhase.Results:
                    phaseTimer -= deltaTime;
                    if (phaseTimer <= 0f) Phase = RoomPhase.Closed;
                    break;
            }
        }

        public void DrainOutbound(List<RaceOutbound> into)
        {
            into.AddRange(outbound);
            outbound.Clear();
        }

        private void TickLobby(float deltaTime)
        {
            int humans = 0, ready = 0;
            foreach (var p in players)
            {
                if (p.IsBot || !p.Connected) continue;
                humans++;
                if (p.Ready) ready++;
            }
            if (humans == 0) return;

            bool everyoneReady = ready == humans;
            bool enoughPlayers = humans >= 2 || FillWithBots;
            if (IsPrivate)
            {
                if (everyoneReady && enoughPlayers) StartCountdown();
                return;
            }

            if (everyoneReady && humans >= settings.MaxPlayers)
            {
                StartCountdown();
                return;
            }
            if (autoStartTimer < 0f) return;
            autoStartTimer -= deltaTime;
            if (autoStartTimer <= 0f)
            {
                if (enoughPlayers && ready > 0) StartCountdown();
                else autoStartTimer = -1f;
            }
        }

        private void StartCountdown()
        {
            if (FillWithBots)
            {
                int botIndex = 0;
                while (players.Count < settings.MaxPlayers)
                {
                    var names = settings.BotNames;
                    string name = names != null && names.Length > 0 ? names[(int)((uint)(Seed + botIndex) % (uint)names.Length)] : "Bot";
                    float skill = settings.BotSkills != null && settings.BotSkills.Length > 0
                        ? settings.BotSkills[botIndex % settings.BotSkills.Length]
                        : 0.85f;
                    var bot = new RacePlayer { Id = nextId++, Name = name, IsBot = true, Ready = true };
                    bot.Bot = new RunnerBot(DeterministicRandom.Hash(Seed, 1000 + bot.Id), skill);
                    players.Add(bot);
                    botIndex++;
                }
            }

            track = new Track(Seed, config);
            minimumFinishTime = config.MinimumTimeFor(settings.RaceLength) - 0.5f;
            foreach (var p in players)
            {
                p.State = new RunnerNetState { X = config.LaneX(config.MiddleLane), Alive = true };
                if (!p.IsBot) continue;
                p.BotSim = new RunnerSimulation(track, new RunnerModifiers { FinishDistance = settings.RaceLength }) { RecordEvents = false };
                p.State = p.BotSim.ToNetState();
            }

            Phase = RoomPhase.Countdown;
            phaseTimer = settings.CountdownSeconds;
            autoStartTimer = -1f;
            var start = new RaceStartMessage { Seed = Seed, RaceLength = settings.RaceLength, Countdown = settings.CountdownSeconds };
            foreach (var p in players) start.Players.Add(p.ToInfo());
            outbound.Add(new RaceOutbound(0, start));
        }

        private void TickRace(float deltaTime)
        {
            RaceTime += deltaTime;
            botAccumulator += deltaTime;
            float step = config.FixedDeltaTime;
            while (botAccumulator >= step)
            {
                botAccumulator -= step;
                StepBots();
            }

            broadcastTimer -= deltaTime;
            if (broadcastTimer <= 0f)
            {
                broadcastTimer = settings.BroadcastInterval;
                BroadcastWorld();
            }

            bool humansDone = true;
            foreach (var p in players)
                if (!p.IsBot && !p.Done) humansDone = false;

            if (humansDone || RaceTime >= settings.TimeLimitSeconds)
            {
                // Nobody is watching the bots any more: resolve their races instantly and deterministically.
                while (RaceTime < settings.TimeLimitSeconds && AnyBotRunning())
                {
                    RaceTime += step;
                    StepBots();
                }
                FinishRace();
            }
        }

        private bool AnyBotRunning()
        {
            foreach (var p in players)
                if (p.IsBot && !p.Done) return true;
            return false;
        }

        private void StepBots()
        {
            foreach (var p in players)
            {
                if (!p.IsBot || p.Done || p.BotSim == null) continue;
                p.BotSim.Enqueue(p.Bot.Decide(p.BotSim));
                p.BotSim.Step();
                p.State = p.BotSim.ToNetState();
                if (!p.BotSim.IsAlive || p.BotSim.IsFinished) p.Done = true;
            }
        }

        private void FinishRace()
        {
            BroadcastWorld();
            var ordered = new List<RacePlayer>(players);
            ordered.Sort(CompareStanding);
            var result = new RaceResultMessage();
            for (int i = 0; i < ordered.Count; i++)
            {
                var p = ordered[i];
                result.Standings.Add(new RaceStanding
                {
                    Id = p.Id,
                    Name = p.Name,
                    Place = (byte)(i + 1),
                    IsBot = p.IsBot,
                    Finished = p.State.Finished,
                    FinishTime = p.State.FinishTime,
                    Distance = p.State.Distance,
                    Score = p.State.Score,
                    Coins = p.State.Coins
                });
            }
            Result = result;
            outbound.Add(new RaceOutbound(0, result));
            Phase = RoomPhase.Results;
            phaseTimer = settings.ResultsLingerSeconds;
        }

        private static int CompareStanding(RacePlayer a, RacePlayer b)
        {
            if (a.State.Finished != b.State.Finished) return a.State.Finished ? -1 : 1;
            if (a.State.Finished && a.State.FinishTime != b.State.FinishTime) return a.State.FinishTime.CompareTo(b.State.FinishTime);
            if (a.State.Distance != b.State.Distance) return b.State.Distance.CompareTo(a.State.Distance);
            if (a.State.Score != b.State.Score) return b.State.Score.CompareTo(a.State.Score);
            return a.Id.CompareTo(b.Id);
        }

        /// <summary>Rejects physically impossible progress (speed hacks) and keeps distance monotonic.</summary>
        private RunnerNetState Validate(RacePlayer player, RunnerNetState state, bool final)
        {
            float maxDistance = config.MaxSpeed * (RaceTime + 1.5f) + settings.SnapshotTolerance;
            if (float.IsNaN(state.Distance) || float.IsInfinity(state.Distance)) state.Distance = player.State.Distance;
            if (state.Distance > maxDistance)
            {
                player.Violations++;
                state.Distance = maxDistance;
            }
            if (state.Distance < player.State.Distance) state.Distance = player.State.Distance;
            if (float.IsNaN(state.X) || float.IsInfinity(state.X)) state.X = player.State.X;
            if (float.IsNaN(state.Y) || float.IsInfinity(state.Y)) state.Y = player.State.Y;
            state.Score = Math.Max(0, state.Score);
            state.Coins = Math.Max(0, state.Coins);

            bool legitFinish = final && state.Finished
                && state.Distance >= settings.RaceLength - 1f
                && state.FinishTime >= minimumFinishTime
                && state.FinishTime <= RaceTime + 2f
                && player.Violations == 0;
            if (!legitFinish)
            {
                state.Finished = false;
                state.FinishTime = 0f;
                if (state.Distance > settings.RaceLength) state.Distance = settings.RaceLength;
            }
            if (final && !state.Finished) state.Alive = false;
            if (final) state.Pose = state.Finished ? RunnerPose.Finished : RunnerPose.Dead;
            return state;
        }

        private void BroadcastRoomState()
        {
            var message = new RoomStateMessage
            {
                RoomCode = Code,
                Phase = Phase,
                IsPrivate = IsPrivate,
                AutoStartIn = autoStartTimer
            };
            foreach (var p in players) message.Players.Add(p.ToInfo());
            outbound.Add(new RaceOutbound(0, message));
        }

        private void BroadcastWorld()
        {
            var message = new WorldStateMessage { RaceTime = RaceTime };
            foreach (var p in players) message.Players.Add(new PlayerNetEntry { Id = p.Id, State = p.State });
            outbound.Add(new RaceOutbound(0, message));
        }
    }
}
