using System;
using System.Collections.Generic;

namespace TitanEarthfall.Runner
{
    public enum RunnerCommand : byte { None, Left, Right, Jump, Roll }

    public enum RunnerPose : byte { Running, Jumping, Falling, Rolling, Flying, Stumbling, Dead, Finished }

    public enum DeathCause : byte { None, Crash, Caught }

    public enum MysteryReward : byte { Gold, Credits, Troca, Gems, Jackpot }

    public enum RunnerEventType : byte
    {
        Jump,
        Roll,
        LaneChange,
        BlockedLaneChange,
        Land,
        Coin,
        Gem,
        PowerUp,
        PowerUpEnded,
        MysteryBox,
        Stumble,
        ShieldBreak,
        Crash,
        Caught,
        Revive,
        Finish,
        BiomeChanged
    }

    /// <summary>Something that happened during a simulation step (for audio, VFX, missions and UI).</summary>
    public struct RunnerEvent
    {
        public RunnerEventType Type;
        public int Value;
        public int ItemId;

        public RunnerEvent(RunnerEventType type, int value = 0, int itemId = -1)
        {
            Type = type;
            Value = value;
            ItemId = itemId;
        }
    }

    /// <summary>Per-run modifiers coming from meta progression (missions, home, upgrades) or race rules.</summary>
    public sealed class RunnerModifiers
    {
        public int ScoreMultiplier = 1;
        public int[] PowerUpLevels = new int[RunnerConfig.PowerUpCount];
        /// <summary>Race finish line; 0 means endless.</summary>
        public float FinishDistance;
    }

    public sealed class RunnerStats
    {
        public int Jumps;
        public int Rolls;
        public int LaneChanges;
        public int PowerUps;
        public int Stumbles;
        public int MysteryBoxes;
    }

    public static class MysteryRewards
    {
        private static readonly float[] Weights = { 50f, 15f, 15f, 15f, 5f };

        public static MysteryReward Roll(int trackSeed, int itemId) =>
            (MysteryReward)new DeterministicRandom(DeterministicRandom.Hash(trackSeed, itemId)).Weighted(Weights);

        public static int Amount(MysteryReward reward)
        {
            switch (reward)
            {
                case MysteryReward.Gold: return 50;
                case MysteryReward.Credits: return 1;
                case MysteryReward.Troca: return 5;
                case MysteryReward.Gems: return 3;
                default: return 300;
            }
        }
    }

    /// <summary>
    /// Fixed-step, engine-independent lane runner simulation (Subway Surfers / Gold Run style).
    /// Used by the local player, by bots and by the race server so that rules are identical everywhere.
    /// </summary>
    public sealed class RunnerSimulation
    {
        private const int MaxBufferedEvents = 256;

        private readonly Track track;
        private readonly RunnerConfig config;
        private readonly RunnerModifiers modifiers;
        private readonly HashSet<int> consumed = new HashSet<int>();
        private readonly List<TrackItem> queryScratch = new List<TrackItem>(64);
        private readonly List<TrackItem> obstacleScratch = new List<TrackItem>(16);
        private readonly List<TrackItem> pickupScratch = new List<TrackItem>(64);
        private readonly List<RunnerEvent> events = new List<RunnerEvent>(32);
        private readonly Queue<RunnerCommand> commands = new Queue<RunnerCommand>(4);
        private readonly float[] powerUps = new float[RunnerConfig.PowerUpCount];

        private float laneStartX;
        private float laneT = 1f;
        private int laneBeforeChange;
        private float verticalVelocity;
        private bool grounded = true;
        private float lastGroundedTime;
        private float rollTimer;
        private bool fastDrop;
        private bool rollOnLand;
        private float jumpBufferTimer;
        private float invulnerableTimer;
        private float stumbleWindowTimer;
        private float stumbleSlowTimer;
        private float scoreAccumulator;

