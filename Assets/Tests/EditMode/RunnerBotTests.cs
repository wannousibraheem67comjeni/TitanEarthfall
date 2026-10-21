using NUnit.Framework;

namespace TitanEarthfall.Runner.Tests
{
    public sealed class RunnerBotTests
    {
        /// <summary>
        /// The strongest guarantee about generated tracks: a flawless pilot can always survive.
        /// If the generator ever produces an impossible pattern, this test fails.
        /// </summary>
        [TestCase(1)]
        [TestCase(2)]
        [TestCase(3)]
        [TestCase(42)]
        [TestCase(1337)]
        [TestCase(9001)]
        [TestCase(31415)]
        [TestCase(-77)]
        public void PerfectBot_SurvivesLongRun(int seed)
        {
            var config = new RunnerConfig();
            var sim = new RunnerSimulation(new Track(seed, config));
            var bot = new RunnerBot(7, 1f);
            const float target = 5000f;
            int guard = 0;
            while (sim.IsAlive && sim.Distance < target && guard++ < 200000)
            {
                sim.Enqueue(bot.Decide(sim));
                sim.Step();
            }
            Assert.IsTrue(sim.IsAlive, $"seed {seed}: bot died at {sim.Distance:0.0} m ({sim.DeathCause}), lane {sim.Lane}, y {sim.Y:0.00}");
            Assert.GreaterOrEqual(sim.Distance, target);
            Assert.Greater(sim.Coins, 50, "the bot should also pick up coins");
        }

        [Test]
        public void WeakBots_EventuallyMakeMistakes()
        {
            var config = new RunnerConfig();
            int deaths = 0;
            for (int seed = 0; seed < 6; seed++)
            {
                var sim = new RunnerSimulation(new Track(seed, config));
                var bot = new RunnerBot((ulong)seed, 0.3f);
                int guard = 0;
                while (sim.IsAlive && sim.Distance < 4000f && guard++ < 200000)
                {
                    sim.Enqueue(bot.Decide(sim));
                    sim.Step();
                }
                if (!sim.IsAlive) deaths++;
            }
            Assert.Greater(deaths, 0);
        }

        [Test]
        public void Bot_IsDeterministic()
        {
            var config = new RunnerConfig();
            float Run()
            {
                var sim = new RunnerSimulation(new Track(5, config));
                var bot = new RunnerBot(99, 0.6f);
                for (int i = 0; i < 6000 && sim.IsAlive; i++)
                {
                    sim.Enqueue(bot.Decide(sim));
                    sim.Step();
                }
                return sim.Distance;
            }
            Assert.AreEqual(Run(), Run());
        }
    }
}
