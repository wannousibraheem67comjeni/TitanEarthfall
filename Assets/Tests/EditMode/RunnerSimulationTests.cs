using System.Collections.Generic;
using NUnit.Framework;

namespace TitanEarthfall.Runner.Tests
{
    public sealed class RunnerSimulationTests
    {
        private RunnerConfig config;

        [SetUp]
        public void SetUp() => config = TestTracks.Config();

        [Test]
        public void EmptyTrack_RunsForwardAndSpeedsUp()
        {
            var sim = new RunnerSimulation(TestTracks.With(config));
            TestTracks.StepSeconds(sim, 5f);
            Assert.IsTrue(sim.IsAlive);
            Assert.Greater(sim.Distance, config.BaseSpeed * 4.9f);
            Assert.Greater(sim.Speed, config.BaseSpeed);
            Assert.Greater(sim.Score, 0);
            Assert.AreEqual(config.MiddleLane, sim.Lane);
        }

        [Test]
        public void LaneChange_MovesToNeighbourAndStopsAtEdge()
        {
            var sim = new RunnerSimulation(TestTracks.With(config));
            sim.Enqueue(RunnerCommand.Left);
            TestTracks.StepSeconds(sim, 0.5f);
            Assert.AreEqual(0, sim.Lane);
            Assert.AreEqual(config.LaneX(0), sim.X, 1e-4f);

            var events = new List<RunnerEvent>();
            sim.DrainEvents(events);
            sim.Enqueue(RunnerCommand.Left);
            sim.Step();
            sim.DrainEvents(events);
            Assert.AreEqual(0, sim.Lane);
            Assert.IsTrue(events.Exists(e => e.Type == RunnerEventType.BlockedLaneChange));
        }

        [Test]
        public void RunningIntoHurdle_Crashes()
        {
            var sim = new RunnerSimulation(TestTracks.With(config, TestTracks.Hurdle(config, 1, 60f)));
            TestTracks.StepSeconds(sim, 8f);
            Assert.IsFalse(sim.IsAlive);
            Assert.AreEqual(DeathCause.Crash, sim.DeathCause);
            Assert.AreEqual(RunnerPose.Dead, sim.Pose);
            Assert.Less(sim.Distance, 61f);
        }

        [Test]
        public void JumpingOverHurdle_Survives()
        {
            var sim = new RunnerSimulation(TestTracks.With(config, TestTracks.Hurdle(config, 1, 60f)));
            TestTracks.RunUntil(sim, 60f, sim.Speed * 0.15f);
            sim.Enqueue(RunnerCommand.Jump);
            TestTracks.StepSeconds(sim, 2f);
            Assert.IsTrue(sim.IsAlive);
            Assert.Greater(sim.Distance, 70f);
            Assert.AreEqual(1, sim.Stats.Jumps);
        }

        [Test]
        public void OverheadBarrier_RequiresRoll()
        {
            var crash = new RunnerSimulation(TestTracks.With(config, TestTracks.Overhead(config, 1, 60f)));
            TestTracks.StepSeconds(crash, 6f);
            Assert.IsFalse(crash.IsAlive);

            var roll = new RunnerSimulation(TestTracks.With(config, TestTracks.Overhead(config, 1, 60f)));
            TestTracks.RunUntil(roll, 60f, roll.Speed * 0.2f);
            roll.Enqueue(RunnerCommand.Roll);
            TestTracks.StepSeconds(roll, 2f);
            Assert.IsTrue(roll.IsAlive);
            Assert.Greater(roll.Distance, 70f);
        }

        [Test]
        public void JumpingIntoOverhead_Crashes()
        {
            var sim = new RunnerSimulation(TestTracks.With(config, TestTracks.Overhead(config, 1, 60f)));
            TestTracks.RunUntil(sim, 60f, sim.Speed * 0.15f);
            sim.Enqueue(RunnerCommand.Jump);
            TestTracks.StepSeconds(sim, 2f);
            Assert.IsFalse(sim.IsAlive);
        }