        public RunnerSimulation(Track track, RunnerModifiers modifiers = null)
        {
            this.track = track ?? throw new ArgumentNullException(nameof(track));
            config = track.Config;
            this.modifiers = modifiers ?? new RunnerModifiers();
            Lane = laneBeforeChange = config.MiddleLane;
            X = PreviousX = laneStartX = config.LaneX(Lane);
            IsAlive = true;
            Speed = config.SpeedAt(0f);
            // Intro beat: the chaser starts right behind the runner and falls back.
            ChaserGap = config.ChaserNearGap * 1.5f;
        }

        public Track Track => track;
        public RunnerConfig Config => config;
        public RunnerStats Stats { get; } = new RunnerStats();

        /// <summary>Set to false for headless runners (bots) whose events nobody drains.</summary>
        public bool RecordEvents { get; set; } = true;

        public float Time { get; private set; }
        public float Distance { get; private set; }
        public float PreviousDistance { get; private set; }
        public float Speed { get; private set; }
        public float X { get; private set; }
        public float PreviousX { get; private set; }
        public float Y { get; private set; }
        public float PreviousY { get; private set; }
        public int Lane { get; private set; }
        public bool IsGrounded => grounded;
        public bool IsRolling => rollTimer > 0f;
        public bool IsAlive { get; private set; }
        public bool IsFinished { get; private set; }
        public float FinishTime { get; private set; }
        public DeathCause DeathCause { get; private set; }
        public int Coins { get; private set; }
        public int Gems { get; private set; }
        public int Revives { get; private set; }
        public int BiomeIndex { get; private set; }
        public float ChaserGap { get; private set; }
        public int Score => (int)scoreAccumulator;
        public float FinishDistance => modifiers.FinishDistance;
        public bool IsInvulnerable => invulnerableTimer > 0f;
        /// <summary>True while a second stumble would let the chaser catch the runner.</summary>
        public bool IsStumbleWarning => stumbleWindowTimer > 0f;
        public float CurrentHeight => rollTimer > 0f ? config.RollHeight : config.StandHeight;
        public int Multiplier => Math.Max(1, modifiers.ScoreMultiplier) * (IsActive(PowerUpKind.Multiplier) ? 2 : 1);

        public RunnerPose Pose
        {
            get
            {
                if (IsFinished) return RunnerPose.Finished;
                if (!IsAlive) return RunnerPose.Dead;
                if (IsActive(PowerUpKind.Jetpack)) return RunnerPose.Flying;
                if (rollTimer > 0f) return RunnerPose.Rolling;
                if (!grounded) return verticalVelocity > 0f ? RunnerPose.Jumping : RunnerPose.Falling;
                if (stumbleSlowTimer > 0f) return RunnerPose.Stumbling;
                return RunnerPose.Running;
            }
        }

        public bool IsActive(PowerUpKind kind) => powerUps[(int)kind] > 0f;

        public float PowerUpRemaining(PowerUpKind kind) => powerUps[(int)kind];

        public float PowerUpDuration(PowerUpKind kind)
        {
            var levels = modifiers.PowerUpLevels;
            int level = levels != null && (int)kind < levels.Length ? levels[(int)kind] : 0;
            return config.PowerUpDuration(kind, level);
        }

        public bool IsConsumed(int itemId) => consumed.Contains(itemId);

        public void Enqueue(RunnerCommand command)
        {
            if (command != RunnerCommand.None && commands.Count < 4) commands.Enqueue(command);
        }

        public void DrainEvents(List<RunnerEvent> into)
        {
            into.AddRange(events);
            events.Clear();
        }

        public RunnerNetState ToNetState()
        {
            byte mask = 0;
            for (int i = 0; i < powerUps.Length; i++)
                if (powerUps[i] > 0f) mask |= (byte)(1 << i);
            return new RunnerNetState
            {
                Distance = Distance,
                X = X,
                Y = Y,
                Pose = Pose,
                PowerUps = mask,
                Score = Score,
                Coins = Coins,
                Alive = IsAlive,
                Finished = IsFinished,
                FinishTime = FinishTime
            };
        }

