using System;
using System.Collections.Generic;

namespace TitanEarthfall.Runner
{
    /// <summary>
    /// Look-ahead AI pilot for a <see cref="RunnerSimulation"/>. Skill 1 plays flawlessly (used to prove
    /// generated tracks are fair); lower skills hesitate on some threats, which makes race bots beatable.
    /// </summary>
    public sealed class RunnerBot
    {
        private readonly DeterministicRandom rng;
        private readonly float skill;
        private readonly List<TrackItem> items = new List<TrackItem>(64);
        private readonly HashSet<int> judgedThreats = new HashSet<int>();
        private readonly HashSet<int> ignoredThreats = new HashSet<int>();
        private float pickupDecisionTimer;

        public RunnerBot(ulong seed, float skill)
        {
            rng = new DeterministicRandom(seed);
            this.skill = skill < 0f ? 0f : (skill > 1f ? 1f : skill);
        }

        public float Skill => skill;

        /// <summary>Chooses the command for the next step. Call once per step, before <see cref="RunnerSimulation.Step"/>.</summary>
        public RunnerCommand Decide(RunnerSimulation sim)
        {
            if (!sim.IsAlive || sim.IsFinished || sim.IsActive(PowerUpKind.Jetpack)) return RunnerCommand.None;
            var cfg = sim.Config;
            float speed = Math.Max(sim.Speed, 1f);
            float lookahead = speed * 1.8f + 12f;
            items.Clear();
            sim.Track.Query(sim.Distance - cfg.HalfDepth - 1f, sim.Distance + lookahead, items);
            if (judgedThreats.Count > 512) judgedThreats.Clear();

            int lane = sim.Lane;
            bool settling = Math.Abs(sim.X - cfg.LaneX(lane)) > 0.05f;
            float reactDistance = speed * 0.9f + 6f;

            float blocked = BlockingDistance(sim, lane, out int blockerId);
            if (blocked < reactDistance && Attentive(blockerId))
            {
                if (settling) return RunnerCommand.None;
                int best = BestLane(sim, lane, blocked);
                if (best != lane)
                {
                    int dir = best > lane ? 1 : -1;
                    if (SideClear(sim, lane + dir)) return dir > 0 ? RunnerCommand.Right : RunnerCommand.Left;
                }
            }

            var command = AvoidGroundObstacle(sim, lane, speed);
            if (command != RunnerCommand.None) return command;

            if (!settling) return SeekPickups(sim, lane, reactDistance);
            return RunnerCommand.None;
        }

        /// <summary>Decides once per threat whether this bot notices it in time.</summary>
        private bool Attentive(int threatId)
        {
            if (threatId < 0 || skill >= 1f) return true;
            if (ignoredThreats.Contains(threatId)) return false;
            if (judgedThreats.Add(threatId) && rng.Chance((1f - skill) * 0.3f))
            {
                if (ignoredThreats.Count > 64) ignoredThreats.Clear();
                ignoredThreats.Add(threatId);
                return false;
            }
            return true;
        }

        private RunnerCommand AvoidGroundObstacle(RunnerSimulation sim, int lane, float speed)
        {
            var cfg = sim.Config;
            float front = sim.Distance + cfg.HalfDepth;
            TrackItem? next = null;
            foreach (var item in items)
            {
                if (sim.IsConsumed(item.Id)) continue;
                if (item.Kind != TrackItemKind.Hurdle && item.Kind != TrackItemKind.Overhead) continue;
                // Mid lane change the runner can clip an obstacle in the lane it is passing through.
                bool inPath = item.Lane == lane
                    || Math.Abs(cfg.LaneX(item.Lane) - sim.X) < cfg.ObstacleHalfWidth + cfg.HalfWidth + 0.2f;
                if (!inPath) continue;
                if (item.EndZ < sim.Distance - cfg.HalfDepth) continue;
                if (item.Kind == TrackItemKind.Hurdle && sim.Y >= cfg.HurdleHeight) continue;
                if (item.Kind == TrackItemKind.Overhead && sim.Y >= cfg.OverheadTop) continue;
                if (next == null || item.Z < next.Value.Z) next = item;
            }
            if (next == null || !Attentive(next.Value.Id)) return RunnerCommand.None;

            float timeToFront = (next.Value.Z - front) / speed;
            if (next.Value.Kind == TrackItemKind.Hurdle)
            {
                if (timeToFront < 0.2f && sim.IsGrounded && !sim.IsRolling) return RunnerCommand.Jump;
                if (timeToFront < 0.2f && sim.IsRolling) return RunnerCommand.Jump;
            }
            else if (!sim.IsRolling && timeToFront < (sim.IsGrounded ? 0.3f : 0.4f))
            {
                return RunnerCommand.Roll;
            }
            return RunnerCommand.None;
        }

        /// <summary>Distance until a train the runner cannot get on top of blocks <paramref name="lane"/>.</summary>
        private float BlockingDistance(RunnerSimulation sim, int lane, out int blockerId)
        {
            var cfg = sim.Config;
            float hd = cfg.HalfDepth;
            float best = float.MaxValue;
            blockerId = -1;
            foreach (var item in items)
            {
                if (item.Kind != TrackItemKind.Train || item.Lane != lane || sim.IsConsumed(item.Id)) continue;
                if (item.EndZ <= sim.Distance - hd) continue;
                bool onTop = sim.Y >= cfg.TrainHeight - 0.01f && sim.Distance + hd > item.Z && lane == sim.Lane;
                if (onTop || RampUsable(sim, lane, item)) continue;
                float distance = Math.Max(0f, item.Z - (sim.Distance + hd));
                if (distance < best)
                {
                    best = distance;
                    blockerId = item.Id;
                }
            }
            return best;
        }