        [Test]
        public void RollingDoesNotEndUnderOverhead()
        {
            // A long overhead (tunnel) is longer than one roll; the runner must stay low until it clears.
            var tunnel = TestTracks.Item(TrackItemKind.Overhead, 1, 60f, 20f);
            var sim = new RunnerSimulation(TestTracks.With(config, tunnel));
            TestTracks.RunUntil(sim, 60f, sim.Speed * 0.2f);
            sim.Enqueue(RunnerCommand.Roll);
            TestTracks.StepSeconds(sim, 3f);
            Assert.IsTrue(sim.IsAlive);
            Assert.Greater(sim.Distance, 85f);
        }

        [Test]
        public void TrainFront_Crashes_AndSideHitStumbles()
        {
            var front = new RunnerSimulation(TestTracks.With(config, TestTracks.Train(1, 60f, 20f)));
            TestTracks.StepSeconds(front, 6f);
            Assert.IsFalse(front.IsAlive);
            Assert.AreEqual(DeathCause.Crash, front.DeathCause);

            // Train alongside in lane 0 while the runner is in lane 1: switching left clips its side.
            var side = new RunnerSimulation(TestTracks.With(config, TestTracks.Train(0, 50f, 60f)));
            TestTracks.RunUntil(side, 70f);
            side.Enqueue(RunnerCommand.Left);
            TestTracks.StepSeconds(side, 0.5f);
            Assert.IsTrue(side.IsAlive);
            Assert.AreEqual(1, side.Lane, "stumble bounces the runner back");
            Assert.AreEqual(1, side.Stats.Stumbles);
            Assert.IsTrue(side.IsStumbleWarning);
            Assert.AreEqual(RunnerPose.Stumbling, side.Pose);
        }

        [Test]
        public void SecondStumbleInsideWindow_GetsCaught()
        {
            var sim = new RunnerSimulation(TestTracks.With(config, TestTracks.Train(0, 50f, 300f)));
            TestTracks.RunUntil(sim, 70f);
            sim.Enqueue(RunnerCommand.Left);
            TestTracks.StepSeconds(sim, 0.6f);
            Assert.IsTrue(sim.IsAlive);
            sim.Enqueue(RunnerCommand.Left);
            TestTracks.StepSeconds(sim, 0.6f);
            Assert.IsFalse(sim.IsAlive);
            Assert.AreEqual(DeathCause.Caught, sim.DeathCause);
            TestTracks.StepSeconds(sim, 1f);
            Assert.AreEqual(0f, sim.ChaserGap, 1e-3f, "the chaser closes in on a caught runner");
        }

        [Test]
        public void StumbleWindowExpires()
        {
            var sim = new RunnerSimulation(TestTracks.With(config, TestTracks.Train(0, 50f, 400f)));
            TestTracks.RunUntil(sim, 70f);
            sim.Enqueue(RunnerCommand.Left);
            TestTracks.StepSeconds(sim, config.StumbleWindow + 0.5f);
            Assert.IsFalse(sim.IsStumbleWarning);
            sim.Enqueue(RunnerCommand.Left);
            TestTracks.StepSeconds(sim, 0.6f);
            Assert.IsTrue(sim.IsAlive, "a stumble after the window is only a warning");
        }

        [Test]
        public void Ramp_LeadsOntoTrainRoof()
        {
            float rampStart = 60f;
            var ramp = TestTracks.Item(TrackItemKind.Ramp, 1, rampStart, config.RampLength);
            var train = TestTracks.Train(1, rampStart + config.RampLength, 30f);
            var sim = new RunnerSimulation(TestTracks.With(config, ramp, train));
            TestTracks.RunUntil(sim, rampStart + config.RampLength + 10f);
            Assert.IsTrue(sim.IsAlive);
            Assert.AreEqual(config.TrainHeight, sim.Y, 1e-4f);
            TestTracks.StepSeconds(sim, 3f);
            Assert.IsTrue(sim.IsAlive);
            Assert.AreEqual(0f, sim.Y, 1e-4f, "runner drops back to the ground after the train");
        }

        [Test]
        public void SuperSneakers_JumpOntoTrain()
        {
            var sneakers = TestTracks.Item(TrackItemKind.SuperSneakers, 1, 50f, 0f, config.CoinHeight);
            var train = TestTracks.Train(1, 80f, 40f);
            var sim = new RunnerSimulation(TestTracks.With(config, sneakers, train));
            TestTracks.RunUntil(sim, 80f, sim.Speed * 0.35f);
            Assert.IsTrue(sim.IsActive(PowerUpKind.SuperSneakers));
            sim.Enqueue(RunnerCommand.Jump);
            TestTracks.StepSeconds(sim, 1.2f);
            Assert.IsTrue(sim.IsAlive);
            Assert.AreEqual(config.TrainHeight, sim.Y, 1e-4f);
        }