        /// <summary>Advances the runner by one fixed step (<see cref="RunnerConfig.FixedDeltaTime"/>).</summary>
        public void Step()
        {
            float dt = config.FixedDeltaTime;
            PreviousDistance = Distance;
            PreviousX = X;
            PreviousY = Y;

            if (!IsAlive || IsFinished)
            {
                commands.Clear();
                UpdateChaser(dt);
                return;
            }

            Time += dt;
            UpdateTimers(dt);
            ProcessCommands();

            float slow = 1f;
            if (stumbleSlowTimer > 0f)
                slow = config.StumbleSlowFactor + (1f - config.StumbleSlowFactor) * (1f - stumbleSlowTimer / config.StumbleRecoverTime);
            Speed = config.SpeedAt(Distance) * slow;
            Distance += Speed * dt;

            UpdateLateral(dt);
            UpdateVertical();
            ResolveObstacles();
            if (IsAlive)
            {
                CollectPickups();
                scoreAccumulator += Speed * dt * Multiplier;
            }
            UpdateChaser(dt);
            UpdateBiome();

            if (IsAlive && modifiers.FinishDistance > 0f && Distance >= modifiers.FinishDistance)
            {
                IsFinished = true;
                FinishTime = Time;
                Emit(RunnerEventType.Finish);
            }
        }

        /// <summary>Brings a dead runner back, clearing obstacles just ahead. Returns false if not dead.</summary>
        public bool Revive()
        {
            if (IsAlive || IsFinished) return false;
            IsAlive = true;
            DeathCause = DeathCause.None;
            Revives++;
            queryScratch.Clear();
            track.Query(Distance - 2f, Distance + config.ReviveClearDistance, queryScratch);
            foreach (var item in queryScratch)
                if (item.IsObstacle) consumed.Add(item.Id);
            invulnerableTimer = config.InvulnerableAfterRevive;
            stumbleWindowTimer = stumbleSlowTimer = rollTimer = 0f;
            fastDrop = rollOnLand = false;
            verticalVelocity = 0f;
            grounded = false;
            laneStartX = X;
            laneT = 0f;
            Emit(RunnerEventType.Revive);
            return true;
        }

        private void UpdateTimers(float dt)
        {
            for (int i = 0; i < powerUps.Length; i++)
            {
                if (powerUps[i] <= 0f) continue;
                powerUps[i] -= dt;
                if (powerUps[i] > 0f) continue;
                powerUps[i] = 0f;
                Emit(RunnerEventType.PowerUpEnded, i);
                if (i == (int)PowerUpKind.Jetpack)
                {
                    invulnerableTimer = Math.Max(invulnerableTimer, config.InvulnerableAfterJetpack);
                    verticalVelocity = 0f;
                    grounded = false;
                }
            }

            if (invulnerableTimer > 0f) invulnerableTimer -= dt;
            if (stumbleWindowTimer > 0f) stumbleWindowTimer -= dt;
            if (stumbleSlowTimer > 0f) stumbleSlowTimer -= dt;
            if (jumpBufferTimer > 0f) jumpBufferTimer -= dt;
            if (rollTimer > 0f)
            {
                rollTimer -= dt;
                // Never stand up underneath an overhead barrier.
                if (rollTimer <= 0f) rollTimer = HeadroomBlocked() ? dt : 0f;
            }
        }

        private void ProcessCommands()
        {
            while (commands.Count > 0)
            {
                switch (commands.Dequeue())
                {
                    case RunnerCommand.Left: ChangeLane(-1); break;
                    case RunnerCommand.Right: ChangeLane(1); break;
                    case RunnerCommand.Jump: TryJump(); break;
                    case RunnerCommand.Roll: TryRoll(); break;
                }
            }
        }

        private void ChangeLane(int direction)
        {
            int target = Lane + direction;
            if (target < 0 || target >= config.LaneCount)
            {
                Emit(RunnerEventType.BlockedLaneChange, direction);
                return;
            }
            laneBeforeChange = Lane;
            Lane = target;
            laneStartX = X;
            laneT = 0f;
            Stats.LaneChanges++;
            Emit(RunnerEventType.LaneChange, direction);
        }

