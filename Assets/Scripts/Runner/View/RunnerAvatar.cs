using UnityEngine;

namespace TitanEarthfall.Runner.View
{
    /// <summary>
    /// Blocky procedural character with code-driven animation. Used for the local runner, remote
    /// race ghosts and the Titan chaser, so it needs no rig or animation assets.
    /// </summary>
    public sealed class RunnerAvatar : MonoBehaviour
    {
        private const float CenterHeight = 0.9f;

        private Transform model;
        private Transform armLeft;
        private Transform armRight;
        private Transform legLeft;
        private Transform legRight;
        private GameObject jetpack;
        private Transform flame;
        private GameObject shield;
        private GameObject magnetHalo;
        private float phase;
        private float deadTime;
        private float spin;

        public static RunnerAvatar Create(Transform parent, string name, Color skin, Color shirt, Color pants, Color accent,
            float scale = 1f, bool translucent = false, bool chaser = false)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            root.transform.localScale = Vector3.one * scale;
            var avatar = root.AddComponent<RunnerAvatar>();
            avatar.Build(skin, shirt, pants, accent, translucent, chaser);
            return avatar;
        }

        private void Build(Color skin, Color shirt, Color pants, Color accent, bool translucent, bool chaser)
        {
            Color Fade(Color c) => translucent ? new Color(c.r, c.g, c.b, 0.5f) : c;
            GameObject Part(Transform parent, PrimitiveType type, Vector3 position, Vector3 scale, Color color, bool emissive = false) =>
                RunnerVisuals.Part(parent, type, position, scale, Fade(color), emissive, translucent);

            model = new GameObject("Model").transform;
            model.SetParent(transform, false);
            model.localPosition = new Vector3(0f, CenterHeight, 0f);
            float o = -CenterHeight;

            Part(model, PrimitiveType.Cube, new Vector3(0f, 1.15f + o, 0f), new Vector3(0.62f, 0.72f, 0.36f), shirt);
            Part(model, PrimitiveType.Sphere, new Vector3(0f, 1.78f + o, 0f), Vector3.one * 0.46f, skin);
            Part(model, PrimitiveType.Cube, new Vector3(0f, 1.97f + o, -0.03f), new Vector3(0.5f, 0.16f, 0.5f), accent);
            if (chaser)
            {
                Part(model, PrimitiveType.Sphere, new Vector3(-0.1f, 1.82f + o, 0.2f), Vector3.one * 0.1f, new Color(1f, 0.15f, 0.1f), true);
                Part(model, PrimitiveType.Sphere, new Vector3(0.1f, 1.82f + o, 0.2f), Vector3.one * 0.1f, new Color(1f, 0.15f, 0.1f), true);
                Part(model, PrimitiveType.Cube, new Vector3(-0.38f, 1.52f + o, 0f), new Vector3(0.3f, 0.2f, 0.4f), accent);
                Part(model, PrimitiveType.Cube, new Vector3(0.38f, 1.52f + o, 0f), new Vector3(0.3f, 0.2f, 0.4f), accent);
            }
            else
            {
                Part(model, PrimitiveType.Cube, new Vector3(0f, 1.15f + o, 0.19f), new Vector3(0.3f, 0.3f, 0.02f), accent);
            }

            armLeft = Pivot(model, new Vector3(-0.42f, 1.45f + o, 0f));
            Part(armLeft, PrimitiveType.Cube, new Vector3(0f, -0.3f, 0f), new Vector3(0.17f, 0.62f, 0.17f), shirt);
            Part(armLeft, PrimitiveType.Sphere, new Vector3(0f, -0.66f, 0f), Vector3.one * 0.17f, skin);
            armRight = Pivot(model, new Vector3(0.42f, 1.45f + o, 0f));
            Part(armRight, PrimitiveType.Cube, new Vector3(0f, -0.3f, 0f), new Vector3(0.17f, 0.62f, 0.17f), shirt);
            Part(armRight, PrimitiveType.Sphere, new Vector3(0f, -0.66f, 0f), Vector3.one * 0.17f, skin);

            legLeft = Pivot(model, new Vector3(-0.17f, 0.8f + o, 0f));
            Part(legLeft, PrimitiveType.Cube, new Vector3(0f, -0.38f, 0f), new Vector3(0.22f, 0.76f, 0.24f), pants);
            Part(legLeft, PrimitiveType.Cube, new Vector3(0f, -0.76f, 0.07f), new Vector3(0.25f, 0.12f, 0.38f), accent);
            legRight = Pivot(model, new Vector3(0.17f, 0.8f + o, 0f));
            Part(legRight, PrimitiveType.Cube, new Vector3(0f, -0.38f, 0f), new Vector3(0.22f, 0.76f, 0.24f), pants);
            Part(legRight, PrimitiveType.Cube, new Vector3(0f, -0.76f, 0.07f), new Vector3(0.25f, 0.12f, 0.38f), accent);

            var pack = Pivot(model, new Vector3(0f, 1.2f + o, -0.3f));
            jetpack = pack.gameObject;
            Part(pack, PrimitiveType.Cylinder, new Vector3(-0.14f, 0f, 0f), new Vector3(0.2f, 0.3f, 0.2f), new Color(1f, 0.5f, 0.1f));
            Part(pack, PrimitiveType.Cylinder, new Vector3(0.14f, 0f, 0f), new Vector3(0.2f, 0.3f, 0.2f), new Color(1f, 0.5f, 0.1f));
            flame = Part(pack, PrimitiveType.Sphere, new Vector3(0f, -0.5f, 0f), new Vector3(0.28f, 0.55f, 0.28f), new Color(1f, 0.75f, 0.2f), true).transform;
            jetpack.SetActive(false);

            shield = RunnerVisuals.Part(transform, PrimitiveType.Sphere, new Vector3(0f, 1f, 0f), new Vector3(2.2f, 2.5f, 2.2f),
                new Color(0.3f, 0.7f, 1f, 0.25f), true, true);
            shield.SetActive(false);
            magnetHalo = Part(model, PrimitiveType.Cylinder, new Vector3(0f, 2.3f + o, 0f), new Vector3(0.65f, 0.03f, 0.65f), new Color(1f, 0.2f, 0.25f), true);
            magnetHalo.SetActive(false);
        }

