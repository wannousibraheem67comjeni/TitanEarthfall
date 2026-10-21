using System;
using System.Collections.Generic;

namespace TitanEarthfall.Runner.Tests
{
    /// <summary>Hand-authored tracks for deterministic simulation tests.</summary>
    internal static class TestTracks
    {
        public static RunnerConfig Config() => new RunnerConfig();

        /// <summary>A track whose only content is <paramref name="items"/> (ids are assigned automatically).</summary>
        public static Track With(RunnerConfig config, params TrackItem[] items)
        {
            var byChunk = new Dictionary<int, List<TrackItem>>();
            for (int i = 0; i < items.Length; i++)
            {
                var item = items[i];
                item.Id = 1 + i;
                int chunk = (int)(item.Z / config.ChunkLength);
                if (!byChunk.TryGetValue(chunk, out var list)) byChunk[chunk] = list = new List<TrackItem>();
                list.Add(item);
            }

            return new Track(1234, config, index =>
            {
                var list = byChunk.TryGetValue(index, out var found) ? found.ToArray() : Array.Empty<TrackItem>();
                Array.Sort(list, (a, b) => a.Z.CompareTo(b.Z));
                return new TrackChunk
                {
                    Index = index,
                    StartZ = index * config.ChunkLength,
                    EndZ = (index + 1) * config.ChunkLength,
                    Items = list
                };
            });
        }

        public static TrackItem Item(TrackItemKind kind, int lane, float z, float length = 0f, float y = 0f) =>
            new TrackItem { Kind = kind, Lane = lane, Z = z, Length = length, Y = y };

        public static TrackItem Hurdle(RunnerConfig config, int lane, float z) => Item(TrackItemKind.Hurdle, lane, z, config.HurdleDepth);

        public static TrackItem Overhead(RunnerConfig config, int lane, float z) => Item(TrackItemKind.Overhead, lane, z, config.OverheadDepth);

        public static TrackItem Train(int lane, float z, float length) => Item(TrackItemKind.Train, lane, z, length);

        /// <summary>Steps until the runner's front edge is <paramref name="metersBefore"/> before <paramref name="z"/>.</summary>
        public static void RunUntil(RunnerSimulation sim, float z, float metersBefore = 0f)
        {
            int guard = 0;
            while (sim.Distance + sim.Config.HalfDepth < z - metersBefore && sim.IsAlive && guard++ < 100000) sim.Step();
        }

        public static void Steps(RunnerSimulation sim, int count)
        {
            for (int i = 0; i < count; i++) sim.Step();
        }

        public static void StepSeconds(RunnerSimulation sim, float seconds) =>
            Steps(sim, (int)Math.Ceiling(seconds / sim.Config.FixedDeltaTime));
    }
}
