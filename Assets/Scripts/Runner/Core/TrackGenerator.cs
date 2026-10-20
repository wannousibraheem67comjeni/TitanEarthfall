using System;
using System.Collections.Generic;

namespace TitanEarthfall.Runner
{
    /// <summary>
    /// Seeded procedural generator. Each chunk is generated only from (seed, chunk index), so every
    /// race participant sees the same obstacles regardless of when they ask for a chunk.
    /// Fairness rules: rows are separated by at least one reaction gap, every row keeps a passable
    /// lane, and train blocks always leave one train-free lane.
    /// </summary>
    public sealed class TrackGenerator
    {
        private enum RowPattern { Single, Double, Triple, Trains, Breather }

        private static readonly float[] PowerUpWeights = { 30f, 14f, 20f, 20f, 16f };
        // Extra train weight per biome (urban/cyber biomes are train-heavy, open nature biomes lighter).
        private static readonly float[] BiomeTrainBias = { 0f, -4f, 14f, -2f, 0f, -6f, -6f, 2f, -4f, -8f, 2f, -2f, 0f, -6f, 16f, 4f };

        private readonly int seed;
        private readonly RunnerConfig config;
        private readonly List<TrackItem> items = new List<TrackItem>(256);
        private readonly List<float> spotZ = new List<float>(16);
        private readonly List<int> spotLane = new List<int>(16);
        private readonly float[] patternWeights = new float[5];
        private int chunkIndex;
        private float chunkEnd;

        public TrackGenerator(int seed, RunnerConfig config)
        {
            this.seed = seed;
            this.config = config ?? throw new ArgumentNullException(nameof(config));
        }

        public TrackChunk Generate(int index)
        {
            if (index < 0) throw new ArgumentOutOfRangeException(nameof(index));
            chunkIndex = index;
            items.Clear();
            spotZ.Clear();
            spotLane.Clear();

            var rng = new DeterministicRandom(DeterministicRandom.Hash(seed, index));
            float start = index * config.ChunkLength;
            float end = start + config.ChunkLength;
            chunkEnd = end;
            float contentStart = Math.Max(start + config.ChunkMargin, config.SafeStartDistance);
            float contentEnd = end - config.ChunkMargin;
            int biome = config.BiomeIndexAt(start);
            FillPatternWeights(biome, start);

            float z = contentStart + rng.Range(0f, 4f);
            while (z < contentEnd - 1f)
            {
                float gap = Gap(z, rng);
                var pattern = (RowPattern)rng.Weighted(patternWeights);
                if (pattern == RowPattern.Trains)
                {
                    float blockEnd = PlaceTrainBlock(rng, z, contentEnd);
                    if (blockEnd > z)
                    {
                        z = blockEnd + gap;
                        continue;
                    }
                    pattern = RowPattern.Single;
                }

                PlaceRow(rng, pattern, z, gap);
                AddSpot(z + gap * 0.5f + 1f, rng.Range(0, config.LaneCount), contentEnd);
                z += gap;
            }

            PlacePickups(rng, index);
            PlaceSkyCoins(rng, start, end);

            var array = items.ToArray();
            Array.Sort(array, (a, b) => a.Z != b.Z ? a.Z.CompareTo(b.Z) : a.Id.CompareTo(b.Id));
            return new TrackChunk
            {
                Index = index,
                StartZ = start,
                EndZ = end,
                Biome = biome,
                DecorSeed = DeterministicRandom.Hash(seed ^ 0x3C6EF372, index),
                Items = array
            };
        }

        private void FillPatternWeights(int biome, float distance)
        {
            float difficulty = Math.Min(1f, distance / 3000f);
            patternWeights[(int)RowPattern.Single] = 30f - difficulty * 10f;
            patternWeights[(int)RowPattern.Double] = 20f + difficulty * 6f;
            patternWeights[(int)RowPattern.Triple] = 4f + difficulty * 10f;
            patternWeights[(int)RowPattern.Trains] = Math.Max(6f, 22f + BiomeTrainBias[biome % BiomeTrainBias.Length]);
            patternWeights[(int)RowPattern.Breather] = 12f - difficulty * 6f;
        }