        private bool RampUsable(RunnerSimulation sim, int lane, TrackItem train)
        {
            var cfg = sim.Config;
            foreach (var item in items)
            {
                if (item.Kind != TrackItemKind.Ramp || item.Lane != lane) continue;
                if (Math.Abs(item.EndZ - train.Z) > 0.01f) continue;
                float travel = lane == sim.Lane ? 0f : sim.Speed * (cfg.LaneChangeTime + 0.1f) * Math.Abs(lane - sim.Lane);
                float entry = sim.Distance + cfg.HalfDepth + travel;
                float t = (entry - item.Z) / item.Length;
                float rampHeight = cfg.TrainHeight * (t < 0f ? 0f : (t > 1f ? 1f : t));
                return rampHeight <= sim.Y + cfg.StepTolerance * 0.8f;
            }
            return false;
        }

        private int BestLane(RunnerSimulation sim, int lane, float currentClear)
        {
            int best = lane;
            float bestScore = currentClear;
            for (int candidate = 0; candidate < sim.Config.LaneCount; candidate++)
            {
                if (candidate == lane || !PathClear(sim, lane, candidate)) continue;
                float clear = BlockingDistance(sim, candidate, out _);
                float score = clear - Math.Abs(candidate - lane) * 2f;
                if (score > bestScore + 0.5f)
                {
                    bestScore = score;
                    best = candidate;
                }
            }
            return best;
        }

        private bool PathClear(RunnerSimulation sim, int from, int to)
        {
            int dir = to > from ? 1 : -1;
            for (int lane = from + dir; lane != to + dir; lane += dir)
            {
                if (lane != to && BlockingDistance(sim, lane, out _) < sim.Speed * 0.6f) return false;
            }
            return true;
        }

        /// <summary>True if moving into <paramref name="lane"/> now will not clip an obstacle from the side.</summary>
        private bool SideClear(RunnerSimulation sim, int lane)
        {
            if (lane < 0 || lane >= sim.Config.LaneCount) return false;
            var cfg = sim.Config;
            float minZ = sim.Distance - cfg.HalfDepth - 0.3f;
            float maxZ = sim.Distance + cfg.HalfDepth + sim.Speed * (cfg.LaneChangeTime + 0.05f) + 0.3f;
            foreach (var item in items)
            {
                if (item.Lane != lane || !item.IsObstacle || sim.IsConsumed(item.Id)) continue;
                if (item.EndZ < minZ || item.Z > maxZ) continue;
                switch (item.Kind)
                {
                    case TrackItemKind.Train:
                        if (sim.Y < cfg.TrainHeight - cfg.StepTolerance * 0.5f) return false;
                        break;
                    case TrackItemKind.Hurdle:
                        if (sim.Y < cfg.HurdleHeight) return false;
                        break;
                    default:
                        if (sim.Y + sim.CurrentHeight > cfg.OverheadBottom && sim.Y < cfg.OverheadTop) return false;
                        break;
                }
            }
            return true;
        }

        private RunnerCommand SeekPickups(RunnerSimulation sim, int lane, float reactDistance)
        {
            pickupDecisionTimer -= sim.Config.FixedDeltaTime;
            if (pickupDecisionTimer > 0f) return RunnerCommand.None;
            pickupDecisionTimer = 0.4f;
            if (!sim.IsGrounded || !rng.Chance(0.25f + skill * 0.5f)) return RunnerCommand.None;
            if (HasPickupAhead(sim, lane)) return RunnerCommand.None;
            if (BlockingDistance(sim, lane, out _) < reactDistance * 1.5f) return RunnerCommand.None;
            if (!LaneQuiet(sim, lane)) return RunnerCommand.None;
            for (int dir = -1; dir <= 1; dir += 2)
            {
                int candidate = lane + dir;
                if (candidate < 0 || candidate >= sim.Config.LaneCount) continue;
                if (!HasPickupAhead(sim, candidate) || !SideClear(sim, candidate) || !LaneQuiet(sim, candidate)) continue;
                if (BlockingDistance(sim, candidate, out _) < reactDistance * 1.5f) continue;
                return dir > 0 ? RunnerCommand.Right : RunnerCommand.Left;
            }
            return RunnerCommand.None;
        }

        /// <summary>True when no obstacle needs handling in <paramref name="lane"/> during an optional lane change.</summary>
        private bool LaneQuiet(RunnerSimulation sim, int lane)
        {
            var cfg = sim.Config;
            float maxZ = sim.Distance + cfg.HalfDepth + sim.Speed * (cfg.LaneChangeTime + 0.6f) + 2f;
            foreach (var item in items)
            {
                if (item.Lane != lane || !item.IsObstacle || sim.IsConsumed(item.Id)) continue;
                if (item.EndZ >= sim.Distance - cfg.HalfDepth && item.Z <= maxZ) return false;
            }
            return true;
        }

        private bool HasPickupAhead(RunnerSimulation sim, int lane)
        {
            foreach (var item in items)
            {
                if (item.Lane != lane || !item.IsPickup || item.Kind == TrackItemKind.SkyCoin || sim.IsConsumed(item.Id)) continue;
                if (item.Z > sim.Distance + 2f && item.Z < sim.Distance + 18f && item.Y < sim.Y + 2.5f) return true;
            }
            return false;
        }
    }
}
