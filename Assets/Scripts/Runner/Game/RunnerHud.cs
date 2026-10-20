using System.Collections.Generic;
using TitanEarthfall.Runner.Net;
using UnityEngine;

namespace TitanEarthfall.Runner.Game
{
    /// <summary>
    /// Immediate-mode HUD and menus. Layout uses a virtual canvas whose short side is 1080 units so it
    /// scales to any phone or desktop resolution in portrait or landscape and respects the safe area.
    /// </summary>
    [RequireComponent(typeof(RunnerGame))]
    public sealed class RunnerHud : MonoBehaviour
    {
        private const float ReferenceShortSide = 1080f;

        private static readonly Color GoldColor = new Color(1f, 0.8f, 0.2f);
        private static readonly Color Green = new Color(0.2f, 0.72f, 0.32f);
        private static readonly Color Orange = new Color(0.95f, 0.5f, 0.12f);
        private static readonly Color Blue = new Color(0.18f, 0.48f, 0.9f);
        private static readonly Color Purple = new Color(0.55f, 0.32f, 0.85f);
        private static readonly Color Teal = new Color(0.1f, 0.6f, 0.6f);
        private static readonly Color Pink = new Color(0.85f, 0.3f, 0.55f);
        private static readonly Color Grey = new Color(0.38f, 0.4f, 0.44f);
        private static readonly Color Red = new Color(0.85f, 0.22f, 0.2f);
        private static readonly Color PanelColor = new Color(0.06f, 0.08f, 0.14f, 0.82f);
        private static readonly Color Dim = new Color(0f, 0f, 0f, 0.55f);

        private readonly Dictionary<int, Texture2D> textures = new Dictionary<int, Texture2D>();
        private readonly Dictionary<long, GUIStyle> styles = new Dictionary<long, GUIStyle>();
        private readonly List<LiveStanding> standings = new List<LiveStanding>();
        private RunnerGame game;
        private GUIStyle fieldStyle;
        private float width;
        private float height;
        private float scale;
        private Rect safe;
        private string nameField;
        private string urlField;
        private string codeField = "";

        private void Awake() => game = GetComponent<RunnerGame>();

        private void OnGUI()
        {
            if (!game || game.Profile == null) return;
            scale = Mathf.Min(Screen.width, Screen.height) / ReferenceShortSide;
            GUI.matrix = Matrix4x4.Scale(new Vector3(scale, scale, 1f));
            width = Screen.width / scale;
            height = Screen.height / scale;
            var area = Screen.safeArea;
            safe = new Rect(area.x / scale, (Screen.height - area.yMax) / scale, area.width / scale, area.height / scale);

            switch (game.CurrentScreen)
            {
                case RunnerScreen.MainMenu: DrawMainMenu(); break;
                case RunnerScreen.Upgrades: DrawUpgrades(); break;
                case RunnerScreen.Home: DrawHome(); break;
                case RunnerScreen.Missions: DrawMissions(); break;
                case RunnerScreen.OnlineSetup: DrawOnlineSetup(); break;
                case RunnerScreen.Connecting: DrawConnecting(); break;
                case RunnerScreen.Lobby: DrawLobby(); break;
                case RunnerScreen.Countdown: DrawPlayingHud(); DrawCountdown(); break;
                case RunnerScreen.Playing: DrawPlayingHud(); break;
                case RunnerScreen.Paused: DrawPlayingHud(); DrawPaused(); break;
                case RunnerScreen.Revive: DrawPlayingHud(); DrawRevive(); break;
                case RunnerScreen.GameOver: DrawGameOver(); break;
                case RunnerScreen.RaceWaiting: DrawPlayingHud(); DrawRaceWaiting(); break;
                case RunnerScreen.RaceResults: DrawRaceResults(); break;
            }
            DrawToasts();
        }

        // ------------------------------------------------------------------ Menus

