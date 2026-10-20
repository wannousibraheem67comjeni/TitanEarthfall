using System;
using System.Collections.Generic;
using UnityEngine;

namespace TitanEarthfall.Runner.View
{
    /// <summary>
    /// Streams pooled visuals for the chunks around the camera. Purely presentational: it reads the
    /// shared <see cref="Track"/> and asks the simulation which items the local runner already consumed.
    /// </summary>
    public sealed class TrackView : MonoBehaviour
    {
        private sealed class ItemSlot
        {
            public TrackItem Item;
            public GameObject Visual;
            public Vector3 BasePosition;
        }

        private sealed class ChunkSlot
        {
            public readonly List<ItemSlot> Items = new List<ItemSlot>();
            public readonly List<GameObject> Props = new List<GameObject>();
            public readonly List<PrimitiveType> PropTypes = new List<PrimitiveType>();
        }

        private static readonly Color CoinColor = new Color(1f, 0.78f, 0.12f);
        private static readonly Color SkyCoinColor = new Color(1f, 0.9f, 0.35f);

        [SerializeField, Min(1)] private int chunksAhead = 3;
        [SerializeField, Min(0)] private int chunksBehind = 1;

        private readonly Dictionary<int, ChunkSlot> active = new Dictionary<int, ChunkSlot>();
        private readonly Dictionary<TrackItemKind, Stack<GameObject>> itemPool = new Dictionary<TrackItemKind, Stack<GameObject>>();
        private readonly Dictionary<PrimitiveType, Stack<GameObject>> propPool = new Dictionary<PrimitiveType, Stack<GameObject>>();
        private readonly List<int> removeScratch = new List<int>();
        private Track track;
        private RunnerConfig config;
        private Func<int, bool> isConsumed;
        private GameObject finishGate;
        private Transform itemRoot;
        private Transform propRoot;

        private void Awake()
        {
            itemRoot = new GameObject("Items").transform;
            itemRoot.SetParent(transform, false);
            propRoot = new GameObject("Scenery").transform;
            propRoot.SetParent(transform, false);
        }

        public void Bind(Track newTrack, Func<int, bool> consumed, float finishDistance)
        {
            Clear();
            track = newTrack;
            config = newTrack.Config;
            isConsumed = consumed ?? (_ => false);
            if (finishDistance > 0f) finishGate = BuildFinishGate(finishDistance);
        }

        public void Clear()
        {
            foreach (var chunk in active.Values) Release(chunk);
            active.Clear();
            if (finishGate) Destroy(finishGate);
            finishGate = null;
            track = null;
        }

        public void Refresh(float distance, bool showSkyCoins, float time)
        {
            if (track == null) return;
            int center = track.ChunkIndexAt(distance);
            int min = Math.Max(0, center - chunksBehind);
            int max = center + chunksAhead;

            removeScratch.Clear();
            foreach (var pair in active)
                if (pair.Key < min || pair.Key > max) removeScratch.Add(pair.Key);
            foreach (int index in removeScratch)
            {
                Release(active[index]);
                active.Remove(index);
            }
            for (int index = min; index <= max; index++)
                if (!active.ContainsKey(index)) active[index] = Build(track.GetChunk(index));

            var spin = Quaternion.Euler(0f, time * 220f, 0f);
            var slowSpin = Quaternion.Euler(0f, time * 90f, 0f);
            float bob = Mathf.Sin(time * 3f) * 0.15f;
            foreach (var chunk in active.Values)
            {
                foreach (var slot in chunk.Items)
                {
                    var item = slot.Item;
                    bool visible = !isConsumed(item.Id) && (item.Kind != TrackItemKind.SkyCoin || showSkyCoins);
                    if (slot.Visual.activeSelf != visible) slot.Visual.SetActive(visible);
                    if (!visible || !item.IsPickup) continue;
                    var t = slot.Visual.transform;
                    if (item.Kind == TrackItemKind.Coin || item.Kind == TrackItemKind.SkyCoin)
                    {
                        t.localRotation = spin;
                    }
                    else
                    {
                        t.localRotation = slowSpin;
                        t.localPosition = slot.BasePosition + new Vector3(0f, bob, 0f);
                    }
                }
            }
        }

