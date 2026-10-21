using System.Collections.Generic;
using NUnit.Framework;

namespace TitanEarthfall.Runner.Tests
{
    public sealed class ProgressionTests
    {
        [Test]
        public void MissionSets_AreDeterministicAndDistinct()
        {
            var a = MissionTracker.CreateSet(4);
            var b = MissionTracker.CreateSet(4);
            Assert.AreEqual(MissionTracker.MissionsPerSet, a.Length);
            for (int i = 0; i < a.Length; i++)
            {
                Assert.AreEqual(a[i].Type, b[i].Type);
                Assert.AreEqual(a[i].Target, b[i].Target);
                for (int j = i + 1; j < a.Length; j++) Assert.AreNotEqual(a[i].Type, a[j].Type);
                Assert.IsNotEmpty(MissionTracker.Describe(a[i]));
            }
            Assert.Greater(MissionTracker.CreateSet(10)[0].Target, 0);
        }

        [Test]
        public void CompletingAllMissions_RaisesMultiplier()
        {
            var profile = new RunnerProfileData();
            profile.Missions = new[]
            {
                new MissionState { Type = MissionType.Jump, Target = 2, SingleRun = true },
                new MissionState { Type = MissionType.CollectCoins, Target = 3 },
                new MissionState { Type = MissionType.RunDistance, Target = 100, SingleRun = true }
            };
            var tracker = new MissionTracker(profile);
            tracker.BeginRun();
            tracker.Observe(new RunnerEvent(RunnerEventType.Jump));
            tracker.Observe(new RunnerEvent(RunnerEventType.Jump));
            for (int i = 0; i < 3; i++) tracker.Observe(new RunnerEvent(RunnerEventType.Coin, 1));
            Assert.IsFalse(tracker.AllCompleted);
            Assert.IsFalse(tracker.TryAdvanceSet());
            tracker.ObserveRun(150, 0);
            Assert.IsTrue(tracker.AllCompleted);

            var completed = new List<MissionState>();
            tracker.DrainNewlyCompleted(completed);
            Assert.AreEqual(3, completed.Count);

            Assert.IsTrue(tracker.TryAdvanceSet());
            Assert.AreEqual(1, profile.MissionMultiplier);
            Assert.AreEqual(1, profile.MissionSet);
            Assert.IsFalse(tracker.AllCompleted);
        }

        [Test]
        public void SingleRunMissions_ResetEachRun()
        {
            var profile = new RunnerProfileData
            {
                Missions = new[]
                {
                    new MissionState { Type = MissionType.Jump, Target = 5, SingleRun = true },
                    new MissionState { Type = MissionType.Roll, Target = 5 },
                    new MissionState { Type = MissionType.ChangeLanes, Target = 5, SingleRun = true }
                }
            };
            var tracker = new MissionTracker(profile);
            tracker.Observe(new RunnerEvent(RunnerEventType.Jump));
            tracker.Observe(new RunnerEvent(RunnerEventType.Roll));
            tracker.BeginRun();
            Assert.AreEqual(0, profile.Missions[0].Progress);
            Assert.AreEqual(1, profile.Missions[1].Progress, "cumulative missions keep progress");
        }

        [Test]
        public void Profile_NormalizeRepairsBadData()
        {
            var profile = new RunnerProfileData { PowerUpLevels = new[] { 9, -1 }, Missions = null, PlayerName = " ", MissionMultiplier = 500 };
            profile.Normalize();
            Assert.AreEqual(RunnerConfig.PowerUpCount, profile.PowerUpLevels.Length);
            Assert.AreEqual(PowerUpUpgrades.MaxLevel, profile.PowerUpLevels[0]);
            Assert.AreEqual(0, profile.PowerUpLevels[1]);
            Assert.AreEqual(MissionTracker.MissionsPerSet, profile.Missions.Length);
            Assert.AreEqual("Runner", profile.PlayerName);
            Assert.AreEqual(MissionTracker.MaxMultiplierBonus, profile.MissionMultiplier);
        }

        [Test]
        public void UpgradeCosts_DoubleAndCap()
        {
            Assert.AreEqual(250, PowerUpUpgrades.CostForNextLevel(0));
            Assert.AreEqual(500, PowerUpUpgrades.CostForNextLevel(1));
            Assert.AreEqual(-1, PowerUpUpgrades.CostForNextLevel(PowerUpUpgrades.MaxLevel));
        }

        [Test]
        public void MinimumTime_IsPlausible()
        {
            var config = new RunnerConfig();
            float t = config.MinimumTimeFor(1500f);
            Assert.Greater(t, 1500f / config.MaxSpeed);
            Assert.Less(t, 1500f / config.BaseSpeed);
        }
    }
}