        private void TryJump()
        {
            if (IsActive(PowerUpKind.Jetpack)) return;
            bool canJump = grounded || (Time - lastGroundedTime <= config.CoyoteTime && verticalVelocity <= 0f);
            if (!canJump)
            {
                jumpBufferTimer = config.JumpBufferTime;
                return;
            }
            if (rollTimer > 0f)
            {
                if (HeadroomBlocked()) return;
                rollTimer = 0f;
            }
            float height = IsActive(PowerUpKind.SuperSneakers) ? config.SuperJumpHeight : config.JumpHeight;
            verticalVelocity = config.JumpVelocity(height);
            grounded = false;
            fastDrop = rollOnLand = false;
            jumpBufferTimer = 0f;
            lastGroundedTime = float.MinValue;
            Stats.Jumps++;
            Emit(RunnerEventType.Jump);
        }

        private void TryRoll()
        {
            if (IsActive(PowerUpKind.Jetpack)) return;
            if (grounded)
            {
                StartRoll();
                return;
            }
            fastDrop = true;
            rollOnLand = true;
            jumpBufferTimer = 0f;
        }

        private void StartRoll()
        {
            rollTimer = config.RollDuration;
            Stats.Rolls++;
            Emit(RunnerEventType.Roll);
        }

        private void UpdateLateral(float dt)
        {
            float targetX = config.LaneX(Lane);
            if (laneT >= 1f)
            {
                X = targetX;
                return;
            }
            laneT = Math.Min(1f, laneT + dt / config.LaneChangeTime);
            float t = laneT * laneT * (3f - 2f * laneT);
            X = laneStartX + (targetX - laneStartX) * t;
        }

        private void UpdateVertical()
        {
            float dt = config.FixedDeltaTime;
            if (IsActive(PowerUpKind.Jetpack))
            {
                Y = MoveTowards(Y, config.JetpackHeight, config.JetpackClimbSpeed * dt);
                verticalVelocity = 0f;
                grounded = false;
                fastDrop = rollOnLand = false;
                rollTimer = 0f;
                return;
            }

            verticalVelocity -= config.Gravity * dt;
            if (fastDrop && verticalVelocity > -config.FastDropSpeed) verticalVelocity = -config.FastDropSpeed;
            Y += verticalVelocity * dt;

            float ground = GroundHeight(X, Distance, PreviousY);
            if (Y <= ground)
            {
                bool landed = !grounded;
                Y = ground;
                verticalVelocity = 0f;
                grounded = true;
                fastDrop = false;
                lastGroundedTime = Time;
                if (!landed) return;
                Emit(RunnerEventType.Land);
                if (rollOnLand)
                {
                    rollOnLand = false;
                    StartRoll();
                }
                else if (jumpBufferTimer > 0f)
                {
                    TryJump();
                }
            }
            else
            {
                grounded = false;
            }
        }

        /// <summary>Highest walkable surface under the runner that it can step onto from <paramref name="fromY"/>.</summary>
        private float GroundHeight(float x, float z, float fromY)
        {
            float best = 0f;
            float hd = config.HalfDepth;
            queryScratch.Clear();
            track.Query(z - hd - 1f, z + hd + 1f, queryScratch);
            foreach (var item in queryScratch)
            {
                if (!item.IsSurface || consumed.Contains(item.Id)) continue;
                if (Math.Abs(x - config.LaneX(item.Lane)) > config.TrainHalfWidth) continue;
                float height;
                if (item.Kind == TrackItemKind.Train)
                {
                    if (z + hd <= item.Z || z - hd >= item.EndZ) continue;
                    height = config.TrainHeight;
                }
                else
                {
                    // Ramps are sampled at the runner's leading edge so it arrives at the roof height exactly at the train.
                    float front = Math.Min(z + hd, item.EndZ);
                    if (front <= item.Z || z - hd >= item.EndZ) continue;
                    height = config.TrainHeight * (front - item.Z) / item.Length;
                }
                if (height <= fromY + config.StepTolerance && height > best) best = height;
            }
            return best;
        }