        private ChunkSlot Build(TrackChunk chunk)
        {
            var slot = new ChunkSlot();
            var theme = BiomePalette.Get(chunk.Biome);
            BuildGround(slot, chunk, theme);
            BuildScenery(slot, chunk, theme);
            foreach (var item in chunk.Items)
            {
                var visual = Take(item.Kind);
                Place(visual, item, theme);
                slot.Items.Add(new ItemSlot { Item = item, Visual = visual, BasePosition = visual.transform.localPosition });
            }
            return slot;
        }

        private void Release(ChunkSlot chunk)
        {
            foreach (var slot in chunk.Items)
            {
                slot.Visual.SetActive(false);
                Pool(itemPool, slot.Item.Kind).Push(slot.Visual);
            }
            for (int i = 0; i < chunk.Props.Count; i++)
            {
                chunk.Props[i].SetActive(false);
                Pool(propPool, chunk.PropTypes[i]).Push(chunk.Props[i]);
            }
        }

        private static Stack<GameObject> Pool<TKey>(Dictionary<TKey, Stack<GameObject>> pools, TKey key)
        {
            if (!pools.TryGetValue(key, out var stack)) pools[key] = stack = new Stack<GameObject>();
            return stack;
        }

        private GameObject Take(TrackItemKind kind)
        {
            var pool = Pool(itemPool, kind);
            var visual = pool.Count > 0 ? pool.Pop() : CreateItem(kind);
            visual.SetActive(true);
            return visual;
        }

        private void Place(GameObject visual, TrackItem item, BiomeTheme theme)
        {
            float x = config.LaneX(item.Lane);
            var t = visual.transform;
            t.localRotation = Quaternion.identity;
            switch (item.Kind)
            {
                case TrackItemKind.Hurdle:
                case TrackItemKind.Overhead:
                    t.localPosition = new Vector3(x, 0f, item.Z + item.Length * 0.5f);
                    break;
                case TrackItemKind.Train:
                    t.localPosition = new Vector3(x, 0f, item.Z + item.Length * 0.5f);
                    visual.GetComponent<TrainVisual>().Configure(item.Length, config.TrainHeight, theme);
                    break;
                case TrackItemKind.Ramp:
                    t.localPosition = new Vector3(x, 0f, item.Z);
                    RunnerVisuals.Paint(t.GetChild(0).gameObject, Color.Lerp(theme.Train, Color.black, 0.35f));
                    break;
                default:
                    t.localPosition = new Vector3(x, item.Y, item.Z);
                    break;
            }
        }

