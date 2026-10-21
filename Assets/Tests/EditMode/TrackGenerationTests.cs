using System.Collections.Generic;
using NUnit.Framework;

namespace TitanEarthfall.Runner.Tests
{
    public sealed class TrackGenerationTests
    {
        [Test]
        public void DeterministicRandom_SameSeedSameSequence()
        {
            var a = new DeterministicRandom(42);
            var b = new DeterministicRandom(42);
            var c = new DeterministicRandom(43);
            bool differs = false;
            for (int i = 0; i < 100; i++)
            {
                uint x = a.NextUInt();
                Assert.AreEqual(x, b.NextUInt());
                if (x != c.NextUInt()) differs = true;
            }
            Assert.IsTrue(differs);
        }

        [Test]
        public void DeterministicRandom_RangesStayInBounds()
        {
            var rng = new DeterministicRandom(7);
            for (int i = 0; i < 10000; i++)
            {
                int v = rng.Range(-3, 5);
                Assert.That(v, Is.InRange(-3, 4));
                float f = rng.NextFloat();
                Assert.That(f, Is.GreaterThanOrEqualTo(0f).And.LessThan(1f));
            }
        }

        [Test]
        public void SameSeed_GeneratesIdenticalChunks()
        {
            var config = new RunnerConfig();
            var a = new TrackGenerator(99, config);
            var b = new TrackGenerator(99, config);
            for (int chunk = 0; chunk < 20; chunk++)
            {
                var ca = a.Generate(chunk);
                var cb = b.Generate(chunk);
                Assert.AreEqual(ca.Items.Length, cb.Items.Length);
                for (int i = 0; i < ca.Items.Length; i++)
                {
                    Assert.AreEqual(ca.Items[i].Id, cb.Items[i].Id);
                    Assert.AreEqual(ca.Items[i].Kind, cb.Items[i].Kind);
                    Assert.AreEqual(ca.Items[i].Lane, cb.Items[i].Lane);
                    Assert.AreEqual(ca.Items[i].Z, cb.Items[i].Z);
                }
            }
        }

        [Test]
        public void GenerationOrder_DoesNotChangeChunks()
        {
            var config = new RunnerConfig();
            var forward = new TrackGenerator(5, config);
            var backward = new TrackGenerator(5, config);
            var expected = new List<TrackChunk>();
            for (int chunk = 0; chunk < 8; chunk++) expected.Add(forward.Generate(chunk));
            for (int chunk = 7; chunk >= 0; chunk--)
            {
                var actual = backward.Generate(chunk);
                Assert.AreEqual(expected[chunk].Items.Length, actual.Items.Length, $"chunk {chunk}");
            }
        }

        [Test]
        public void DifferentSeeds_GenerateDifferentTracks()
        {
            var config = new RunnerConfig();
            var a = new TrackGenerator(1, config).Generate(3);
            var b = new TrackGenerator(2, config).Generate(3);
            bool same = a.Items.Length == b.Items.Length;
            for (int i = 0; same && i < a.Items.Length; i++)
                same = a.Items[i].Kind == b.Items[i].Kind && a.Items[i].Lane == b.Items[i].Lane && a.Items[i].Z == b.Items[i].Z;
            Assert.IsFalse(same);
        }

        [TestCase(1)]
        [TestCase(77)]
        [TestCase(2024)]
        public void Chunks_RespectFairnessRules(int seed)
        {
            var config = new RunnerConfig();
            var generator = new TrackGenerator(seed, config);
            var ids = new HashSet<int>();
            for (int index = 0; index < 60; index++)
            {
                var chunk = generator.Generate(index);
                float previousZ = float.MinValue;
                foreach (var item in chunk.Items)
                {
                    Assert.IsTrue(ids.Add(item.Id), "item ids must be unique");
                    Assert.GreaterOrEqual(item.Z, previousZ, "items must be sorted");
                    previousZ = item.Z;
                    Assert.That(item.Lane, Is.InRange(0, config.LaneCount - 1));
                    Assert.GreaterOrEqual(item.Z, chunk.StartZ);
                    Assert.LessOrEqual(item.EndZ, chunk.EndZ, "items must not cross chunk boundaries");
                    if (item.IsObstacle)
                    {
                        Assert.GreaterOrEqual(item.Z, config.SafeStartDistance, "no obstacles at the start line");
                        Assert.GreaterOrEqual(item.Z, chunk.StartZ + config.ChunkMargin - 0.01f);
                        Assert.LessOrEqual(item.EndZ, chunk.EndZ - config.ChunkMargin + 0.01f);
                    }
                }

                // At every point along the chunk at least one lane must be free of trains.
                for (float z = chunk.StartZ; z < chunk.EndZ; z += 0.5f)
                {
                    int blocked = 0;
                    for (int lane = 0; lane < config.LaneCount; lane++)
                    {
                        foreach (var item in chunk.Items)
                        {
                            if (item.Kind == TrackItemKind.Train && item.Lane == lane && z >= item.Z && z <= item.EndZ)
                            {
                                blocked++;
                                break;
                            }
                        }
                    }
                    Assert.Less(blocked, config.LaneCount, $"all lanes blocked by trains at z={z} (seed {seed})");
                }
            }
        }

        [Test]
        public void Track_QueryReturnsOverlappingItemsOnly()
        {
            var config = new RunnerConfig();
            var track = new Track(11, config);
            var results = new List<TrackItem>();
            track.Query(250f, 260f, results);
            foreach (var item in results)
            {
                Assert.GreaterOrEqual(item.EndZ, 250f);
                Assert.LessOrEqual(item.Z, 260f);
            }
        }

        [Test]
        public void Track_SurvivesCacheEviction()
        {
            var config = new RunnerConfig();
            var track = new Track(3, config);
            int firstCount = track.GetChunk(0).Items.Length;
            for (int i = 1; i < 100; i++) track.GetChunk(i);
            Assert.AreEqual(firstCount, track.GetChunk(0).Items.Length);
        }

        [Test]
        public void TrackContainsAllContentTypes()
        {
            var config = new RunnerConfig();
            var generator = new TrackGenerator(8, config);
            var seen = new HashSet<TrackItemKind>();
            for (int i = 0; i < 80; i++)
                foreach (var item in generator.Generate(i).Items) seen.Add(item.Kind);
            foreach (TrackItemKind kind in System.Enum.GetValues(typeof(TrackItemKind)))
                Assert.IsTrue(seen.Contains(kind), $"never generated {kind}");
        }
    }
}