        private void DrawMainMenu()
        {
            DrawCurrencyBar();
            float top = safe.y + Mathf.Max(120f, height * 0.1f);
            Label(new Rect(0f, top, width, 110f), "TITAN EARTHFALL", 92, GoldColor, TextAnchor.MiddleCenter, true);
            Label(new Rect(0f, top + 100f, width, 50f), "RUN  -  RACE  -  REBUILD", 34, Color.white);

            float bw = Mathf.Min(580f, width - 80f), bh = 98f, gap = 20f;
            float y = Mathf.Max(top + 190f, height * 0.42f);
            if (Button(Centered(bw, bh, y), "PLAY", Green, 50)) game.StartEndless();
            y += bh + gap;
            if (Button(Centered(bw, bh, y), "RACE VS BOTS", Orange, 42)) game.StartOfflineRace();
            y += bh + gap;
            if (Button(Centered(bw, bh, y), "ONLINE RACE", Blue, 42)) game.OpenScreen(RunnerScreen.OnlineSetup);
            y += bh + gap;
            float third = (bw - 2f * 16f) / 3f;
            float x = (width - bw) * 0.5f;
            if (Button(new Rect(x, y, third, 80f), "UPGRADES", Purple, 28)) game.OpenScreen(RunnerScreen.Upgrades);
            if (Button(new Rect(x + third + 16f, y, third, 80f), "HOME", Teal, 28)) game.OpenScreen(RunnerScreen.Home);
            if (Button(new Rect(x + 2f * (third + 16f), y, third, 80f), "MISSIONS", Pink, 28)) game.OpenScreen(RunnerScreen.Missions);

            float bottom = safe.yMax - 70f;
            var p = game.Profile;
            Label(new Rect(0f, bottom - 50f, width, 44f),
                $"Best {p.BestScore:N0}   |   Score multiplier x{game.ScoreMultiplier}   |   Races won {p.RaceWins}", 28, Color.white);
            Label(new Rect(0f, bottom, width, 40f), "Swipe, or use Arrows / WASD + Space", 24, new Color(1f, 1f, 1f, 0.75f));
            if (Button(new Rect(safe.xMax - 150f, bottom - 10f, 130f, 60f), game.Muted ? "SOUND OFF" : "SOUND ON", Grey, 20)) game.ToggleMute();
        }

        private void DrawUpgrades()
        {
            DrawCurrencyBar();
            float rowWidth = Mathf.Min(1040f, width - 60f);
            float y = Header("POWER-UP UPGRADES", "Spend gold to make power-ups last longer.");
            float rowHeight = Mathf.Min(132f, (safe.yMax - y - 140f) / RunnerConfig.PowerUpCount);
            for (int i = 0; i < RunnerConfig.PowerUpCount; i++)
            {
                var kind = (PowerUpKind)i;
                int level = game.Profile.PowerUpLevels[i];
                int cost = PowerUpUpgrades.CostForNextLevel(level);
                var row = Centered(rowWidth, rowHeight - 12f, y);
                Panel(row, PanelColor);
                Label(new Rect(row.x + 24f, row.y + 6f, row.width - 320f, 44f), RunnerGame.PowerUpName(kind), 34, Color.white, TextAnchor.MiddleLeft, true);
                float now = game.Config.PowerUpDuration(kind, level);
                string duration = cost < 0 ? $"{now:0.#}s (max)" : $"{now:0.#}s  >  {game.Config.PowerUpDuration(kind, level + 1):0.#}s";
                Label(new Rect(row.x + 24f, row.y + 48f, row.width - 320f, 34f), RunnerGame.PowerUpDescription(kind) + "   " + duration, 22, new Color(1f, 1f, 1f, 0.8f), TextAnchor.MiddleLeft);
                for (int pip = 0; pip < PowerUpUpgrades.MaxLevel; pip++)
                    Panel(new Rect(row.x + 24f + pip * 40f, row.yMax - 30f, 32f, 14f), pip < level ? GoldColor : new Color(1f, 1f, 1f, 0.2f));
                string label = cost < 0 ? "MAXED" : $"{cost:N0} GOLD";
                if (Button(new Rect(row.xMax - 280f, row.y + (row.height - 70f) * 0.5f, 260f, 70f), label, cost < 0 ? Grey : Green, 28,
                        cost >= 0 && game.Economy.Gold >= cost))
                    game.UpgradePowerUp(kind);
                y += rowHeight;
            }
            BackButton();
        }

        private void DrawHome()
        {
            DrawCurrencyBar();
            float rowWidth = Mathf.Min(1040f, width - 60f);
            float y = Header("HOME", $"Rebuild your village with gems. Every building adds +1 score multiplier (now +{game.HomeBonus}).");
            var home = game.Home;
            foreach (var track in home.Tracks)
            {
                if (track == null || track.tiers == null) continue;
                int tier = home.GetTier(track.id);
                bool maxed = tier >= track.tiers.Length;
                var row = Centered(rowWidth, 150f, y);
                Panel(row, PanelColor);
                string title = track.id.Length > 0 ? char.ToUpperInvariant(track.id[0]) + track.id.Substring(1) : track.id;
                Label(new Rect(row.x + 24f, row.y + 8f, row.width - 320f, 44f), $"{title}  ({tier}/{track.tiers.Length})", 34, Color.white, TextAnchor.MiddleLeft, true);
                string next = maxed ? "Fully built. The village is proud of you!" : $"Next: {track.tiers[tier].displayName} - {track.tiers[tier].description}";
                Label(new Rect(row.x + 24f, row.y + 54f, row.width - 320f, 80f), next, 22, new Color(1f, 1f, 1f, 0.8f), TextAnchor.UpperLeft);
                for (int pip = 0; pip < track.tiers.Length; pip++)
                    Panel(new Rect(row.x + 24f + pip * 40f, row.yMax - 26f, 32f, 14f), pip < tier ? new Color(0.3f, 0.95f, 1f) : new Color(1f, 1f, 1f, 0.2f));
                int cost = maxed ? -1 : track.tiers[tier].gemCost;
                if (Button(new Rect(row.xMax - 280f, row.y + 40f, 260f, 70f), maxed ? "BUILT" : $"BUILD ({cost} GEMS)", maxed ? Grey : Teal, 26,
                        !maxed && game.Economy.Gems >= cost))
                    game.UpgradeHome(track.id);
                y += 166f;
            }
            BackButton();
        }