        private static Transform Pivot(Transform parent, Vector3 position)
        {
            var pivot = new GameObject("Pivot").transform;
            pivot.SetParent(parent, false);
            pivot.localPosition = position;
            return pivot;
        }

        public void SetVisible(bool visible)
        {
            if (gameObject.activeSelf != visible) gameObject.SetActive(visible);
        }

        /// <summary>Places the avatar and poses it for this frame.</summary>
        public void Apply(Vector3 position, RunnerPose pose, byte powerUps, float speed, float deltaTime)
        {
            transform.localPosition = position;
            bool flying = pose == RunnerPose.Flying;
            SetActive(jetpack, flying);
            SetActive(shield, (powerUps & (1 << (int)PowerUpKind.Shield)) != 0);
            SetActive(magnetHalo, (powerUps & (1 << (int)PowerUpKind.Magnet)) != 0);

            float time = Time.time;
            phase += speed * deltaTime * 0.55f;
            float swing = Mathf.Sin(phase);
            var legL = Vector3.zero;
            var legR = Vector3.zero;
            var armL = Vector3.zero;
            var armR = Vector3.zero;
            var modelPosition = new Vector3(0f, CenterHeight, 0f);
            var modelEuler = Vector3.zero;
            var modelScale = Vector3.one;

            if (pose != RunnerPose.Dead) deadTime = 0f;
            switch (pose)
            {
                case RunnerPose.Jumping:
                case RunnerPose.Falling:
                    legL = new Vector3(-75f, 0f, 0f);
                    legR = new Vector3(-20f, 0f, 0f);
                    armL = new Vector3(-150f, 0f, -15f);
                    armR = new Vector3(-150f, 0f, 15f);
                    break;
                case RunnerPose.Rolling:
                    spin += deltaTime * 900f;
                    modelPosition.y = 0.45f;
                    modelEuler = new Vector3(spin, 0f, 0f);
                    modelScale = new Vector3(0.9f, 0.5f, 0.9f);
                    legL = legR = new Vector3(-100f, 0f, 0f);
                    armL = armR = new Vector3(-60f, 0f, 0f);
                    break;
                case RunnerPose.Flying:
                    modelEuler = new Vector3(18f, 0f, Mathf.Sin(time * 2f) * 6f);
                    legL = new Vector3(15f, 0f, 0f);
                    legR = new Vector3(25f, 0f, 0f);
                    armL = new Vector3(-30f, 0f, -20f);
                    armR = new Vector3(-30f, 0f, 20f);
                    float flicker = 0.8f + Mathf.PerlinNoise(time * 20f, 0f) * 0.6f;
                    flame.localScale = new Vector3(0.28f, 0.55f * flicker, 0.28f);
                    break;
                case RunnerPose.Dead:
                    deadTime += deltaTime;
                    float fall = Mathf.Clamp01(deadTime * 3f);
                    modelEuler = new Vector3(-85f * fall, 0f, 0f);
                    modelPosition.y = Mathf.Lerp(CenterHeight, 0.3f, fall);
                    armL = new Vector3(-170f * fall, 0f, -30f);
                    armR = new Vector3(-170f * fall, 0f, 30f);
                    break;
                case RunnerPose.Finished:
                    modelPosition.y += Mathf.Abs(Mathf.Sin(time * 6f)) * 0.25f;
                    armL = new Vector3(-175f, 0f, -20f);
                    armR = new Vector3(-175f, 0f, 20f);
                    break;
                default:
                    legL = new Vector3(swing * 48f, 0f, 0f);
                    legR = new Vector3(-swing * 48f, 0f, 0f);
                    armL = new Vector3(-swing * 42f, 0f, 0f);
                    armR = new Vector3(swing * 42f, 0f, 0f);
                    modelPosition.y += Mathf.Abs(Mathf.Cos(phase)) * 0.06f * Mathf.Clamp01(speed);
                    modelEuler.x = Mathf.Clamp(speed * 0.4f, 0f, 10f);
                    if (pose == RunnerPose.Stumbling) modelEuler.z = Mathf.Sin(time * 35f) * 12f;
                    break;
            }

            float blend = 1f - Mathf.Exp(-25f * deltaTime);
            legLeft.localRotation = Quaternion.Slerp(legLeft.localRotation, Quaternion.Euler(legL), blend);
            legRight.localRotation = Quaternion.Slerp(legRight.localRotation, Quaternion.Euler(legR), blend);
            armLeft.localRotation = Quaternion.Slerp(armLeft.localRotation, Quaternion.Euler(armL), blend);
            armRight.localRotation = Quaternion.Slerp(armRight.localRotation, Quaternion.Euler(armR), blend);
            model.localPosition = Vector3.Lerp(model.localPosition, modelPosition, blend);
            model.localRotation = pose == RunnerPose.Rolling ? Quaternion.Euler(modelEuler) : Quaternion.Slerp(model.localRotation, Quaternion.Euler(modelEuler), blend);
            model.localScale = Vector3.Lerp(model.localScale, modelScale, blend);
        }

        private static void SetActive(GameObject target, bool active)
        {
            if (target.activeSelf != active) target.SetActive(active);
        }
    }
}
