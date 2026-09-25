using UnityEngine;

namespace TitanEarthfall.Core
{
    /// <summary>
    /// Central composition root for the game runtime.
    /// Keeps startup responsibilities separate from gameplay systems.
    /// </summary>
    public sealed class GameBootstrap : MonoBehaviour
    {
        [SerializeField] private PlayerController player;
        [SerializeField] private BiomeManager biomeManager;

        private void Awake()
        {
            if (player == null)
                player = FindFirstObjectByType<PlayerController>();

            if (biomeManager == null)
                biomeManager = FindFirstObjectByType<BiomeManager>();
        }

        private void Start()
        {
            if (player == null)
                Debug.LogWarning("GameBootstrap: PlayerController was not found.");

            if (biomeManager == null)
                Debug.LogWarning("GameBootstrap: BiomeManager was not found.");
        }
    }
}