        private float Gap(float z, DeterministicRandom rng) =>
            Math.Max(config.MinRowGap, config.SpeedAt(z) * config.RowTimeGap) * rng.Range(1f, 1.5f);

        private void PlaceRow(DeterministicRandom rng, RowPattern pattern, float z, float gap)
        {
            int lanes = config.LaneCount;
            switch (pattern)
            {
                case RowPattern.Single:
                {
                    int lane = rng.Range(0, lanes);
                    var kind = rng.Chance(0.55f) ? TrackItemKind.Hurdle : TrackItemKind.Overhead;
                    AddObstacle(kind, lane, z);
                    if (kind == TrackItemKind.Hurdle && rng.Chance(0.35f)) AddCoinArc(lane, z);
                    else if (rng.Chance(0.7f)) AddCoinLine(OtherLane(rng, lane), z - 6f, z + 7f);
                    break;
                }
                case RowPattern.Double:
                {
                    int free = rng.Range(0, lanes);
                    for (int lane = 0; lane < lanes; lane++)
                    {
                        if (lane == free) continue;
                        AddObstacle(rng.Chance(0.5f) ? TrackItemKind.Hurdle : TrackItemKind.Overhead, lane, z);
                    }
                    if (rng.Chance(0.65f)) AddCoinLine(free, z - 6f, z + 7f);
                    break;
                }
                case RowPattern.Triple:
                {
                    int arcLane = -1;
                    for (int lane = 0; lane < lanes; lane++)
                    {
                        var kind = rng.Chance(0.5f) ? TrackItemKind.Hurdle : TrackItemKind.Overhead;
                        AddObstacle(kind, lane, z);
                        if (kind == TrackItemKind.Hurdle && arcLane < 0) arcLane = lane;
                    }
                    if (arcLane >= 0 && rng.Chance(0.5f)) AddCoinArc(arcLane, z);
                    break;
                }
                default:
                {
                    int lane = rng.Range(0, lanes);
                    if (rng.Chance(0.5f))
                    {
                        AddCoinLine(lane, z, z + gap * 0.75f);
                    }
                    else
                    {
                        // Zig-zag coin trail that teaches lane switching.
                        int other = OtherLane(rng, lane);
                        float mid = z + gap * 0.4f;
                        AddCoinLine(lane, z, mid - 3f);
                        AddCoinLine(other, mid + 3f, z + gap * 0.8f);
                    }
                    break;
                }
            }
        }

        private float PlaceTrainBlock(DeterministicRandom rng, float z, float contentEnd)
        {
            if (contentEnd - z < 20f) return -1f;
            int lanes = config.LaneCount;
            int free = rng.Range(0, lanes);
            int itemsBefore = items.Count;
            float blockEnd = z;
            int trains = 0;

            for (int lane = 0; lane < lanes; lane++)
            {
                if (lane == free) continue;
                bool lastChance = trains == 0 && LastNonFreeLane(lane, free);
                if (!lastChance && !rng.Chance(0.75f)) continue;

                bool ramp = rng.Chance(0.4f);
                float trainStart = z + rng.Range(0f, 6f) + (ramp ? config.RampLength : 0f);
                float length = rng.Range(12f, 30f);
                if (trainStart + length > contentEnd) length = contentEnd - trainStart;
                if (length < 8f) continue;

                if (ramp)
                {
                    Add(TrackItemKind.Ramp, lane, trainStart - config.RampLength, config.RampLength, 0f);
                    if (rng.Chance(0.7f))
                    {
                        // Coins up the ramp and along the roof reward taking the high road.
                        for (float c = trainStart - config.RampLength + 1.5f; c < trainStart; c += config.CoinSpacing)
                        {
                            float h = config.TrainHeight * (c - (trainStart - config.RampLength)) / config.RampLength;
                            Add(TrackItemKind.Coin, lane, c, 0f, h + config.CoinHeight);
                        }
                        for (float c = trainStart + 1f; c < trainStart + length - 1f; c += config.CoinSpacing)
                            Add(TrackItemKind.Coin, lane, c, 0f, config.TrainHeight + config.CoinHeight);
                    }
                }

                Add(TrackItemKind.Train, lane, trainStart, length, 0f);
                blockEnd = Math.Max(blockEnd, trainStart + length);
                trains++;
            }

            if (trains == 0)
            {
                items.RemoveRange(itemsBefore, items.Count - itemsBefore);
                return -1f;
            }

            float blockLength = blockEnd - z;
            if (blockLength > 14f && rng.Chance(0.45f))
            {
                var kind = rng.Chance(0.5f) ? TrackItemKind.Hurdle : TrackItemKind.Overhead;
                AddObstacle(kind, free, z + blockLength * rng.Range(0.35f, 0.65f));
            }
            else if (rng.Chance(0.75f))
            {
                AddCoinLine(free, z + 1f, blockEnd - 1f);
            }
            return blockEnd;
        }