        private void DrawMissions()
        {
            DrawCurrencyBar();
            float rowWidth = Mathf.Min(1000f, width - 60f);
            float y = Header("MISSIONS", $"Complete all three to raise your multiplier to x{game.ScoreMultiplier + 1} and earn a Credit.");
            foreach (var mission in game.Missions.Active)
            {
                var row = Centered(rowWidth, 120f, y);
                Panel(row, PanelColor);
                Label(new Rect(row.x + 24f, row.y + 10f, row.width - 48f, 50f), (mission.Completed ? "DONE  " : "") + MissionTracker.Describe(mission), 32,
                    mission.Completed ? new Color(0.5f, 1f, 0.5f) : Color.white, TextAnchor.MiddleLeft, true);
                Bar(new Rect(row.x + 24f, row.y + 72f, row.width - 220f, 26f), mission.Target > 0 ? mission.Progress / (float)mission.Target : 0f, mission.Completed ? Green : GoldColor);
                Label(new Rect(row.xMax - 190f, row.y + 64f, 170f, 40f), $"{mission.Progress}/{mission.Target}", 28, Color.white, TextAnchor.MiddleRight);
                y += 136f;
            }
            Label(new Rect(0f, y + 10f, width, 40f), $"Mission level {game.Profile.MissionSet + 1}", 26, new Color(1f, 1f, 1f, 0.7f));
            BackButton();
        }

        private void DrawOnlineSetup()
        {
            if (nameField == null) nameField = game.Profile.PlayerName;
            if (urlField == null) urlField = game.Profile.ServerUrl;
            float panelWidth = Mathf.Min(900f, width - 60f);
            float y = Header("ONLINE RACE", "Race up to 3 other runners on the same track. Empty seats are filled with bots.");
            float x = (width - panelWidth) * 0.5f;

            Label(new Rect(x, y, panelWidth, 40f), "Your name", 26, Color.white, TextAnchor.MiddleLeft);
            nameField = GUI.TextField(new Rect(x, y + 42f, panelWidth, 70f), nameField ?? "", RaceProtocol.MaxNameLength, FieldStyle());
            y += 130f;
            Label(new Rect(x, y, panelWidth, 40f), "Server address", 26, Color.white, TextAnchor.MiddleLeft);
            urlField = GUI.TextField(new Rect(x, y + 42f, panelWidth, 70f), urlField ?? "", 200, FieldStyle());
            y += 130f;
            Label(new Rect(x, y, panelWidth, 40f), "Room code (to join friends)", 26, Color.white, TextAnchor.MiddleLeft);
            codeField = GUI.TextField(new Rect(x, y + 42f, panelWidth * 0.45f, 70f), codeField ?? "", 8, FieldStyle()).ToUpperInvariant();
            if (Button(new Rect(x + panelWidth * 0.48f, y + 42f, panelWidth * 0.52f, 70f), "JOIN ROOM", Purple, 30, codeField.Trim().Length > 0))
                game.StartOnline(urlField, nameField, codeField, false);
            y += 140f;

            float half = (panelWidth - 20f) * 0.5f;
            if (Button(new Rect(x, y, half, 90f), "QUICK MATCH", Green, 34)) game.StartOnline(urlField, nameField, "", false);
            if (Button(new Rect(x + half + 20f, y, half, 90f), "CREATE ROOM", Blue, 34)) game.StartOnline(urlField, nameField, "", true);
            y += 110f;

            if (!string.IsNullOrEmpty(game.StatusMessage))
            {
                Label(new Rect(x, y, panelWidth, 70f), game.StatusMessage, 24, new Color(1f, 0.5f, 0.45f));
                y += 70f;
            }
            Label(new Rect(x, y, panelWidth, 90f),
                "Host a server with:  dotnet run --project Server/TitanEarthfall.Server\nAndroid emulator: ws://10.0.2.2:5080/race   |   Same Wi-Fi: ws://<PC-IP>:5080/race",
                20, new Color(1f, 1f, 1f, 0.65f));
            BackButton();
        }

