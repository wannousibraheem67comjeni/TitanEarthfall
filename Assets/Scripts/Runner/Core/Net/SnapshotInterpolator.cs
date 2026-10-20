using System;

namespace TitanEarthfall.Runner.Net
{
    /// <summary>
    /// Buffers timestamped snapshots of a remote runner and samples them slightly in the past so
    /// ghosts move smoothly despite network jitter. Briefly extrapolates when snapshots are late.
    /// </summary>
    public sealed class SnapshotInterpolator
    {
        private const int Capacity = 16;
        private const float MaxExtrapolation = 0.3f;

        private readonly float[] times = new float[Capacity];
        private readonly RunnerNetState[] states = new RunnerNetState[Capacity];
        private int count;
        private int head;

        public int Count => count;

        public float LatestTime => count == 0 ? 0f : times[Index(count - 1)];

        public RunnerNetState Latest => count == 0 ? default : states[Index(count - 1)];

        public void Clear()
        {
            count = 0;
            head = 0;
        }

        public void Add(float time, RunnerNetState state)
        {
            if (count > 0 && time <= LatestTime) return;
            if (count == Capacity)
            {
                head = (head + 1) % Capacity;
                count--;
            }
            int slot = Index(count);
            times[slot] = time;
            states[slot] = state;
            count++;
        }

        public bool TrySample(float time, out RunnerNetState result)
        {
            if (count == 0)
            {
                result = default;
                return false;
            }

            var first = states[Index(0)];
            if (count == 1 || time <= times[Index(0)])
            {
                result = first;
                return true;
            }

            for (int i = 0; i < count - 1; i++)
            {
                float t0 = times[Index(i)], t1 = times[Index(i + 1)];
                if (time > t1) continue;
                result = Lerp(states[Index(i)], states[Index(i + 1)], (time - t0) / Math.Max(1e-4f, t1 - t0));
                return true;
            }

            // Newer than anything received: extrapolate distance a little using the last velocity.
            int last = Index(count - 1), previous = Index(count - 2);
            result = states[last];
            if (result.Alive && !result.Finished)
            {
                float dt = Math.Max(1e-4f, times[last] - times[previous]);
                float velocity = (states[last].Distance - states[previous].Distance) / dt;
                float ahead = Math.Min(MaxExtrapolation, time - times[last]);
                result.Distance += Math.Max(0f, velocity) * ahead;
            }
            return true;
        }

        private int Index(int i) => (head + i) % Capacity;

        private static RunnerNetState Lerp(RunnerNetState a, RunnerNetState b, float t)
        {
            t = t < 0f ? 0f : (t > 1f ? 1f : t);
            var result = t < 0.5f ? a : b;
            result.Distance = a.Distance + (b.Distance - a.Distance) * t;
            result.X = a.X + (b.X - a.X) * t;
            result.Y = a.Y + (b.Y - a.Y) * t;
            return result;
        }
    }
}
