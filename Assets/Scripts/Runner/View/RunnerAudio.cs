using System;
using System.Collections.Generic;
using UnityEngine;

namespace TitanEarthfall.Runner.View
{
    public enum RunnerSound { Coin, Gem, Jump, Roll, Lane, PowerUp, Mystery, Stumble, Crash, ShieldBreak, Beep, Go, Finish, Click }

    /// <summary>Synthesizes all sound effects and a looping music track at startup (no audio assets needed).</summary>
    public sealed class RunnerAudio : MonoBehaviour
    {
        private const int SampleRate = 22050;

        private readonly Dictionary<RunnerSound, AudioClip> clips = new Dictionary<RunnerSound, AudioClip>();
        private AudioSource effects;
        private AudioSource coins;
        private AudioSource music;
        private float coinPitch = 1f;
        private float lastCoinTime;
        private bool muted;

        public bool Muted
        {
            get => muted;
            set
            {
                muted = value;
                AudioListener.volume = value ? 0f : 1f;
            }
        }

        private void Awake()
        {
            effects = gameObject.AddComponent<AudioSource>();
            effects.playOnAwake = false;
            coins = gameObject.AddComponent<AudioSource>();
            coins.playOnAwake = false;
            coins.volume = 0.5f;
            music = gameObject.AddComponent<AudioSource>();
            music.playOnAwake = false;
            music.loop = true;
            music.volume = 0.28f;

            clips[RunnerSound.Coin] = Synth("coin", 0.12f, t => Square(t < 0.04f ? 1318f : 1760f, t) * Decay(t, 0.12f) * 0.35f);
            clips[RunnerSound.Gem] = Synth("gem", 0.3f, t => (Sine(1568f, t) + Sine(2093f, t) + Sine(3136f, t) * 0.5f) * Decay(t, 0.3f) * 0.3f);
            clips[RunnerSound.Jump] = Synth("jump", 0.16f, t => Square(Mathf.Lerp(280f, 760f, t / 0.16f), t) * Decay(t, 0.16f) * 0.25f);
            clips[RunnerSound.Roll] = Synth("roll", 0.2f, t => Noise() * Decay(t, 0.2f) * 0.25f + Sine(Mathf.Lerp(300f, 120f, t / 0.2f), t) * 0.2f * Decay(t, 0.2f));
            clips[RunnerSound.Lane] = Synth("lane", 0.08f, t => Noise() * Decay(t, 0.08f) * 0.12f);
            clips[RunnerSound.PowerUp] = Synth("powerup", 0.36f, t => Square(Arpeggio(t, 0.08f, 523f, 659f, 784f, 1046f), t) * Decay(t, 0.36f) * 0.25f);
            clips[RunnerSound.Mystery] = Synth("mystery", 0.4f, t => Sine(Arpeggio(t, 0.07f, 784f, 988f, 1175f, 1568f, 1976f), t) * Decay(t, 0.4f) * 0.35f);
            clips[RunnerSound.Stumble] = Synth("stumble", 0.22f, t => (Sine(90f, t) * 0.6f + Noise() * 0.3f) * Decay(t, 0.22f) * 0.5f);
            clips[RunnerSound.Crash] = Synth("crash", 0.6f, t => (Noise() * 0.7f + Sine(Mathf.Lerp(90f, 40f, t / 0.6f), t)) * Decay(t, 0.6f) * 0.55f);
            clips[RunnerSound.ShieldBreak] = Synth("shield", 0.35f, t => (Noise() * 0.4f + Sine(2200f - t * 3000f, t) * 0.5f) * Decay(t, 0.35f) * 0.4f);
            clips[RunnerSound.Beep] = Synth("beep", 0.14f, t => Sine(880f, t) * Decay(t, 0.14f) * 0.4f);
            clips[RunnerSound.Go] = Synth("go", 0.4f, t => (Sine(1320f, t) + Square(660f, t) * 0.3f) * Decay(t, 0.4f) * 0.35f);
            clips[RunnerSound.Finish] = Synth("finish", 0.8f, t => Square(Arpeggio(t, 0.12f, 784f, 1046f, 1318f, 1568f, 1568f, 1568f), t) * Decay(t, 0.8f) * 0.3f);
            clips[RunnerSound.Click] = Synth("click", 0.04f, t => Sine(1000f, t) * Decay(t, 0.04f) * 0.3f);
            music.clip = BuildMusic();
        }