        [Test]
        public void Coins_AreCollectedOnceAndScore()
        {
            var items = new List<TrackItem>();
            for (int i = 0; i < 10; i++) items.Add(TestTracks.Item(TrackItemKind.Coin, 1, 50f + i * 2f, 0f, config.CoinHeight));
            items.Add(TestTracks.Item(TrackItemKind.Coin, 0, 60f, 0f, config.CoinHeight));
            var sim = new RunnerSimulation(TestTracks.With(config, items.ToArray()));
            TestTracks.StepSeconds(sim, 5f);
            Assert.AreEqual(10, sim.Coins, "only coins in the runner's lane are collected");
            Assert.IsTrue(sim.IsConsumed(1));
        }

        [Test]
        public void Magnet_PullsCoinsFromOtherLanes()
        {
            var magnet = TestTracks.Item(TrackItemKind.Magnet, 1, 40f, 0f, config.CoinHeight);
            var left = TestTracks.Item(TrackItemKind.Coin, 0, 60f, 0f, config.CoinHeight);
            var right = TestTracks.Item(TrackItemKind.Coin, 2, 62f, 0f, config.CoinHeight);
            var sim = new RunnerSimulation(TestTracks.With(config, magnet, left, right));
            TestTracks.StepSeconds(sim, 5f);
            Assert.AreEqual(2, sim.Coins);
        }

        [Test]
        public void Jetpack_FliesOverObstaclesAndCollectsSkyCoins()
        {
            var items = new List<TrackItem>
            {
                TestTracks.Item(TrackItemKind.Jetpack, 1, 40f, 0f, config.CoinHeight),
                TestTracks.Train(1, 80f, 40f),
                TestTracks.Hurdle(config, 1, 140f)
            };
            for (int i = 0; i < 5; i++)
                items.Add(TestTracks.Item(TrackItemKind.SkyCoin, 1, 100f + i * 3f, 0f, config.JetpackHeight + 0.9f));
            var sim = new RunnerSimulation(TestTracks.With(config, items.ToArray()));
            TestTracks.RunUntil(sim, 100f);
            Assert.AreEqual(RunnerPose.Flying, sim.Pose);
            TestTracks.RunUntil(sim, 150f);
            Assert.IsTrue(sim.IsAlive);
            Assert.AreEqual(5, sim.Coins);

            TestTracks.StepSeconds(sim, sim.PowerUpDuration(PowerUpKind.Jetpack) + 2f);
            Assert.IsFalse(sim.IsActive(PowerUpKind.Jetpack));
            Assert.AreEqual(0f, sim.Y, 1e-4f, "lands when the jetpack runs out");
            Assert.IsTrue(sim.IsAlive);
        }

        [Test]
        public void SkyCoins_IgnoredWithoutJetpack()
        {
            var sky = TestTracks.Item(TrackItemKind.SkyCoin, 1, 60f, 0f, config.JetpackHeight + 0.9f);
            var sim = new RunnerSimulation(TestTracks.With(config, sky));
            TestTracks.StepSeconds(sim, 6f);
            Assert.AreEqual(0, sim.Coins);
        }

        [Test]
        public void Shield_AbsorbsOneCrash()
        {
            var shield = TestTracks.Item(TrackItemKind.Shield, 1, 40f, 0f, config.CoinHeight);
            var sim = new RunnerSimulation(TestTracks.With(config, shield, TestTracks.Hurdle(config, 1, 80f), TestTracks.Hurdle(config, 1, 140f)));
            TestTracks.RunUntil(sim, 100f);
            Assert.IsTrue(sim.IsAlive);
            Assert.IsFalse(sim.IsActive(PowerUpKind.Shield));
            TestTracks.StepSeconds(sim, 5f);
            Assert.IsFalse(sim.IsAlive, "the second hit is fatal");
        }

        [Test]
        public void Multiplier_DoublesScoreGain()
        {
            var plain = new RunnerSimulation(TestTracks.With(config));
            var boosted = new RunnerSimulation(TestTracks.With(config), new RunnerModifiers { ScoreMultiplier = 2 });
            TestTracks.StepSeconds(plain, 3f);
            TestTracks.StepSeconds(boosted, 3f);
            Assert.AreEqual(plain.Score * 2, boosted.Score, 2);
            Assert.AreEqual(2, boosted.Multiplier);
        }

