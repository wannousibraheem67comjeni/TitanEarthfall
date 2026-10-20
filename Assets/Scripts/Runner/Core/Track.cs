using System;
using System.Collections.Generic;

namespace TitanEarthfall.Runner
{
    /// <summary>Lazily generated, cached view of an infinite seeded track. Not thread-safe.</summary>
    public sealed class Track
    {
        private const int MaxCachedChunks = 32;

        private readonly Func<int, TrackChunk> chunkFactory;
        private readonly Dictionary<int, TrackChunk> cache = new Dictionary<int, TrackChunk>();
        private readonly List<int> evictScratch = new List<int>();

        public Track(int seed, RunnerConfig config)
            : this(seed, config, new TrackGenerator(seed, config).Generate)
        {
        }

        /// <summary>Uses a custom chunk source (hand-authored tracks, tests). Chunks must keep items sorted by Z.</summary>
        public Track(int seed, RunnerConfig config, Func<int, TrackChunk> chunkFactory)
        {
            Seed = seed;
            Config = config ?? throw new ArgumentNullException(nameof(config));
            this.chunkFactory = chunkFactory ?? throw new ArgumentNullException(nameof(chunkFactory));
        }

        public int Seed { get; }

        public RunnerConfig Config { get; }

        public int ChunkIndexAt(float z) => z <= 0f ? 0 : (int)(z / Config.ChunkLength);

        public TrackChunk GetChunk(int index)
        {
            if (index < 0) index = 0;
            if (cache.TryGetValue(index, out var chunk)) return chunk;
            if (cache.Count >= MaxCachedChunks) Evict(index);
            chunk = chunkFactory(index);
            cache[index] = chunk;
            return chunk;
        }

        /// <summary>Appends every item whose extent overlaps [minZ, maxZ].</summary>
        public void Query(float minZ, float maxZ, List<TrackItem> results)
        {
            if (maxZ < 0f) return;
            int first = ChunkIndexAt(minZ);
            int last = ChunkIndexAt(maxZ);
            for (int c = first; c <= last; c++)
            {
                var chunkItems = GetChunk(c).Items;
                for (int i = 0; i < chunkItems.Length; i++)
                {
                    var item = chunkItems[i];
                    if (item.Z > maxZ) break;
                    if (item.EndZ >= minZ) results.Add(item);
                }
            }
        }

        private void Evict(int keepNear)
        {
            evictScratch.Clear();
            foreach (var key in cache.Keys)
                if (key < keepNear - 4 || key > keepNear + 12) evictScratch.Add(key);
            if (evictScratch.Count == 0)
                foreach (var key in cache.Keys) evictScratch.Add(key);
            foreach (var key in evictScratch) cache.Remove(key);
        }
    }
}
