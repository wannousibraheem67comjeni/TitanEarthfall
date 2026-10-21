using System;

namespace TitanEarthfall.Runner
{
    /// <summary>
    /// Shared tuning for the lane runner. The same values must be used by every participant
    /// of a race (clients, bots and server validation), so keep gameplay-relevant numbers here.
    /// </summary>
    [Serializable]
    public sealed class RunnerConfig
    {
        public const int PowerUpCount = 5;

        public int LaneCount = 3;
        public float LaneWidth = 2.5f;

        public float BaseSpeed = 14f;
        public float MaxSpeed = 30f;
        public float SpeedGainPerMeter = 0.004f;
        public float FixedDeltaTime = 1f / 60f;

        public float LaneChangeTime = 0.16f;
        public float Gravity = 55f;
        public float FastDropSpeed = 32f;
        public float JumpHeight = 1.7f;
        public float SuperJumpHeight = 3.9f;
        public float JumpBufferTime = 0.15f;
        public float CoyoteTime = 0.08f;
        public float RollDuration = 0.65f;

        public float StandHeight = 1.8f;
        public float RollHeight = 0.8f;
        public float HalfWidth = 0.35f;
        public float HalfDepth = 0.4f;
        public float StepTolerance = 0.45f;

        public float StumbleWindow = 6f;
        public float StumbleSlowFactor = 0.6f;
        public float StumbleRecoverTime = 1.2f;
        public float ChaserFarGap = 14f;
        public float ChaserNearGap = 1.6f;

        public float JetpackHeight = 7f;
        public float JetpackClimbSpeed = 14f;
        public float MagnetRange = 7f;
        public float PowerUpBaseDuration = 10f;
        public float PowerUpDurationPerLevel = 2.5f;
        public float ShieldBaseDuration = 30f;
        public float InvulnerableAfterHit = 1.2f;
        public float InvulnerableAfterJetpack = 1.5f;
        public float InvulnerableAfterRevive = 2f;
        public float ReviveClearDistance = 30f;

        public float ChunkLength = 100f;
        public float ChunkMargin = 12f;
        public float SafeStartDistance = 45f;
        public float BiomeLength = 1000f;
        public int BiomeCount = 16;

        public float TrainHeight = 3f;
        public float RampLength = 8f;
        public float HurdleHeight = 0.9f;
        public float HurdleDepth = 0.5f;
        public float OverheadBottom = 1.1f;
        public float OverheadTop = 3f;
        public float OverheadDepth = 0.5f;
        public float ObstacleHalfWidth = 1.05f;
        public float TrainHalfWidth = 1.15f;

        public float CoinHeight = 0.7f;
        public float CoinSpacing = 2.4f;
        public float PickupRadius = 0.9f;
        public float SkyCoinSpacing = 3f;
        public float RowTimeGap = 0.8f;
        public float MinRowGap = 16f;
        public int CoinScore = 5;

        /// <summary>Forward speed for a runner that has reached <paramref name="distance"/>.</summary>
        public float SpeedAt(float distance) => Math.Min(MaxSpeed, BaseSpeed + Math.Max(0f, distance) * SpeedGainPerMeter);

        /// <summary>World X of the centre of a lane (lane 0 is the left-most lane).</summary>
        public float LaneX(int lane) => (lane - (LaneCount - 1) * 0.5f) * LaneWidth;

        public int ClampLane(int lane) => lane < 0 ? 0 : (lane >= LaneCount ? LaneCount - 1 : lane);

        public int MiddleLane => LaneCount / 2;

        /// <summary>Index of the biome a runner is in; biomes repeat after <see cref="BiomeCount"/>.</summary>
        public int BiomeIndexAt(float distance) => distance <= 0f ? 0 : (int)(distance / BiomeLength) % BiomeCount;

        public float JumpVelocity(float height) => MathF.Sqrt(2f * Gravity * height);

        /// <summary>Duration of a power-up given its purchased upgrade level.</summary>
        public float PowerUpDuration(PowerUpKind kind, int level)
        {
            float baseDuration = kind == PowerUpKind.Shield ? ShieldBaseDuration : PowerUpBaseDuration;
            return baseDuration + Math.Max(0, level) * PowerUpDurationPerLevel;
        }

        /// <summary>Shortest possible time to cover <paramref name="distance"/>; used by the server to reject impossible results.</summary>
        public float MinimumTimeFor(float distance)
        {
            float time = 0f, d = 0f, step = 0.05f;
            while (d < distance && time < 3600f)
            {
                d += SpeedAt(d) * step;
                time += step;
            }
            return time;
        }
    }
}