        private bool LastNonFreeLane(int lane, int free)
        {
            for (int other = lane + 1; other < config.LaneCount; other++)
                if (other != free) return false;
            return true;
        }

        private void PlacePickups(DeterministicRandom rng, int index)
        {
            if (rng.Chance(0.45f))
            {
                int kind = rng.Weighted(PowerUpWeights);
                if (index == 0 && kind == (int)PowerUpKind.Jetpack) kind = (int)PowerUpKind.Magnet;
                PlaceAtSpot(rng, TrackItem.KindOf((PowerUpKind)kind));
            }
            if (rng.Chance(0.12f)) PlaceAtSpot(rng, TrackItemKind.Gem);
            if (rng.Chance(0.06f)) PlaceAtSpot(rng, TrackItemKind.MysteryBox);
        }

        private void PlaceAtSpot(DeterministicRandom rng, TrackItemKind kind)
        {
            if (spotZ.Count == 0) return;
            int i = rng.Range(0, spotZ.Count);
            Add(kind, spotLane[i], spotZ[i], 0f, config.CoinHeight + 0.2f);
            spotZ.RemoveAt(i);
            spotLane.RemoveAt(i);
        }

        private void PlaceSkyCoins(DeterministicRandom rng, float start, float end)
        {
            int lane = rng.Range(0, config.LaneCount);
            int run = 0;
            for (float z = start + 4f; z < end - 4f; z += config.SkyCoinSpacing)
            {
                if (++run > 6)
                {
                    run = 0;
                    lane = config.ClampLane(lane + (rng.Chance(0.5f) ? 1 : -1));
                }
                Add(TrackItemKind.SkyCoin, lane, z, 0f, config.JetpackHeight + 0.9f);
            }
        }

        private void AddSpot(float z, int lane, float contentEnd)
        {
            if (z >= contentEnd) return;
            spotZ.Add(z);
            spotLane.Add(lane);
        }

        private int OtherLane(DeterministicRandom rng, int lane) => (lane + 1 + rng.Range(0, config.LaneCount - 1)) % config.LaneCount;

        private void AddObstacle(TrackItemKind kind, int lane, float z)
        {
            float depth = kind == TrackItemKind.Hurdle ? config.HurdleDepth : config.OverheadDepth;
            Add(kind, lane, z, depth, 0f);
        }

        private void AddCoinLine(int lane, float from, float to)
        {
            // Items must stay inside their chunk or range queries starting in the next chunk would miss them.
            to = Math.Min(to, chunkEnd - 1f);
            for (float z = from; z <= to; z += config.CoinSpacing)
                Add(TrackItemKind.Coin, lane, z, 0f, config.CoinHeight);
        }

        private void AddCoinArc(int lane, float hurdleZ)
        {
            for (int i = -2; i <= 2; i++)
            {
                float dz = i * config.CoinSpacing;
                float t = dz / 6f;
                Add(TrackItemKind.Coin, lane, hurdleZ + dz, 0f, config.CoinHeight + 1.6f * (1f - t * t));
            }
        }

        private void Add(TrackItemKind kind, int lane, float z, float length, float y)
        {
            if (items.Count >= TrackChunk.MaxItems) return;
            items.Add(new TrackItem
            {
                Id = chunkIndex * TrackChunk.MaxItems + items.Count,
                Kind = kind,
                Lane = lane,
                Z = z,
                Length = length,
                Y = y
            });
        }
    }
}
