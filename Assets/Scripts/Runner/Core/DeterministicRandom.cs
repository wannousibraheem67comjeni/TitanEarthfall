namespace TitanEarthfall.Runner
{
    /// <summary>
    /// Platform-independent xorshift64* generator. Every client, bot and the race server
    /// derive identical tracks from a shared seed, so this must never depend on System.Random.
    /// </summary>
    public sealed class DeterministicRandom
    {
        private ulong state;

        public DeterministicRandom(ulong seed)
        {
            state = SplitMix(seed);
            if (state == 0) state = 0x9E3779B97F4A7C15UL;
        }

        /// <summary>Combines a seed and an index (chunk, item, player) into a well-mixed 64-bit seed.</summary>
        public static ulong Hash(int seed, int index) => SplitMix(((ulong)(uint)seed << 32) | (uint)index);

        /// <summary>SplitMix64 finalizer.</summary>
        public static ulong SplitMix(ulong x)
        {
            x += 0x9E3779B97F4A7C15UL;
            x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9UL;
            x = (x ^ (x >> 27)) * 0x94D049BB133111EBUL;
            return x ^ (x >> 31);
        }

        public uint NextUInt()
        {
            state ^= state >> 12;
            state ^= state << 25;
            state ^= state >> 27;
            return (uint)((state * 0x2545F4914F6CDD1DUL) >> 32);
        }

        /// <summary>Uniform float in [0, 1).</summary>
        public float NextFloat() => (NextUInt() >> 8) * (1f / 16777216f);

        /// <summary>Uniform integer in [min, maxExclusive).</summary>
        public int Range(int min, int maxExclusive)
        {
            if (maxExclusive <= min) return min;
            return min + (int)(NextUInt() % (uint)(maxExclusive - min));
        }

        /// <summary>Uniform float in [min, max).</summary>
        public float Range(float min, float max) => min + (max - min) * NextFloat();

        public bool Chance(float probability) => NextFloat() < probability;

        /// <summary>Returns an index chosen proportionally to non-negative weights.</summary>
        public int Weighted(float[] weights)
        {
            float total = 0f;
            for (int i = 0; i < weights.Length; i++) if (weights[i] > 0f) total += weights[i];
            if (total <= 0f) return Range(0, weights.Length);
            float roll = NextFloat() * total;
            for (int i = 0; i < weights.Length; i++)
            {
                if (weights[i] <= 0f) continue;
                roll -= weights[i];
                if (roll < 0f) return i;
            }
            return weights.Length - 1;
        }
    }
}