        private GameObject CreateItem(TrackItemKind kind)
        {
            var root = new GameObject(kind.ToString());
            var t = root.transform;
            t.SetParent(itemRoot, false);
            switch (kind)
            {
                case TrackItemKind.Coin:
                case TrackItemKind.SkyCoin:
                {
                    var coin = RunnerVisuals.Part(t, PrimitiveType.Cylinder, Vector3.zero, new Vector3(0.62f, 0.05f, 0.62f),
                        kind == TrackItemKind.Coin ? CoinColor : SkyCoinColor, emissive: true);
                    coin.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
                    break;
                }
                case TrackItemKind.Gem:
                {
                    var gem = RunnerVisuals.Part(t, PrimitiveType.Cube, Vector3.zero, Vector3.one * 0.42f, new Color(0.2f, 0.95f, 1f), emissive: true);
                    gem.transform.localRotation = Quaternion.Euler(45f, 0f, 45f);
                    break;
                }
                case TrackItemKind.Hurdle:
                {
                    var red = new Color(0.86f, 0.15f, 0.12f);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(-0.95f, 0.45f, 0f), new Vector3(0.12f, 0.9f, 0.12f), Color.white);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(0.95f, 0.45f, 0f), new Vector3(0.12f, 0.9f, 0.12f), Color.white);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(0f, 0.72f, 0f), new Vector3(2.05f, 0.32f, 0.14f), red);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(0f, 0.72f, -0.01f), new Vector3(0.6f, 0.33f, 0.14f), Color.white);
                    break;
                }
                case TrackItemKind.Overhead:
                {
                    var yellow = new Color(1f, 0.8f, 0.1f);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(-1.02f, 1.5f, 0f), new Vector3(0.16f, 3f, 0.16f), new Color(0.25f, 0.25f, 0.28f));
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(1.02f, 1.5f, 0f), new Vector3(0.16f, 3f, 0.16f), new Color(0.25f, 0.25f, 0.28f));
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(0f, 1.95f, 0f), new Vector3(2.1f, 1.7f, 0.3f), yellow);
                    for (int i = -1; i <= 1; i++)
                        RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(i * 0.62f, 1.95f, -0.16f), new Vector3(0.28f, 1.72f, 0.02f), Color.black)
                            .transform.localRotation = Quaternion.Euler(0f, 0f, 30f);
                    break;
                }
                case TrackItemKind.Train:
                    root.AddComponent<TrainVisual>();
                    break;
                case TrackItemKind.Ramp:
                {
                    float length = config.RampLength, height = config.TrainHeight;
                    float slope = Mathf.Sqrt(length * length + height * height);
                    var deck = RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(0f, height * 0.5f - 0.1f, length * 0.5f), new Vector3(2.2f, 0.2f, slope), Color.gray);
                    deck.transform.localRotation = Quaternion.Euler(-Mathf.Atan2(height, length) * Mathf.Rad2Deg, 0f, 0f);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(0f, height * 0.4f, length - 0.4f), new Vector3(1.8f, height * 0.8f, 0.3f), new Color(0.3f, 0.3f, 0.32f));
                    break;
                }
                case TrackItemKind.Magnet:
                {
                    var red = new Color(0.9f, 0.1f, 0.15f);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(-0.22f, 0.05f, 0f), new Vector3(0.16f, 0.5f, 0.16f), red, emissive: true);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(0.22f, 0.05f, 0f), new Vector3(0.16f, 0.5f, 0.16f), red, emissive: true);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(0f, -0.22f, 0f), new Vector3(0.6f, 0.16f, 0.16f), red, emissive: true);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(-0.22f, 0.36f, 0f), new Vector3(0.17f, 0.12f, 0.17f), Color.white);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(0.22f, 0.36f, 0f), new Vector3(0.17f, 0.12f, 0.17f), Color.white);
                    break;
                }
                case TrackItemKind.Jetpack:
                {
                    var orange = new Color(1f, 0.5f, 0.1f);
                    RunnerVisuals.Part(t, PrimitiveType.Cylinder, new Vector3(-0.15f, 0f, 0f), new Vector3(0.24f, 0.32f, 0.24f), orange, emissive: true);
                    RunnerVisuals.Part(t, PrimitiveType.Cylinder, new Vector3(0.15f, 0f, 0f), new Vector3(0.24f, 0.32f, 0.24f), orange, emissive: true);
                    RunnerVisuals.Part(t, PrimitiveType.Sphere, new Vector3(0f, -0.4f, 0f), new Vector3(0.25f, 0.35f, 0.25f), new Color(1f, 0.9f, 0.3f), emissive: true);
                    break;
                }
                case TrackItemKind.SuperSneakers:
                {
                    var green = new Color(0.2f, 0.9f, 0.3f);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(0f, 0.05f, 0f), new Vector3(0.36f, 0.24f, 0.62f), green, emissive: true);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(0f, -0.12f, 0.02f), new Vector3(0.38f, 0.1f, 0.66f), Color.white);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(0f, 0.2f, -0.2f), new Vector3(0.34f, 0.2f, 0.2f), green, emissive: true);
                    break;
                }
                case TrackItemKind.Multiplier:
                {
                    var purple = new Color(0.65f, 0.25f, 1f);
                    RunnerVisuals.Part(t, PrimitiveType.Sphere, new Vector3(-0.17f, 0f, 0f), Vector3.one * 0.36f, purple, emissive: true);
                    RunnerVisuals.Part(t, PrimitiveType.Sphere, new Vector3(0.17f, 0f, 0f), Vector3.one * 0.36f, purple, emissive: true);
                    break;
                }
                case TrackItemKind.Shield:
                {
                    var blue = new Color(0.25f, 0.6f, 1f);
                    RunnerVisuals.Part(t, PrimitiveType.Cylinder, Vector3.zero, new Vector3(0.75f, 0.04f, 0.75f), blue, emissive: true)
                        .transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
                    RunnerVisuals.Part(t, PrimitiveType.Sphere, Vector3.zero, Vector3.one * 0.3f, Color.white, emissive: true);
                    break;
                }
                case TrackItemKind.MysteryBox:
                {
                    RunnerVisuals.Part(t, PrimitiveType.Cube, Vector3.zero, Vector3.one * 0.62f, new Color(0.55f, 0.3f, 0.95f), emissive: true);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, Vector3.zero, new Vector3(0.66f, 0.12f, 0.66f), new Color(1f, 0.85f, 0.2f), emissive: true);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, Vector3.zero, new Vector3(0.12f, 0.66f, 0.66f), new Color(1f, 0.85f, 0.2f), emissive: true);
                    break;
                }
            }
            return root;
        }

        private void BuildGround(ChunkSlot slot, TrackChunk chunk, BiomeTheme theme)
        {
            float length = chunk.EndZ - chunk.StartZ + 0.05f;
            float mid = (chunk.StartZ + chunk.EndZ) * 0.5f;
            float trackWidth = config.LaneCount * config.LaneWidth + 1.5f;
            Prop(slot, PrimitiveType.Cube, new Vector3(0f, -0.25f, mid), new Vector3(trackWidth, 0.5f, length), theme.Ground);
            Prop(slot, PrimitiveType.Cube, new Vector3(-(trackWidth * 0.5f + 30f), -0.45f, mid), new Vector3(60f, 0.5f, length), theme.Side);
            Prop(slot, PrimitiveType.Cube, new Vector3(trackWidth * 0.5f + 30f, -0.45f, mid), new Vector3(60f, 0.5f, length), theme.Side);
            for (int lane = 0; lane < config.LaneCount; lane++)
            {
                float x = config.LaneX(lane);
                Prop(slot, PrimitiveType.Cube, new Vector3(x - 0.6f, 0.05f, mid), new Vector3(0.1f, 0.1f, length), theme.Rail);
                Prop(slot, PrimitiveType.Cube, new Vector3(x + 0.6f, 0.05f, mid), new Vector3(0.1f, 0.1f, length), theme.Rail);
            }
            var stripe = Color.Lerp(theme.Ground, Color.white, 0.25f);
            for (int lane = 1; lane < config.LaneCount; lane++)
            {
                float x = (config.LaneX(lane - 1) + config.LaneX(lane)) * 0.5f;
                Prop(slot, PrimitiveType.Cube, new Vector3(x, 0.005f, mid), new Vector3(0.14f, 0.02f, length), stripe);
            }
            // Edge walls make the course readable at speed.
            Prop(slot, PrimitiveType.Cube, new Vector3(-trackWidth * 0.5f, 0.3f, mid), new Vector3(0.3f, 0.6f, length), theme.Accent);
            Prop(slot, PrimitiveType.Cube, new Vector3(trackWidth * 0.5f, 0.3f, mid), new Vector3(0.3f, 0.6f, length), theme.Accent);
        }

        private void BuildScenery(ChunkSlot slot, TrackChunk chunk, BiomeTheme theme)
        {
            var rng = new DeterministicRandom(chunk.DecorSeed);
            float edge = (config.LaneCount * config.LaneWidth + 1.5f) * 0.5f + 2.5f;
            for (float z = chunk.StartZ + rng.Range(2f, 8f); z < chunk.EndZ - 2f; z += rng.Range(9f, 16f))
            {
                for (int side = -1; side <= 1; side += 2)
                {
                    if (rng.Chance(0.2f)) continue;
                    float x = side * (edge + rng.Range(0.5f, 7f));
                    SpawnProp(slot, theme, rng, x, z, side);
                }
            }
        }

        private void SpawnProp(ChunkSlot slot, BiomeTheme theme, DeterministicRandom rng, float x, float z, int side)
        {
            Color a = Color.Lerp(theme.PropA, theme.PropB, rng.NextFloat() * 0.35f);
            switch (theme.Style)
            {
                case SceneryStyle.City:
                {
                    float w = rng.Range(5f, 9f), h = rng.Range(8f, 26f), d = rng.Range(6f, 10f);
                    float cx = x + side * w * 0.5f;
                    Prop(slot, PrimitiveType.Cube, new Vector3(cx, h * 0.5f, z), new Vector3(w, h, d), a);
                    for (float y = 3f; y < h - 1f; y += 4f)
                        Prop(slot, PrimitiveType.Cube, new Vector3(cx, y, z), new Vector3(w + 0.05f, 0.7f, d * 0.8f), theme.TrainStripe, true);
                    break;
                }
                case SceneryStyle.Cyber:
                {
                    float w = rng.Range(3f, 6f), h = rng.Range(12f, 34f);
                    float cx = x + side * w * 0.5f;
                    Prop(slot, PrimitiveType.Cube, new Vector3(cx, h * 0.5f, z), new Vector3(w, h, w), theme.PropA);
                    Prop(slot, PrimitiveType.Cube, new Vector3(cx - side * w * 0.5f, h * 0.5f, z), new Vector3(0.15f, h, 0.15f), rng.Chance(0.5f) ? theme.PropB : theme.Accent, true);
                    break;
                }
                case SceneryStyle.Forest:
                {
                    float h = rng.Range(2f, 4f), r = rng.Range(2.5f, 4.5f);
                    Prop(slot, PrimitiveType.Cylinder, new Vector3(x, h * 0.5f, z), new Vector3(0.5f, h * 0.5f, 0.5f), theme.PropA);
                    Prop(slot, PrimitiveType.Sphere, new Vector3(x, h + r * 0.4f, z), new Vector3(r, r * 1.2f, r), theme.PropB);
                    break;
                }
                case SceneryStyle.Farm:
                {
                    if (rng.Chance(0.5f))
                    {
                        float w = rng.Range(3.5f, 5f);
                        float cx = x + side * w * 0.5f;
                        Prop(slot, PrimitiveType.Cube, new Vector3(cx, 1.5f, z), new Vector3(w, 3f, w), theme.PropA);
                        Prop(slot, PrimitiveType.Cube, new Vector3(cx, 3.2f, z), new Vector3(w * 0.72f, w * 0.72f, w + 0.3f), theme.PropB, false, Quaternion.Euler(0f, 0f, 45f));
                    }
                    else
                    {
                        Prop(slot, PrimitiveType.Cube, new Vector3(x, 0.5f, z), new Vector3(0.15f, 1f, 6f), theme.PropA);
                        Prop(slot, PrimitiveType.Sphere, new Vector3(x + side * 3f, 0.7f, z), new Vector3(2f, 1.4f, 2f), theme.Accent);
                    }
                    break;
                }
                case SceneryStyle.Dunes:
                case SceneryStyle.Desert:
                {
                    if (rng.Chance(0.6f))
                    {
                        float r = rng.Range(5f, 10f);
                        Prop(slot, PrimitiveType.Sphere, new Vector3(x + side * r * 0.4f, 0f, z), new Vector3(r, r * 0.3f, r * 1.4f), theme.PropA);
                    }
                    else
                    {
                        float h = rng.Range(2f, 3.5f);
                        Prop(slot, PrimitiveType.Cylinder, new Vector3(x, h * 0.5f, z), new Vector3(0.45f, h * 0.5f, 0.45f), theme.PropB);
                        Prop(slot, PrimitiveType.Cylinder, new Vector3(x + 0.45f, h * 0.6f, z), new Vector3(0.3f, 0.45f, 0.3f), theme.PropB);
                    }
                    break;
                }
                case SceneryStyle.Beach:
                {
                    Prop(slot, PrimitiveType.Cylinder, new Vector3(x, 1.2f, z), new Vector3(0.1f, 1.2f, 0.1f), Color.white);
                    Prop(slot, PrimitiveType.Sphere, new Vector3(x, 2.4f, z), new Vector3(2.6f, 0.5f, 2.6f), rng.Chance(0.5f) ? theme.PropA : theme.PropB);
                    Prop(slot, PrimitiveType.Cube, new Vector3(x + side * 1.4f, 0.02f, z), new Vector3(1f, 0.04f, 1.8f), theme.Accent);
                    break;
                }
                case SceneryStyle.Water:
                {
                    if (rng.Chance(0.5f))
                    {
                        Prop(slot, PrimitiveType.Cylinder, new Vector3(x, 0.3f, z), new Vector3(0.6f, 0.5f, 0.6f), theme.Accent, true);
                        Prop(slot, PrimitiveType.Cylinder, new Vector3(x, 0.85f, z), new Vector3(0.3f, 0.12f, 0.3f), Color.white);
                    }
                    else
                    {
                        float s = rng.Range(1.5f, 4f);
                        Prop(slot, PrimitiveType.Cube, new Vector3(x + side * s, 0.2f, z), Vector3.one * s, theme.PropA, false,
                            Quaternion.Euler(rng.Range(0f, 40f), rng.Range(0f, 90f), rng.Range(0f, 40f)));
                    }
                    break;
                }
                default:
                {
                    // Rocks and Ice: tumbled boulders and spires.
                    float s = rng.Range(1.5f, 5f);
                    bool spire = theme.Style == SceneryStyle.Ice && rng.Chance(0.4f);
                    var scale = spire ? new Vector3(s * 0.4f, s * 2.2f, s * 0.4f) : Vector3.one * s;
                    Prop(slot, PrimitiveType.Cube, new Vector3(x + side * s * 0.5f, scale.y * 0.35f, z), scale, a, false,
                        Quaternion.Euler(rng.Range(0f, 30f), rng.Range(0f, 90f), rng.Range(0f, 30f)));
                    if (rng.Chance(0.4f))
                        Prop(slot, PrimitiveType.Sphere, new Vector3(x - side * 0.8f, 0.4f, z + 1.5f), new Vector3(1.4f, 0.9f, 1.4f), theme.PropB);
                    break;
                }
            }
        }

        private void Prop(ChunkSlot slot, PrimitiveType type, Vector3 position, Vector3 scale, Color color, bool emissive = false, Quaternion? rotation = null)
        {
            var pool = Pool(propPool, type);
            GameObject prop;
            if (pool.Count > 0)
            {
                prop = pool.Pop();
                prop.SetActive(true);
            }
            else
            {
                prop = RunnerVisuals.Part(propRoot, type, Vector3.zero, Vector3.one, color);
            }
            var t = prop.transform;
            t.localPosition = position;
            t.localScale = scale;
            t.localRotation = rotation ?? Quaternion.identity;
            RunnerVisuals.Paint(prop, color, emissive);
            slot.Props.Add(prop);
            slot.PropTypes.Add(type);
        }

        private GameObject BuildFinishGate(float z)
        {
            var gate = new GameObject("Finish Line");
            var t = gate.transform;
            t.SetParent(transform, false);
            t.localPosition = new Vector3(0f, 0f, z);
            float half = (config.LaneCount * config.LaneWidth + 1.5f) * 0.5f + 0.4f;
            RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(-half, 3.5f, 0f), new Vector3(0.6f, 7f, 0.6f), Color.white);
            RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(half, 3.5f, 0f), new Vector3(0.6f, 7f, 0.6f), Color.white);
            int tiles = 12;
            float width = half * 2f / tiles;
            for (int i = 0; i < tiles; i++)
            {
                for (int row = 0; row < 2; row++)
                {
                    var color = (i + row) % 2 == 0 ? Color.black : Color.white;
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(-half + width * (i + 0.5f), 6.4f + row * 0.6f, 0f), new Vector3(width, 0.6f, 0.2f), color);
                    RunnerVisuals.Part(t, PrimitiveType.Cube, new Vector3(-half + width * (i + 0.5f), 0.02f, row * 0.6f), new Vector3(width, 0.04f, 0.6f), color);
                }
            }
            return gate;
        }
    }

    /// <summary>Train car whose length is set per placement.</summary>
    public sealed class TrainVisual : MonoBehaviour
    {
        private GameObject body;
        private GameObject chassis;
        private GameObject stripe;
        private GameObject windows;
        private GameObject front;
        private GameObject lightLeft;
        private GameObject lightRight;

        public void Configure(float length, float height, BiomeTheme theme)
        {
            if (!body)
            {
                var t = transform;
                body = RunnerVisuals.Part(t, PrimitiveType.Cube, Vector3.zero, Vector3.one, theme.Train);
                chassis = RunnerVisuals.Part(t, PrimitiveType.Cube, Vector3.zero, Vector3.one, new Color(0.15f, 0.15f, 0.17f));
                stripe = RunnerVisuals.Part(t, PrimitiveType.Cube, Vector3.zero, Vector3.one, theme.TrainStripe);
                windows = RunnerVisuals.Part(t, PrimitiveType.Cube, Vector3.zero, Vector3.one, new Color(0.12f, 0.16f, 0.24f));
                front = RunnerVisuals.Part(t, PrimitiveType.Cube, Vector3.zero, Vector3.one, theme.Accent);
                lightLeft = RunnerVisuals.Part(t, PrimitiveType.Sphere, Vector3.zero, Vector3.one * 0.32f, new Color(1f, 0.95f, 0.6f), emissive: true);
                lightRight = RunnerVisuals.Part(t, PrimitiveType.Sphere, Vector3.zero, Vector3.one * 0.32f, new Color(1f, 0.95f, 0.6f), emissive: true);
            }
            float bodyHeight = height - 0.3f;
            Set(body, new Vector3(0f, 0.3f + bodyHeight * 0.5f, 0f), new Vector3(2.2f, bodyHeight, length - 0.1f), theme.Train);
            Set(chassis, new Vector3(0f, 0.15f, 0f), new Vector3(1.9f, 0.3f, Mathf.Max(0.5f, length - 1f)), new Color(0.15f, 0.15f, 0.17f));
            Set(stripe, new Vector3(0f, 1.2f, 0f), new Vector3(2.24f, 0.32f, length * 0.94f), theme.TrainStripe);
            Set(windows, new Vector3(0f, height - 0.85f, 0f), new Vector3(2.24f, 0.55f, length * 0.86f), new Color(0.12f, 0.16f, 0.24f));
            Set(front, new Vector3(0f, 0.3f + bodyHeight * 0.5f, -length * 0.5f + 0.02f), new Vector3(2.26f, bodyHeight, 0.12f), theme.Accent);
            lightLeft.transform.localPosition = new Vector3(-0.62f, 0.85f, -length * 0.5f - 0.05f);
            lightRight.transform.localPosition = new Vector3(0.62f, 0.85f, -length * 0.5f - 0.05f);
        }

        private static void Set(GameObject part, Vector3 position, Vector3 scale, Color color)
        {
            part.transform.localPosition = position;
            part.transform.localScale = scale;
            RunnerVisuals.Paint(part, color);
        }
    }
}
