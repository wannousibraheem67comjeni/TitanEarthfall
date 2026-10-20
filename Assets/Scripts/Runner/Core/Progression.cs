using System;
using System.Collections.Generic;

namespace TitanEarthfall.Runner
{
    public enum MissionType
    {
        CollectCoins,
        RunDistance,
        Jump,
        Roll,
        CollectPowerUps,
        ScorePoints,
        CollectGems,
        ChangeLanes,
        OpenMysteryBoxes
    }

    [Serializable]
    public sealed class MissionState
    {
        public MissionType Type;
        public int Target;
        public int Progress;
        public bool SingleRun;
        public bool Completed;
    }

    /// <summary>Persistent runner meta-progression. Plain public fields so Unity's JsonUtility can store it.</summary>
    [Serializable]
    public sealed class RunnerProfileData
    {
        public int Version = 1;
        public string PlayerName = "Runner";
        public string ServerUrl = "ws://localhost:5080/race";
        public int BestScore;
        public int BestDistance;
        public int TotalRuns;
        public int RaceWins;
        public int[] PowerUpLevels = new int[RunnerConfig.PowerUpCount];
        public int MissionSet;
        public int MissionMultiplier;
        public MissionState[] Missions = new MissionState[0];
        public bool StarterPackGranted;

        /// <summary>Repairs data saved by older or corrupted builds.</summary>
        public void Normalize()
        {
            if (PowerUpLevels == null || PowerUpLevels.Length != RunnerConfig.PowerUpCount)
            {
                var levels = new int[RunnerConfig.PowerUpCount];
                if (PowerUpLevels != null) Array.Copy(PowerUpLevels, levels, Math.Min(levels.Length, PowerUpLevels.Length));
                PowerUpLevels = levels;
            }
            for (int i = 0; i < PowerUpLevels.Length; i++)
                PowerUpLevels[i] = Math.Max(0, Math.Min(PowerUpUpgrades.MaxLevel, PowerUpLevels[i]));
            if (string.IsNullOrWhiteSpace(PlayerName)) PlayerName = "Runner";
            if (string.IsNullOrWhiteSpace(ServerUrl)) ServerUrl = "ws://localhost:5080/race";
            MissionSet = Math.Max(0, MissionSet);
            MissionMultiplier = Math.Max(0, Math.Min(MissionTracker.MaxMultiplierBonus, MissionMultiplier));
            if (Missions == null || Missions.Length != MissionTracker.MissionsPerSet || Array.Exists(Missions, m => m == null || m.Target <= 0))
                Missions = MissionTracker.CreateSet(MissionSet);
        }
    }

    /// <summary>Gold-funded power-up duration upgrades (Subway Surfers style).</summary>
    public static class PowerUpUpgrades
    {
        public const int MaxLevel = 5;

        /// <summary>Gold cost of the next level, or -1 when maxed.</summary>
        public static int CostForNextLevel(int level) => level >= MaxLevel ? -1 : 250 << Math.Max(0, level);
    }

    /// <summary>
    /// Three active missions; completing all of them raises the permanent score multiplier and rolls a new set.
    /// </summary>
    public sealed class MissionTracker
    {
        public const int MissionsPerSet = 3;
        public const int MaxMultiplierBonus = 29;

        private struct Template
        {
            public MissionType Type;
            public int Target;
            public bool SingleRun;

            public Template(MissionType type, int target, bool singleRun)
            {
                Type = type;
                Target = target;
                SingleRun = singleRun;
            }
        }

        private static readonly Template[] Templates =
        {
            new Template(MissionType.CollectCoins, 150, true),
            new Template(MissionType.CollectCoins, 600, false),
            new Template(MissionType.RunDistance, 800, true),
            new Template(MissionType.Jump, 20, true),
            new Template(MissionType.Jump, 80, false),
            new Template(MissionType.Roll, 15, true),
            new Template(MissionType.Roll, 60, false),
            new Template(MissionType.CollectPowerUps, 3, true),
            new Template(MissionType.CollectPowerUps, 10, false),
            new Template(MissionType.ScorePoints, 4000, true),
            new Template(MissionType.CollectGems, 2, false),
            new Template(MissionType.ChangeLanes, 50, true),
            new Template(MissionType.OpenMysteryBoxes, 1, false)
        };

        private readonly RunnerProfileData profile;
        private readonly List<MissionState> newlyCompleted = new List<MissionState>();

        public MissionTracker(RunnerProfileData profile)
        {
            this.profile = profile ?? throw new ArgumentNullException(nameof(profile));
            profile.Normalize();
        }

        public IReadOnlyList<MissionState> Active => profile.Missions;