        private void DrawConnecting()
        {
            FullDim();
            string dots = new string('.', 1 + (int)(Time.time * 3f) % 3);
            Label(new Rect(0f, height * 0.4f, width, 80f), (game.IsOfflineMode ? "Starting race" : "Connecting") + dots, 52, Color.white, TextAnchor.MiddleCenter, true);
            if (Button(Centered(320f, 80f, height * 0.4f + 120f), "CANCEL", Grey, 30)) game.LeaveRace();
        }

        private void DrawLobby()
        {
            FullDim();
            var room = game.Room;
            float panelWidth = Mathf.Min(860f, width - 60f);
            float y = safe.y + 70f;
            Label(new Rect(0f, y, width, 60f), room != null && room.IsPrivate ? "PRIVATE ROOM" : "QUICK MATCH", 34, new Color(1f, 1f, 1f, 0.8f));
            Label(new Rect(0f, y + 50f, width, 110f), game.RoomCode ?? "----", 96, GoldColor, TextAnchor.MiddleCenter, true);
            Label(new Rect(0f, y + 160f, width, 40f), room != null && room.IsPrivate ? "Share this code with friends so they can join." : "Waiting for runners to join...", 26, Color.white);
            y += 230f;

            if (room != null)
            {
                foreach (var info in room.Players)
                {
                    var row = Centered(panelWidth, 76f, y);
                    Panel(row, info.Id == game.LocalPlayerId ? new Color(0.25f, 0.2f, 0.05f, 0.9f) : PanelColor);
                    string suffix = info.Id == game.LocalPlayerId ? "  (you)" : info.IsBot ? "  (bot)" : "";
                    Label(new Rect(row.x + 24f, row.y, row.width * 0.6f, row.height), info.Name + suffix, 32, Color.white, TextAnchor.MiddleLeft, true);
                    Label(new Rect(row.x, row.y, row.width - 24f, row.height), info.Ready ? "READY" : "NOT READY", 28,
                        info.Ready ? new Color(0.4f, 1f, 0.45f) : new Color(1f, 0.7f, 0.4f), TextAnchor.MiddleRight, true);
                    y += 88f;
                }
            }

            if (game.LobbyAutoStart >= 0f)
                Label(new Rect(0f, y + 4f, width, 44f), $"Race starts in {Mathf.CeilToInt(game.LobbyAutoStart)}s - empty seats get bots", 28, GoldColor);
            y += 60f;
            float half = (panelWidth - 20f) * 0.5f;
            float x = (width - panelWidth) * 0.5f;
            if (Button(new Rect(x, y, half, 90f), game.LocalReady ? "READY!" : "I'M READY", game.LocalReady ? Green : Orange, 36)) game.ToggleReady();
            if (Button(new Rect(x + half + 20f, y, half, 90f), "LEAVE", Grey, 34)) game.LeaveRace();
            if (game.PingMilliseconds >= 0)
                Label(new Rect(0f, y + 100f, width, 36f), $"Ping {game.PingMilliseconds:0} ms", 22, new Color(1f, 1f, 1f, 0.6f));
        }

        // ------------------------------------------------------------------ In-run HUD

        private void DrawPlayingHud()
        {
            var sim = game.Simulation;
            if (sim == null) return;
            float left = safe.x + 24f, top = safe.y + 18f;

            Label(new Rect(left, top, 600f, 76f), sim.Score.ToString("N0"), 64, Color.white, TextAnchor.MiddleLeft, true);
            Panel(new Rect(left, top + 80f, 92f, 46f), Purple);
            Label(new Rect(left, top + 80f, 92f, 46f), "x" + sim.Multiplier, 30, Color.white, TextAnchor.MiddleCenter, true);
            Label(new Rect(left + 108f, top + 80f, 300f, 46f), $"{sim.Distance:0} m", 30, Color.white, TextAnchor.MiddleLeft);

            float right = safe.xMax - 24f;
            Panel(new Rect(right - 250f, top + 14f, 34f, 34f), GoldColor);
            Label(new Rect(right - 205f, top, 205f, 60f), sim.Coins.ToString("N0"), 44, GoldColor, TextAnchor.MiddleLeft, true);
            if (sim.Gems > 0)
            {
                Panel(new Rect(right - 250f, top + 74f, 30f, 30f), new Color(0.3f, 0.95f, 1f));
                Label(new Rect(right - 205f, top + 60f, 205f, 56f), sim.Gems.ToString(), 36, new Color(0.3f, 0.95f, 1f), TextAnchor.MiddleLeft, true);
            }
            if (game.CanPause && Button(new Rect(right - 100f, top + 130f, 100f, 80f), "II", Grey, 36)) game.Pause();

            float barY = safe.yMax - 70f;
            for (int i = RunnerConfig.PowerUpCount - 1; i >= 0; i--)
            {
                var kind = (PowerUpKind)i;
                if (!sim.IsActive(kind)) continue;
                Label(new Rect(left, barY - 36f, 360f, 34f), RunnerGame.PowerUpName(kind), 24, Color.white, TextAnchor.MiddleLeft, true);
                Bar(new Rect(left, barY, 300f, 20f), sim.PowerUpRemaining(kind) / Mathf.Max(0.01f, sim.PowerUpDuration(kind)), new Color(0.75f, 0.55f, 1f));
                barY -= 74f;
            }

            if (sim.IsStumbleWarning && sim.IsAlive && Mathf.Repeat(Time.time * 3f, 1f) < 0.6f)
                Label(new Rect(0f, safe.yMax - 140f, width, 60f), "THE TITAN IS RIGHT BEHIND YOU!", 34, new Color(1f, 0.35f, 0.25f), TextAnchor.MiddleCenter, true);

            if (game.IsRace) DrawRaceHud(sim);
        }