        [Test]
        public void UpgradeLevels_ExtendPowerUps()
        {
            var levels = new int[RunnerConfig.PowerUpCount];
            levels[(int)PowerUpKind.Magnet] = 3;
            var sim = new RunnerSimulation(TestTracks.With(config), new RunnerModifiers { PowerUpLevels = levels });
            Assert.AreEqual(config.PowerUpBaseDuration + 3 * config.PowerUpDurationPerLevel, sim.PowerUpDuration(PowerUpKind.Magnet), 1e-4f);
        }

        [Test]
        public void Revive_ClearsObstaclesAhead()
        {
            var sim = new RunnerSimulation(TestTracks.With(config, TestTracks.Hurdle(config, 1, 60f), TestTracks.Hurdle(config, 1, 75f)));
            TestTracks.StepSeconds(sim, 6f);
            Assert.IsFalse(sim.IsAlive);
            Assert.IsTrue(sim.Revive());
            TestTracks.StepSeconds(sim, 3f);
            Assert.IsTrue(sim.IsAlive);
            Assert.AreEqual(1, sim.Revives);
            Assert.IsFalse(sim.Revive(), "cannot revive a living runner");
        }

        [Test]
        public void FinishLine_EndsRace()
        {
            var sim = new RunnerSimulation(TestTracks.With(config), new RunnerModifiers { FinishDistance = 200f });
            TestTracks.StepSeconds(sim, 30f);
            Assert.IsTrue(sim.IsFinished);
            Assert.AreEqual(RunnerPose.Finished, sim.Pose);
            Assert.GreaterOrEqual(sim.Distance, 200f);
            Assert.Less(sim.Distance, 201f, "the finished runner stops advancing");
            Assert.Greater(sim.FinishTime, 0f);
        }

        [Test]
        public void MysteryBox_RewardIsDeterministic()
        {
            var box = TestTracks.Item(TrackItemKind.MysteryBox, 1, 50f, 0f, config.CoinHeight);
            var a = new RunnerSimulation(TestTracks.With(config, box));
            var b = new RunnerSimulation(TestTracks.With(config, box));
            TestTracks.StepSeconds(a, 5f);
            TestTracks.StepSeconds(b, 5f);
            var ea = new List<RunnerEvent>();
            var eb = new List<RunnerEvent>();
            a.DrainEvents(ea);
            b.DrainEvents(eb);
            var ra = ea.Find(e => e.Type == RunnerEventType.MysteryBox);
            var rb = eb.Find(e => e.Type == RunnerEventType.MysteryBox);
            Assert.AreEqual(RunnerEventType.MysteryBox, ra.Type);
            Assert.AreEqual(ra.Value, rb.Value);
            Assert.Greater(MysteryRewards.Amount((MysteryReward)ra.Value), 0);
        }

        [Test]
        public void BiomeChangesWithDistance()
        {
            var fast = new RunnerConfig { BiomeLength = 100f };
            var sim = new RunnerSimulation(TestTracks.With(fast));
            TestTracks.StepSeconds(sim, 10f);
            var events = new List<RunnerEvent>();
            sim.DrainEvents(events);
            Assert.IsTrue(events.Exists(e => e.Type == RunnerEventType.BiomeChanged && e.Value == 1));
            Assert.AreEqual(fast.BiomeIndexAt(sim.Distance), sim.BiomeIndex);
        }

        [Test]
        public void NetState_ReflectsSimulation()
        {
            var sim = new RunnerSimulation(TestTracks.With(config, TestTracks.Item(TrackItemKind.Magnet, 1, 30f, 0f, config.CoinHeight)));
            TestTracks.StepSeconds(sim, 3f);
            var state = sim.ToNetState();
            Assert.AreEqual(sim.Distance, state.Distance);
            Assert.AreEqual(sim.Score, state.Score);
            Assert.IsTrue(state.Alive);
            Assert.IsTrue(state.HasPowerUp(PowerUpKind.Magnet));
            Assert.IsFalse(state.HasPowerUp(PowerUpKind.Jetpack));
        }
    }
}