        public int MultiplierBonus => profile.MissionMultiplier;

        public bool AllCompleted => Array.TrueForAll(profile.Missions, m => m.Completed);

        public static MissionState[] CreateSet(int setIndex)
        {
            var rng = new DeterministicRandom(DeterministicRandom.Hash(0x5EED, setIndex));
            float scale = 1f + setIndex * 0.35f;
            var result = new MissionState[MissionsPerSet];
            var usedTypes = new List<MissionType>();
            int count = 0, guard = 0;
            while (count < MissionsPerSet && guard++ < 100)
            {
                var template = Templates[rng.Range(0, Templates.Length)];
                if (usedTypes.Contains(template.Type)) continue;
                usedTypes.Add(template.Type);
                result[count++] = new MissionState
                {
                    Type = template.Type,
                    Target = Math.Max(1, (int)(template.Target * scale)),
                    SingleRun = template.SingleRun
                };
            }
            for (; count < MissionsPerSet; count++)
                result[count] = new MissionState { Type = MissionType.CollectCoins, Target = (int)(200 * scale), SingleRun = true };
            return result;
        }

        public static string Describe(MissionState mission)
        {
            string scope = mission.SingleRun ? " in one run" : "";
            switch (mission.Type)
            {
                case MissionType.CollectCoins: return $"Collect {mission.Target} coins{scope}";
                case MissionType.RunDistance: return $"Run {mission.Target} m{scope}";
                case MissionType.Jump: return $"Jump {mission.Target} times{scope}";
                case MissionType.Roll: return $"Roll {mission.Target} times{scope}";
                case MissionType.CollectPowerUps: return $"Pick up {mission.Target} power-ups{scope}";
                case MissionType.ScorePoints: return $"Score {mission.Target} points{scope}";
                case MissionType.CollectGems: return $"Collect {mission.Target} gems{scope}";
                case MissionType.ChangeLanes: return $"Change lanes {mission.Target} times{scope}";
                default: return $"Open {mission.Target} mystery boxes{scope}";
            }
        }

        /// <summary>Resets single-run progress that was not completed.</summary>
        public void BeginRun()
        {
            foreach (var mission in profile.Missions)
                if (mission.SingleRun && !mission.Completed) mission.Progress = 0;
        }

        public void Observe(RunnerEvent e)
        {
            switch (e.Type)
            {
                case RunnerEventType.Coin: Add(MissionType.CollectCoins, Math.Max(1, e.Value)); break;
                case RunnerEventType.Jump: Add(MissionType.Jump, 1); break;
                case RunnerEventType.Roll: Add(MissionType.Roll, 1); break;
                case RunnerEventType.PowerUp: Add(MissionType.CollectPowerUps, 1); break;
                case RunnerEventType.Gem: Add(MissionType.CollectGems, 1); break;
                case RunnerEventType.LaneChange: Add(MissionType.ChangeLanes, 1); break;
                case RunnerEventType.MysteryBox: Add(MissionType.OpenMysteryBoxes, 1); break;
            }
        }

        /// <summary>Feeds live distance/score so "reach X" missions complete mid-run.</summary>
        public void ObserveRun(int distance, int score)
        {
            Set(MissionType.RunDistance, distance);
            Set(MissionType.ScorePoints, score);
        }

        /// <summary>Returns missions completed since the last call (for toasts).</summary>
        public void DrainNewlyCompleted(List<MissionState> into)
        {
            into.AddRange(newlyCompleted);
            newlyCompleted.Clear();
        }

        /// <summary>When every mission is done, raises the multiplier and starts the next set.</summary>
        public bool TryAdvanceSet()
        {
            if (!AllCompleted) return false;
            profile.MissionMultiplier = Math.Min(MaxMultiplierBonus, profile.MissionMultiplier + 1);
            profile.MissionSet++;
            profile.Missions = CreateSet(profile.MissionSet);
            return true;
        }

        private void Add(MissionType type, int amount)
        {
            foreach (var mission in profile.Missions)
            {
                if (mission.Type != type || mission.Completed) continue;
                mission.Progress = Math.Min(mission.Target, mission.Progress + amount);
                CheckCompleted(mission);
            }
        }

        private void Set(MissionType type, int value)
        {
            foreach (var mission in profile.Missions)
            {
                if (mission.Type != type || mission.Completed) continue;
                mission.Progress = Math.Min(mission.Target, Math.Max(mission.Progress, value));
                CheckCompleted(mission);
            }
        }

        private void CheckCompleted(MissionState mission)
        {
            if (mission.Progress < mission.Target) return;
            mission.Completed = true;
            newlyCompleted.Add(mission);
        }
    }
}