        private void DrawRaceHud(RunnerSimulation sim)
        {
            game.GetLiveStandings(standings);
            float length = Mathf.Max(1f, sim.FinishDistance);
            float barWidth = Mathf.Min(620f, width - 760f);
            if (barWidth < 300f) barWidth = Mathf.Min(620f, width - 80f);
            bool stacked = barWidth > width - 700f;
            var bar = new Rect((width - barWidth) * 0.5f, safe.y + (stacked ? 220f : 34f), barWidth, 16f);
            Panel(bar, new Color(1f, 1f, 1f, 0.25f));
            Panel(new Rect(bar.xMax - 6f, bar.y - 14f, 12f, 44f), Color.white);
            foreach (var s in standings)
            {
                float x = bar.x + Mathf.Clamp01(s.Distance / length) * bar.width;
                float size = s.IsLocal ? 34f : 24f;
                Panel(new Rect(x - size * 0.5f, bar.center.y - size * 0.5f, size, size), s.Color);
            }

            float y = bar.yMax + 24f;
            float listX = stacked ? safe.x + 24f : bar.x;
            for (int i = 0; i < standings.Count; i++)
            {
                var s = standings[i];
                string status = s.Finished ? FormatTime(s.FinishTime) : !s.Alive ? "OUT" : $"{s.Distance:0} m";
                var row = new Rect(listX, y, 330f, 40f);
                Panel(row, s.IsLocal ? new Color(0.3f, 0.2f, 0.05f, 0.75f) : new Color(0f, 0f, 0f, 0.45f));
                Panel(new Rect(row.x, row.y, 8f, row.height), s.Color);
                Label(new Rect(row.x + 16f, row.y, 200f, row.height), $"{i + 1}. {s.Name}", 24, Color.white, TextAnchor.MiddleLeft, s.IsLocal);
                Label(new Rect(row.x, row.y, row.width - 12f, row.height), status, 22, Color.white, TextAnchor.MiddleRight);
                y += 46f;
            }

            var cam = game.MainCamera;
            if (!cam) return;
            foreach (var remote in game.Remotes.Values)
            {
                if (!remote.HasState || !remote.Avatar || !remote.Avatar.gameObject.activeSelf) continue;
                var world = remote.Avatar.transform.position + Vector3.up * 2.4f;
                var screen = cam.WorldToScreenPoint(world);
                if (screen.z <= 0f || screen.z > 70f) continue;
                var point = new Vector2(screen.x / scale, (Screen.height - screen.y) / scale);
                Label(new Rect(point.x - 120f, point.y - 20f, 240f, 40f), remote.Info.Name, 24, remote.Color, TextAnchor.MiddleCenter, true);
            }
        }

        private void DrawCountdown()
        {
            int value = Mathf.CeilToInt(game.CountdownRemaining);
            float pulse = 1f + (game.CountdownRemaining - Mathf.Floor(game.CountdownRemaining)) * 0.4f;
            Label(new Rect(0f, height * 0.3f, width, 240f), value > 0 ? value.ToString() : "GO!", Mathf.RoundToInt(180 * pulse), GoldColor, TextAnchor.MiddleCenter, true);
            Label(new Rect(0f, height * 0.3f + 230f, width, 50f), $"First to {game.Simulation.FinishDistance:0} m wins!", 34, Color.white);
        }

        private void DrawPaused()
        {
            FullDim();
            Label(new Rect(0f, height * 0.28f, width, 100f), "PAUSED", 80, Color.white, TextAnchor.MiddleCenter, true);
            if (Button(Centered(460f, 96f, height * 0.28f + 140f), "RESUME", Green, 40)) game.Resume();
            if (Button(Centered(460f, 96f, height * 0.28f + 256f), "QUIT TO MENU", Grey, 34)) game.QuitToMenu();
        }