        private bool HeadroomBlocked()
        {
            float hd = config.HalfDepth, hw = config.HalfWidth;
            queryScratch.Clear();
            track.Query(Distance - hd, Distance + hd, queryScratch);
            foreach (var item in queryScratch)
            {
                if (item.Kind != TrackItemKind.Overhead || consumed.Contains(item.Id)) continue;
                float lx = config.LaneX(item.Lane);
                if (X + hw <= lx - config.ObstacleHalfWidth || X - hw >= lx + config.ObstacleHalfWidth) continue;
                if (Distance + hd <= item.Z || Distance - hd >= item.EndZ) continue;
                if (Y + config.StandHeight > config.OverheadBottom && Y < config.OverheadTop) return true;
            }
            return false;
        }

        private void ResolveObstacles()
        {
            float hd = config.HalfDepth, hw = config.HalfWidth;
            obstacleScratch.Clear();
            track.Query(Distance - hd - 0.1f, Distance + hd + 0.1f, obstacleScratch);
            foreach (var item in obstacleScratch)
            {
                if (!item.IsObstacle || consumed.Contains(item.Id)) continue;
                GetBox(item, out float minX, out float maxX, out float minY, out float maxY);
                float height = CurrentHeight;
                bool overlap = X + hw > minX && X - hw < maxX
                    && Y + height > minY && Y < maxY
                    && Distance + hd > item.Z && Distance - hd < item.EndZ;
                if (!overlap || invulnerableTimer > 0f) continue;

                bool wasAlongside = PreviousDistance + hd > item.Z && PreviousDistance - hd < item.EndZ;
                bool wasInLane = PreviousX + hw > minX && PreviousX - hw < maxX;
                if (!wasAlongside)
                {
                    Crash(item);
                    if (!IsAlive) return;
                }
                else if (!wasInLane)
                {
                    Stumble();
                    if (!IsAlive) return;
                }
                // Otherwise the overlap came from vertical motion while already alongside, which the
                // headroom and step rules prevent; ignore it instead of punishing the player unfairly.
            }
        }

        private void GetBox(TrackItem item, out float minX, out float maxX, out float minY, out float maxY)
        {
            float lx = config.LaneX(item.Lane);
            float halfWidth = item.Kind == TrackItemKind.Train ? config.TrainHalfWidth : config.ObstacleHalfWidth;
            minX = lx - halfWidth;
            maxX = lx + halfWidth;
            switch (item.Kind)
            {
                case TrackItemKind.Hurdle:
                    minY = 0f;
                    maxY = config.HurdleHeight;
                    break;
                case TrackItemKind.Overhead:
                    minY = config.OverheadBottom;
                    maxY = config.OverheadTop;
                    break;
                default:
                    minY = 0f;
                    maxY = config.TrainHeight;
                    break;
            }
        }

        private void Crash(TrackItem item)
        {
            if (TryConsumeShield())
            {
                consumed.Add(item.Id);
                return;
            }
            Die(DeathCause.Crash);
            Emit(RunnerEventType.Crash, (int)item.Kind, item.Id);
        }

        private void Stumble()
        {
            Stats.Stumbles++;
            X = laneStartX = PreviousX;
            Lane = laneBeforeChange;
            laneT = 0f;
            if (stumbleWindowTimer > 0f)
            {
                Emit(RunnerEventType.Stumble);
                if (TryConsumeShield())
                {
                    stumbleWindowTimer = 0f;
                    return;
                }
                Die(DeathCause.Caught);
                Emit(RunnerEventType.Caught);
                return;
            }
            stumbleWindowTimer = config.StumbleWindow;
            stumbleSlowTimer = config.StumbleRecoverTime;
            Emit(RunnerEventType.Stumble);
        }

        private bool TryConsumeShield()
        {
            if (!IsActive(PowerUpKind.Shield)) return false;
            powerUps[(int)PowerUpKind.Shield] = 0f;
            invulnerableTimer = config.InvulnerableAfterHit;
            Emit(RunnerEventType.ShieldBreak);
            return true;
        }

