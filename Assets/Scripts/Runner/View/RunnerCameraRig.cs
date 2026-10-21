using UnityEngine;

namespace TitanEarthfall.Runner.View
{
    /// <summary>Third-person chase camera with speed-based FOV, menu framing and impact shake.</summary>
    [RequireComponent(typeof(Camera))]
    public sealed class RunnerCameraRig : MonoBehaviour
    {
        [SerializeField] private float distanceBehind = 6.2f;
        [SerializeField] private float height = 3.3f;
        [SerializeField] private float lookAhead = 7f;
        [SerializeField] private float minFov = 58f;
        [SerializeField] private float maxFov = 72f;

        private Camera cam;
        private float shake;
        private bool initialized;

        public Camera Camera => cam ? cam : cam = GetComponent<Camera>();

        public void Shake(float amount) => shake = Mathf.Max(shake, amount);

        /// <summary>Follows a runner at <paramref name="runner"/>; <paramref name="speed01"/> widens the FOV.</summary>
        public void Follow(Vector3 runner, float speed01, bool flying, float deltaTime)
        {
            var desired = new Vector3(runner.x * 0.75f, flying ? runner.y + 2.4f : runner.y * 0.6f + height, runner.z - distanceBehind);
            var position = transform.position;
            if (!initialized)
            {
                position = desired;
                initialized = true;
            }
            position.x = Mathf.Lerp(position.x, desired.x, 1f - Mathf.Exp(-10f * deltaTime));
            position.y = Mathf.Lerp(position.y, desired.y, 1f - Mathf.Exp(-6f * deltaTime));
            position.z = desired.z;

            var target = new Vector3(runner.x * 0.85f, flying ? runner.y + 0.4f : runner.y * 0.6f + 1.3f, runner.z + lookAhead);
            ApplyShake(ref position, deltaTime);
            transform.position = position;
            transform.rotation = Quaternion.LookRotation(target - position, Vector3.up);
            Camera.fieldOfView = Mathf.Lerp(Camera.fieldOfView, Mathf.Lerp(minFov, maxFov, Mathf.Clamp01(speed01)), 1f - Mathf.Exp(-3f * deltaTime));
        }

        /// <summary>Front-facing hero shot for menus.</summary>
        public void Frame(Vector3 runner, float deltaTime)
        {
            float orbit = Mathf.Sin(Time.time * 0.25f) * 0.6f;
            var desired = runner + new Vector3(1.9f + orbit, 1.7f, 4.2f);
            var position = initialized ? Vector3.Lerp(transform.position, desired, 1f - Mathf.Exp(-3f * deltaTime)) : desired;
            initialized = true;
            transform.position = position;
            transform.rotation = Quaternion.LookRotation(runner + new Vector3(0.4f, 1.15f, 0f) - position, Vector3.up);
            Camera.fieldOfView = Mathf.Lerp(Camera.fieldOfView, 50f, 1f - Mathf.Exp(-3f * deltaTime));
        }

        private void ApplyShake(ref Vector3 position, float deltaTime)
        {
            if (shake <= 0f) return;
            position += new Vector3(Mathf.PerlinNoise(Time.time * 40f, 0f) - 0.5f, Mathf.PerlinNoise(0f, Time.time * 40f) - 0.5f, 0f) * shake;
            shake = Mathf.Max(0f, shake - deltaTime * 2.5f);
        }
    }
}