        private void DrawRevive()
        {
            FullDim();
            var panel = Centered(Mathf.Min(720f, width - 60f), 470f, height * 0.25f);
            Panel(panel, PanelColor);
            bool caught = game.Simulation.DeathCause == DeathCause.Caught;
            Label(new Rect(panel.x, panel.y + 24f, panel.width, 80f), caught ? "CAUGHT!" : "CRASH!", 70, Red, TextAnchor.MiddleCenter, true);
            Label(new Rect(panel.x, panel.y + 110f, panel.width, 50f), "Keep running for 1 Credit?", 34, Color.white);
            Label(new Rect(panel.x, panel.y + 160f, panel.width, 40f), $"You have {game.Economy.Credits} Credits", 26, new Color(1f, 1f, 1f, 0.75f));
            Bar(new Rect(panel.x + 60f, panel.y + 220f, panel.width - 120f, 22f), game.ReviveRemaining / game.ReviveDuration, Orange);
            if (Button(new Rect(panel.x + 60f, panel.y + 270f, panel.width - 120f, 90f), "REVIVE  (1 CREDIT)", Green, 36)) game.AcceptRevive();
            if (Button(new Rect(panel.x + 60f, panel.y + 374f, panel.width - 120f, 70f), "NO THANKS", Grey, 28)) game.DeclineRevive();
        }

        private void DrawGameOver()
        {
            FullDim();
            DrawCurrencyBar();
            var e = game.LastEarnings;
            var sim = game.Simulation;
            var panel = Centered(Mathf.Min(760f, width - 60f), 640f, Mathf.Max(safe.y + 120f, height * 0.18f));
            Panel(panel, PanelColor);
            string title = e != null && e.Finished ? "FINISHED!" : sim != null && sim.DeathCause == DeathCause.Caught ? "CAUGHT BY THE TITAN!" : "GAME OVER";
            Label(new Rect(panel.x, panel.y + 20f, panel.width, 70f), title, 52, Red, TextAnchor.MiddleCenter, true);
            if (e != null)
            {
                Label(new Rect(panel.x, panel.y + 100f, panel.width, 100f), e.Score.ToString("N0"), 88, Color.white, TextAnchor.MiddleCenter, true);
                if (e.NewBest) Label(new Rect(panel.x, panel.y + 196f, panel.width, 40f), "NEW BEST SCORE!", 30, GoldColor, TextAnchor.MiddleCenter, true);
                float y = panel.y + 250f;
                Line(panel, ref y, "Distance", $"{e.Distance:N0} m");
                Line(panel, ref y, "Gold earned", $"+{e.Gold:N0}");
                if (e.Gems > 0) Line(panel, ref y, "Gems", $"+{e.Gems}");
                if (e.Credits > 0) Line(panel, ref y, "Credits", $"+{e.Credits}");
                if (e.Troca > 0) Line(panel, ref y, "Troca", $"+{e.Troca}");
                if (e.MultiplierRaised) Line(panel, ref y, "Missions complete!", $"x{game.ScoreMultiplier}");
            }
            float bw = (panel.width - 140f) * 0.5f;
            if (Button(new Rect(panel.x + 50f, panel.yMax - 120f, bw, 90f), "RUN AGAIN", Green, 34)) game.StartEndless();
            if (Button(new Rect(panel.x + 90f + bw, panel.yMax - 120f, bw, 90f), "MENU", Grey, 34)) game.QuitToMenu();
        }

        private void DrawRaceWaiting()
        {
            var sim = game.Simulation;
            var panel = Centered(Mathf.Min(760f, width - 60f), 220f, safe.yMax - 280f);
            Panel(panel, PanelColor);
            string title = sim.IsFinished ? $"FINISHED IN {FormatTime(sim.FinishTime)}!" : "OUT OF THE RACE";
            Label(new Rect(panel.x, panel.y + 18f, panel.width, 60f), title, 44, sim.IsFinished ? GoldColor : Red, TextAnchor.MiddleCenter, true);
            Label(new Rect(panel.x, panel.y + 80f, panel.width, 40f), "Waiting for the other runners...", 28, Color.white);
            if (Button(new Rect(panel.x + 140f, panel.y + 134f, panel.width - 280f, 70f), "LEAVE RACE", Grey, 28)) game.QuitToMenu();
        }