        public void Play(RunnerSound sound, float volume = 1f)
        {
            if (!clips.TryGetValue(sound, out var clip)) return;
            if (sound == RunnerSound.Coin)
            {
                // Consecutive coins climb in pitch, like a combo.
                coinPitch = Time.time - lastCoinTime < 0.5f ? Mathf.Min(1.5f, coinPitch + 0.025f) : 1f;
                lastCoinTime = Time.time;
                coins.pitch = coinPitch;
                coins.PlayOneShot(clip, volume);
                return;
            }
            effects.PlayOneShot(clip, volume);
        }

        public void SetMusic(bool playing)
        {
            if (playing && !music.isPlaying) music.Play();
            else if (!playing && music.isPlaying) music.Pause();
        }

        private static AudioClip Synth(string name, float duration, Func<float, float> sample)
        {
            int count = Mathf.CeilToInt(duration * SampleRate);
            var data = new float[count];
            for (int i = 0; i < count; i++) data[i] = Mathf.Clamp(sample(i / (float)SampleRate), -1f, 1f);
            var clip = AudioClip.Create(name, count, 1, SampleRate, false);
            clip.SetData(data, 0);
            return clip;
        }

        /// <summary>Eight-second 120 BPM loop: kick, snare, hats, bass line and a light arpeggio.</summary>
        private static AudioClip BuildMusic()
        {
            const float bpm = 120f, beat = 60f / bpm;
            const int beats = 16;
            int count = Mathf.CeilToInt(beats * beat * SampleRate);
            var data = new float[count];
            float[] roots = { 110f, 87.31f, 130.81f, 98f };
            float[][] chords =
            {
                new[] { 440f, 523.25f, 659.25f },
                new[] { 349.23f, 440f, 523.25f },
                new[] { 523.25f, 659.25f, 783.99f },
                new[] { 392f, 493.88f, 587.33f }
            };
            var random = new System.Random(7);
            for (int i = 0; i < count; i++)
            {
                float t = i / (float)SampleRate;
                float beatPos = t / beat;
                int beatIndex = (int)beatPos;
                float inBeat = (beatPos - beatIndex) * beat;
                int bar = (beatIndex / 4) % 4;
                float eighth = (beatPos * 2f) % 1f * beat * 0.5f;
                int sixteenth = (int)(beatPos * 4f);
                float inSixteenth = (beatPos * 4f - sixteenth) * beat * 0.25f;

                float kick = Sine(Mathf.Lerp(130f, 45f, Mathf.Clamp01(inBeat / 0.12f)), inBeat) * Decay(inBeat, 0.25f) * 0.9f;
                float snare = beatIndex % 2 == 1 ? ((float)random.NextDouble() * 2f - 1f) * Decay(inBeat, 0.14f) * 0.35f : 0f;
                float hat = ((beatPos * 2f) % 2f >= 1f) ? ((float)random.NextDouble() * 2f - 1f) * Decay(eighth, 0.04f) * 0.18f : 0f;
                float root = roots[bar] * (((int)(beatPos * 2f) % 4 == 3) ? 2f : 1f);
                float bass = (Sine(root, t) + Sine(root * 2f, t) * 0.3f) * Decay(eighth, beat * 0.5f) * 0.45f;
                var chord = chords[bar];
                float arp = Sine(chord[sixteenth % 3] * 2f, t) * Decay(inSixteenth, 0.1f) * 0.12f;
                data[i] = Mathf.Clamp((kick + snare + hat + bass + arp) * 0.55f, -1f, 1f);
            }
            var clip = AudioClip.Create("music", count, 1, SampleRate, false);
            clip.SetData(data, 0);
            return clip;
        }

        private static float Sine(float frequency, float t) => Mathf.Sin(2f * Mathf.PI * frequency * t);

        private static float Square(float frequency, float t) => Mathf.Sin(2f * Mathf.PI * frequency * t) > 0f ? 0.6f : -0.6f;

        private static float Decay(float t, float duration) => Mathf.Clamp01(1f - t / duration) * Mathf.Clamp01(1f - t / duration);

        private static float Noise() => UnityEngine.Random.value * 2f - 1f;

        private static float Arpeggio(float t, float step, params float[] notes) => notes[Mathf.Min(notes.Length - 1, (int)(t / step))];
    }
}
