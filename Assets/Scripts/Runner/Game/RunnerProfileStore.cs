using System;
using UnityEngine;

namespace TitanEarthfall.Runner.Game
{
    /// <summary>Versioned PlayerPrefs persistence for <see cref="RunnerProfileData"/>.</summary>
    public static class RunnerProfileStore
    {
        private const string Key = "runner.profile.v1";

        public static RunnerProfileData Load()
        {
            RunnerProfileData profile = null;
            if (PlayerPrefs.HasKey(Key))
            {
                try
                {
                    profile = JsonUtility.FromJson<RunnerProfileData>(PlayerPrefs.GetString(Key));
                }
                catch (ArgumentException e)
                {
                    Debug.LogWarning($"RunnerProfileStore: discarding unreadable profile ({e.Message}).");
                }
            }
            profile = profile ?? new RunnerProfileData();
            profile.Normalize();
            return profile;
        }

        public static void Save(RunnerProfileData profile)
        {
            if (profile == null) return;
            PlayerPrefs.SetString(Key, JsonUtility.ToJson(profile));
            PlayerPrefs.Save();
        }
    }
}