        private void DrawRaceResults()
        {
            FullDim();
            DrawCurrencyBar();
            var result = game.RaceResult;
            var panel = Centered(Mathf.Min(900f, width - 60f), 700f, Mathf.Max(safe.y + 110f, height * 0.14f));
            Panel(panel, PanelColor);
            int place = game.LastEarnings != null ? game.LastEarnings.Place : 0;
            string title = place == 1 ? "YOU WIN!" : place > 0 ? $"YOU PLACED {Ordinal(place)}" : "RACE OVER";
            Label(new Rect(panel.x, panel.y + 20f, panel.width, 80f), title, 60, place == 1 ? GoldColor : Color.white, TextAnchor.MiddleCenter, true);

            float y = panel.y + 120f;
            if (result != null)
            {
                foreach (var s in result.Standings)
                {
                    var row = new Rect(panel.x + 40f, y, panel.width - 80f, 66f);
                    bool me = s.Id == game.LocalPlayerId;
                    Panel(row, me ? new Color(0.35f, 0.25f, 0.05f, 0.9f) : new Color(1f, 1f, 1f, 0.07f));
                    Label(new Rect(row.x + 20f, row.y, 80f, row.height), Ordinal(s.Place), 30, s.Place == 1 ? GoldColor : Color.white, TextAnchor.MiddleLeft, true);
                    Label(new Rect(row.x + 110f, row.y, row.width * 0.45f, row.height), s.Name + (s.IsBot ? " (bot)" : me ? " (you)" : ""), 28, Color.white, TextAnchor.MiddleLeft, me);
                    string status = s.Finished ? FormatTime(s.FinishTime) : $"DNF  {s.Distance:0} m";
                    Label(new Rect(row.x, row.y, row.width - 20f, row.height), status, 28, s.Finished ? new Color(0.5f, 1f, 0.5f) : new Color(1f, 0.6f, 0.5f), TextAnchor.MiddleRight);
                    y += 76f;
                }
            }
            var e = game.LastEarnings;
            if (e != null)
                Label(new Rect(panel.x, y + 10f, panel.width, 44f), $"+{e.Gold:N0} gold" + (e.Gems > 0 ? $"   +{e.Gems} gems" : "") + (place > 0 && place <= 3 ? "   (podium bonus included)" : ""), 28, GoldColor);
            float bw = (panel.width - 140f) * 0.5f;
            if (Button(new Rect(panel.x + 50f, panel.yMax - 120f, bw, 90f), "RACE AGAIN", Orange, 34)) game.RaceAgain();
            if (Button(new Rect(panel.x + 90f + bw, panel.yMax - 120f, bw, 90f), "MENU", Grey, 34)) game.QuitToMenu();
        }

        // ------------------------------------------------------------------ Widgets

        private void DrawCurrencyBar()
        {
            var economy = game.Economy;
            if (!economy) return;
            string[] labels = { $"GOLD {economy.Gold:N0}", $"GEMS {economy.Gems:N0}", $"CREDITS {economy.Credits:N0}", $"TROCA {economy.Troca:N0}" };
            Color[] colors = { GoldColor, new Color(0.3f, 0.95f, 1f), new Color(0.5f, 1f, 0.55f), new Color(1f, 0.6f, 0.9f) };
            float pill = Mathf.Min(250f, (safe.width - 40f - 3f * 12f) / 4f);
            float x = safe.xMax - 20f - 4f * pill - 3f * 12f;
            for (int i = 0; i < labels.Length; i++)
            {
                var r = new Rect(x + i * (pill + 12f), safe.y + 16f, pill, 52f);
                Panel(r, new Color(0f, 0f, 0f, 0.55f));
                Panel(new Rect(r.x, r.y, 8f, r.height), colors[i]);
                Label(r, labels[i], 24, colors[i], TextAnchor.MiddleCenter, true);
            }
        }

        private float Header(string title, string subtitle)
        {
            FullDim();
            float y = safe.y + 100f;
            Label(new Rect(0f, y, width, 80f), title, 64, GoldColor, TextAnchor.MiddleCenter, true);
            Label(new Rect(40f, y + 78f, width - 80f, 70f), subtitle, 26, Color.white);
            return y + 160f;
        }

        private void BackButton()
        {
            if (Button(new Rect(safe.x + 24f, safe.yMax - 104f, 220f, 80f), "BACK", Grey, 32)) game.OpenScreen(RunnerScreen.MainMenu);
        }

        private void Line(Rect panel, ref float y, string label, string value)
        {
            Label(new Rect(panel.x + 70f, y, panel.width - 140f, 44f), label, 30, new Color(1f, 1f, 1f, 0.85f), TextAnchor.MiddleLeft);
            Label(new Rect(panel.x + 70f, y, panel.width - 140f, 44f), value, 30, Color.white, TextAnchor.MiddleRight, true);
            y += 48f;
        }

