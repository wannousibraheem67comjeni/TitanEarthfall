using UnityEngine;

namespace TitanEarthfall.Runner.Game
{
    /// <summary>
    /// Makes the runner playable straight away: pressing Play in an empty scene (or any scene without the
    /// free-roam PlayerController/GameBootstrap) spawns <see cref="RunnerGame"/>, which builds everything
    /// procedurally. Define TITAN_NO_RUNNER_AUTOBOOT in Player Settings to turn this off.
    /// </summary>
    internal static class RunnerAutoBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Boot()
        {
#if !TITAN_NO_RUNNER_AUTOBOOT
            if (Object.FindFirstObjectByType<RunnerGame>()) return;
            if (Object.FindFirstObjectByType<PlayerController>()) return;
            if (Object.FindFirstObjectByType<TitanEarthfall.Core.GameBootstrap>()) return;
            new GameObject("Runner Game").AddComponent<RunnerGame>();
#endif
        }
    }
}