        private void Die(DeathCause cause)
        {
            IsAlive = false;
            DeathCause = cause;
            verticalVelocity = 0f;
            rollTimer = 0f;
            fastDrop = rollOnLand = false;
        }

        private void CollectPickups()
        {
            float hd = config.HalfDepth, hw = config.HalfWidth;
            float minZ = PreviousDistance - hd - config.PickupRadius;
            float maxZ = Distance + hd + config.PickupRadius;
            bool magnet = IsActive(PowerUpKind.Magnet);
            bool flying = IsActive(PowerUpKind.Jetpack);
            float height = CurrentHeight;

            pickupScratch.Clear();
            track.Query(minZ, magnet ? Math.Max(maxZ, Distance + config.MagnetRange) : maxZ, pickupScratch);
            foreach (var item in pickupScratch)
            {
                if (!item.IsPickup || consumed.Contains(item.Id)) continue;
                bool isCoin = item.Kind == TrackItemKind.Coin || item.Kind == TrackItemKind.SkyCoin;
                if (item.Kind == TrackItemKind.SkyCoin && !flying) continue;

                bool touched = item.Z >= minZ && item.Z <= maxZ
                    && Math.Abs(config.LaneX(item.Lane) - X) <= config.PickupRadius + hw
                    && item.Y >= Y - 0.5f && item.Y <= Y + height + 0.5f;
                bool attracted = magnet && isCoin && item.Z >= Distance - 1f && item.Z <= Distance + config.MagnetRange;
                if (touched || attracted) Collect(item);
            }
        }

        private void Collect(TrackItem item)
        {
            consumed.Add(item.Id);
            switch (item.Kind)
            {
                case TrackItemKind.Coin:
                case TrackItemKind.SkyCoin:
                    Coins++;
                    scoreAccumulator += config.CoinScore * Multiplier;
                    Emit(RunnerEventType.Coin, 1, item.Id);
                    break;
                case TrackItemKind.Gem:
                    Gems++;
                    Emit(RunnerEventType.Gem, 1, item.Id);
                    break;
                case TrackItemKind.MysteryBox:
                    Stats.MysteryBoxes++;
                    Emit(RunnerEventType.MysteryBox, (int)MysteryRewards.Roll(track.Seed, item.Id), item.Id);
                    break;
                default:
                    if (item.IsPowerUp) Activate(item.PowerUp, item.Id);
                    break;
            }
        }

        private void Activate(PowerUpKind kind, int itemId)
        {
            powerUps[(int)kind] = PowerUpDuration(kind);
            Stats.PowerUps++;
            if (kind == PowerUpKind.Jetpack)
            {
                rollTimer = 0f;
                fastDrop = rollOnLand = false;
                verticalVelocity = 0f;
            }
            Emit(RunnerEventType.PowerUp, (int)kind, itemId);
        }

        private void UpdateChaser(float dt)
        {
            float target;
            if (IsFinished) target = config.ChaserFarGap * 2f;
            else if (!IsAlive) target = 0f;
            else target = stumbleWindowTimer > 0f ? config.ChaserNearGap : config.ChaserFarGap;
            float rate = target < ChaserGap ? 12f : 2.5f;
            ChaserGap = MoveTowards(ChaserGap, target, rate * dt);
        }

        private void UpdateBiome()
        {
            int biome = config.BiomeIndexAt(Distance);
            if (biome == BiomeIndex) return;
            BiomeIndex = biome;
            Emit(RunnerEventType.BiomeChanged, biome);
        }

        private void Emit(RunnerEventType type, int value = 0, int itemId = -1)
        {
            if (!RecordEvents) return;
            if (events.Count >= MaxBufferedEvents) events.RemoveRange(0, MaxBufferedEvents / 2);
            events.Add(new RunnerEvent(type, value, itemId));
        }

        private static float MoveTowards(float current, float target, float maxDelta)
        {
            if (Math.Abs(target - current) <= maxDelta) return target;
            return current + Math.Sign(target - current) * maxDelta;
        }
    }
}