        private void DrawToasts()
        {
            var list = game.Toasts;
            float y = safe.y + (game.CurrentScreen == RunnerScreen.Playing && game.IsRace ? 380f : 170f);
            for (int i = list.Count - 1; i >= 0; i--)
            {
                var toast = list[i];
                float alpha = Mathf.Clamp01(toast.Remaining / 0.4f);
                var color = new Color(toast.Color.r, toast.Color.g, toast.Color.b, alpha);
                var rect = Centered(Mathf.Min(900f, width - 40f), 54f, y);
                Panel(rect, new Color(0f, 0f, 0f, 0.5f * alpha));
                Label(rect, toast.Text, 28, color, TextAnchor.MiddleCenter, true, false);
                y += 62f;
            }
        }

        private bool Button(Rect rect, string text, Color color, int fontSize = 32, bool enabled = true)
        {
            var baseColor = enabled ? color : Color.Lerp(color, Grey, 0.7f);
            bool hover = enabled && rect.Contains(Event.current.mousePosition);
            Panel(rect, hover ? Color.Lerp(baseColor, Color.white, 0.15f) : baseColor);
            Panel(new Rect(rect.x, rect.yMax - 6f, rect.width, 6f), Color.Lerp(baseColor, Color.black, 0.35f));
            Label(rect, text, fontSize, enabled ? Color.white : new Color(1f, 1f, 1f, 0.55f), TextAnchor.MiddleCenter, true);
            bool clicked = GUI.Button(rect, GUIContent.none, GUIStyle.none) && enabled;
            if (clicked) game.PlayClick();
            return clicked;
        }

        private void Bar(Rect rect, float fraction, Color color)
        {
            Panel(rect, new Color(1f, 1f, 1f, 0.18f));
            Panel(new Rect(rect.x, rect.y, rect.width * Mathf.Clamp01(fraction), rect.height), color);
        }

        private void FullDim() => Panel(new Rect(0f, 0f, width, height), Dim);

        private Rect Centered(float w, float h, float y) => new Rect((width - w) * 0.5f, y, w, h);

        private void Panel(Rect rect, Color color)
        {
            var previous = GUI.color;
            GUI.color = color;
            GUI.DrawTexture(rect, WhiteTexture());
            GUI.color = previous;
        }

        private void Label(Rect rect, string text, int size, Color color, TextAnchor anchor = TextAnchor.MiddleCenter, bool bold = false, bool shadow = true)
        {
            if (shadow)
                GUI.Label(new Rect(rect.x + 2f, rect.y + 3f, rect.width, rect.height), text, Style(size, new Color(0f, 0f, 0f, 0.55f * color.a), anchor, bold));
            GUI.Label(rect, text, Style(size, color, anchor, bold));
        }

        private GUIStyle Style(int size, Color color, TextAnchor anchor, bool bold)
        {
            Color32 c = color;
            long key = ((long)size << 40) ^ ((long)(uint)((c.r << 24) | (c.g << 16) | (c.b << 8) | c.a) << 6) ^ ((long)anchor << 1) ^ (bold ? 1L : 0L);
            if (styles.TryGetValue(key, out var style)) return style;
            style = new GUIStyle(GUI.skin.label)
            {
                fontSize = size,
                alignment = anchor,
                fontStyle = bold ? FontStyle.Bold : FontStyle.Normal,
                wordWrap = true,
                clipping = TextClipping.Overflow
            };
            style.normal.textColor = color;
            styles[key] = style;
            return style;
        }

        private GUIStyle FieldStyle()
        {
            if (fieldStyle != null) return fieldStyle;
            fieldStyle = new GUIStyle(GUI.skin.textField)
            {
                fontSize = 32,
                alignment = TextAnchor.MiddleLeft,
                padding = new RectOffset(18, 18, 8, 8)
            };
            var background = SolidTexture(new Color(1f, 1f, 1f, 0.92f));
            fieldStyle.normal.background = background;
            fieldStyle.focused.background = background;
            fieldStyle.hover.background = background;
            fieldStyle.normal.textColor = fieldStyle.focused.textColor = fieldStyle.hover.textColor = new Color(0.08f, 0.1f, 0.16f);
            return fieldStyle;
        }

        private Texture2D WhiteTexture() => SolidTexture(Color.white);

        private Texture2D SolidTexture(Color color)
        {
            Color32 c = color;
            int key = (c.r << 24) | (c.g << 16) | (c.b << 8) | c.a;
            if (textures.TryGetValue(key, out var texture) && texture) return texture;
            texture = new Texture2D(1, 1, TextureFormat.RGBA32, false) { hideFlags = HideFlags.DontSave };
            texture.SetPixel(0, 0, color);
            texture.Apply();
            textures[key] = texture;
            return texture;
        }

        private static string FormatTime(float seconds) => $"{(int)(seconds / 60f)}:{seconds % 60f:00.0}";

        private static string Ordinal(int place)
        {
            switch (place)
            {
                case 1: return "1st";
                case 2: return "2nd";
                case 3: return "3rd";
                default: return place + "th";
            }
        }
    }
}
