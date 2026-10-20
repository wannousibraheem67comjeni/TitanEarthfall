using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using TitanEarthfall.Runner.Net;

namespace TitanEarthfall.Runner.Tests
{
    public sealed class RaceNetworkTests
    {
        private static T RoundTrip<T>(T message) where T : IRaceMessage
        {
            var bytes = RaceProtocol.Encode(message);
            return (T)RaceProtocol.Decode(bytes, bytes.Length);
        }

        private static RunnerNetState SampleState() => new RunnerNetState
        {
            Distance = 123.5f,
            X = -2.5f,
            Y = 3f,
            Pose = RunnerPose.Jumping,
            PowerUps = 0b10101,
            Score = 4567,
            Coins = 89,
            Alive = true,
            Finished = false,
            FinishTime = 0f
        };

        [Test]
        public void Protocol_RoundTripsEveryMessage()
        {
            var hello = RoundTrip(new HelloMessage { Name = "Ibra" });
            Assert.AreEqual("Ibra", hello.Name);
            Assert.AreEqual(RaceProtocol.Version, hello.ProtocolVersion);

            var welcome = RoundTrip(new WelcomeMessage { PlayerId = 3, RoomCode = "ABCD" });
            Assert.AreEqual(3, welcome.PlayerId);
            Assert.AreEqual("ABCD", welcome.RoomCode);

            var join = RoundTrip(new JoinRoomMessage { RoomCode = "WXYZ", CreatePrivate = true, FillWithBots = false });
            Assert.AreEqual("WXYZ", join.RoomCode);
            Assert.IsTrue(join.CreatePrivate);
            Assert.IsFalse(join.FillWithBots);

            var room = new RoomStateMessage { RoomCode = "QQQQ", Phase = RoomPhase.Lobby, IsPrivate = true, AutoStartIn = 4.5f };
            room.Players.Add(new RacePlayerInfo { Id = 1, Name = "A", Ready = true, Connected = true });
            room.Players.Add(new RacePlayerInfo { Id = 2, Name = "Bot", IsBot = true, Connected = true });
            var roomBack = RoundTrip(room);
            Assert.AreEqual(2, roomBack.Players.Count);
            Assert.IsTrue(roomBack.Players[0].Ready);
            Assert.IsTrue(roomBack.Players[1].IsBot);
            Assert.AreEqual(4.5f, roomBack.AutoStartIn);

            Assert.IsFalse(RoundTrip(new ReadyMessage { Ready = false }).Ready);

            var start = new RaceStartMessage { Seed = -55, RaceLength = 1500f, Countdown = 3f };
            start.Players.Add(new RacePlayerInfo { Id = 9, Name = "Z" });
            var startBack = RoundTrip(start);
            Assert.AreEqual(-55, startBack.Seed);
            Assert.AreEqual(1500f, startBack.RaceLength);
            Assert.AreEqual(9, startBack.Players[0].Id);

            var snapshot = RoundTrip(new SnapshotMessage { RaceTime = 12.25f, State = SampleState() });
            Assert.AreEqual(12.25f, snapshot.RaceTime);
            Assert.AreEqual(SampleState(), snapshot.State);

            var world = new WorldStateMessage { RaceTime = 3f };
            world.Players.Add(new PlayerNetEntry { Id = 4, State = SampleState() });
            var worldBack = RoundTrip(world);
            Assert.AreEqual(4, worldBack.Players[0].Id);
            Assert.AreEqual(SampleState(), worldBack.Players[0].State);

            Assert.AreEqual(SampleState(), RoundTrip(new FinishedMessage { State = SampleState() }).State);

            var result = new RaceResultMessage();
            result.Standings.Add(new RaceStanding { Id = 2, Name = "Win", Place = 1, Finished = true, FinishTime = 70f, Distance = 1500f, Score = 9, Coins = 3 });
            var resultBack = RoundTrip(result);
            Assert.AreEqual("Win", resultBack.Standings[0].Name);
            Assert.IsTrue(resultBack.Standings[0].Finished);
            Assert.AreEqual(70f, resultBack.Standings[0].FinishTime);

            Assert.AreEqual(RaceMessageType.Leave, RoundTrip(new LeaveMessage()).Type);
            Assert.AreEqual("nope", RoundTrip(new ErrorMessage { Text = "nope" }).Text);
            Assert.AreEqual(1.5, RoundTrip(new PingMessage { ClientTime = 1.5 }).ClientTime);
            Assert.AreEqual(2.5, RoundTrip(new PongMessage { ClientTime = 2.5 }).ClientTime);
        }

        [Test]
        public void Protocol_RejectsGarbage()
        {
            Assert.Throws<InvalidDataException>(() => RaceProtocol.Decode(new byte[] { 200 }, 1));
            Assert.Throws<InvalidDataException>(() => RaceProtocol.Decode(new byte[] { (byte)RaceMessageType.Snapshot, 1, 2 }, 3));
            Assert.Throws<InvalidDataException>(() => RaceProtocol.Decode(new byte[0], 0));
            Assert.Throws<InvalidDataException>(() => RaceProtocol.Decode(new byte[] { (byte)RaceMessageType.WorldState, 0, 0, 0, 0, 200 }, 6));
        }

        [Test]
        public void SanitizeName_LimitsLengthAndControlCharacters()
        {
            Assert.AreEqual("Runner", RaceProtocol.SanitizeName("   "));
            Assert.AreEqual("AB", RaceProtocol.SanitizeName(" A\nB "));
            Assert.AreEqual(RaceProtocol.MaxNameLength, RaceProtocol.SanitizeName(new string('x', 100)).Length);
        }

        private static RaceRoomSettings FastSettings() => new RaceRoomSettings
        {
            CountdownSeconds = 0.5f,
            RaceLength = 400f,
            QuickMatchAutoStartSeconds = 1f,
            ResultsLingerSeconds = 1f
        };

        private static void Tick(RaceRoom room, float seconds)
        {
            for (float t = 0f; t < seconds; t += 0.05f) room.Tick(0.05f);
        }

        [Test]
        public void PrivateRoom_StartsWhenEveryoneReady_AndFillsBots()
        {
            var room = new RaceRoom("TEST", true, 77, new RunnerConfig(), FastSettings());
            byte a = room.AddHuman("Alice");
            byte b = room.AddHuman("Bob");
            Assert.AreNotEqual(0, a);
            Assert.AreNotEqual(a, b);
            room.SetReady(a, true);
            Tick(room, 0.2f);
            Assert.AreEqual(RoomPhase.Lobby, room.Phase, "waits for every human");
            room.SetReady(b, true);
            Tick(room, 0.1f);
            Assert.AreEqual(RoomPhase.Countdown, room.Phase);
            Assert.AreEqual(4, room.Players.Count);
            Assert.AreEqual(0, room.AddHuman("Late"), "no joining after the race starts");

            var outbound = new List<RaceOutbound>();
            room.DrainOutbound(outbound);
            var start = (RaceStartMessage)outbound.Find(o => o.Message is RaceStartMessage).Message;
            Assert.AreEqual(77, start.Seed);
            Assert.AreEqual(4, start.Players.Count);

            Tick(room, 0.6f);
            Assert.AreEqual(RoomPhase.Racing, room.Phase);
        }

        [Test]
        public void QuickMatch_AutoStartsWithBots()
        {
            var room = new RaceRoom("QUIK", false, 1, new RunnerConfig(), FastSettings());
            byte a = room.AddHuman("Solo");
            room.SetReady(a, true);
            Tick(room, 0.5f);
            Assert.AreEqual(RoomPhase.Lobby, room.Phase, "waits a moment for more humans");
            Tick(room, 0.7f);
            Assert.AreEqual(RoomPhase.Countdown, room.Phase);
        }

        [Test]
        public void Race_ProducesStandings_FinishersFirst()
        {
            var config = new RunnerConfig();
            var settings = FastSettings();
            var room = new RaceRoom("RACE", true, 5, config, settings);
            byte human = room.AddHuman("Human");
            room.SetReady(human, true);
            Tick(room, 0.7f);
            Assert.AreEqual(RoomPhase.Racing, room.Phase);

            // Simulate the human legitimately running the course with a perfect bot driving the local sim.
            var sim = new RunnerSimulation(new Track(room.Seed, config), new RunnerModifiers { FinishDistance = settings.RaceLength });
            var pilot = new RunnerBot(1, 1f);
            float snapshotTimer = 0f;
            while (sim.IsAlive && !sim.IsFinished)
            {
                sim.Enqueue(pilot.Decide(sim));
                sim.Step();
                room.Tick(config.FixedDeltaTime);
                snapshotTimer += config.FixedDeltaTime;
                if (snapshotTimer >= 0.1f)
                {
                    snapshotTimer = 0f;
                    room.HandleSnapshot(human, new SnapshotMessage { RaceTime = sim.Time, State = sim.ToNetState() });
                }
            }
            Assert.IsTrue(sim.IsFinished);
            room.HandleFinished(human, new FinishedMessage { State = sim.ToNetState() });
            room.Tick(0.05f);

            Assert.AreEqual(RoomPhase.Results, room.Phase);
            var standings = room.Result.Standings;
            Assert.AreEqual(4, standings.Count);
            for (int i = 0; i < standings.Count; i++) Assert.AreEqual(i + 1, standings[i].Place);
            for (int i = 1; i < standings.Count; i++)
            {
                var prev = standings[i - 1];
                var cur = standings[i];
                if (prev.Finished && cur.Finished) Assert.LessOrEqual(prev.FinishTime, cur.FinishTime);
                else if (!prev.Finished) Assert.IsFalse(cur.Finished, "finishers rank above non-finishers");
                if (!prev.Finished && !cur.Finished) Assert.GreaterOrEqual(prev.Distance, cur.Distance);
            }
            Assert.IsTrue(standings.Exists(s => s.Id == human && s.Finished));

            Tick(room, 1.2f);
            Assert.AreEqual(RoomPhase.Closed, room.Phase);
        }

        [Test]
        public void SpeedHack_IsClampedAndCannotFinish()
        {
            var config = new RunnerConfig();
            var settings = FastSettings();
            var room = new RaceRoom("HACK", true, 5, config, settings);
            byte cheater = room.AddHuman("Cheater");
            room.SetReady(cheater, true);
            Tick(room, 0.7f);
            Tick(room, 1f);

            room.HandleSnapshot(cheater, new SnapshotMessage { State = new RunnerNetState { Distance = 5000f, Alive = true } });
            var player = room.Find(cheater);
            Assert.Less(player.State.Distance, 100f);
            Assert.AreEqual(1, player.Violations);

            room.HandleFinished(cheater, new FinishedMessage
            {
                State = new RunnerNetState { Distance = settings.RaceLength, Finished = true, FinishTime = 1f, Alive = true }
            });
            Assert.IsFalse(player.State.Finished);
            room.Tick(0.05f);
            Assert.AreEqual(RoomPhase.Results, room.Phase);
            Assert.IsFalse(room.Result.Standings.Find(s => s.Id == cheater).Finished);
        }

        [Test]
        public void Disconnect_DuringRace_IsDnf_AndEmptyRoomCloses()
        {
            var room = new RaceRoom("GONE", true, 5, new RunnerConfig(), FastSettings());
            byte a = room.AddHuman("A");
            byte b = room.AddHuman("B");
            room.SetReady(a, true);
            room.SetReady(b, true);
            Tick(room, 0.7f);
            room.RemovePlayer(a);
            Assert.IsTrue(room.Find(a).Done);
            Assert.AreEqual(RoomPhase.Racing, room.Phase);
            room.RemovePlayer(b);
            Assert.AreEqual(RoomPhase.Closed, room.Phase);
        }

        [Test]
        public void Lobby_MatchmakesAndRoutesMessages()
        {
            var lobby = new RaceLobby(new RunnerConfig(), FastSettings(), 3);
            int c1 = lobby.Connect();
            int c2 = lobby.Connect();
            var outbound = new List<LobbyOutbound>();

            lobby.Receive(c1, new JoinRoomMessage());
            lobby.DrainOutbound(outbound);
            Assert.IsInstanceOf<ErrorMessage>(outbound[0].Message, "must say hello first");
            outbound.Clear();

            lobby.Receive(c1, new HelloMessage { Name = "One" });
            lobby.Receive(c1, new JoinRoomMessage { CreatePrivate = true });
            lobby.DrainOutbound(outbound);
            var welcome = (WelcomeMessage)outbound.Find(o => o.ConnectionId == c1 && o.Message is WelcomeMessage).Message;
            Assert.AreEqual(4, welcome.RoomCode.Length);
            Assert.IsTrue(outbound.FindIndex(o => o.Message is WelcomeMessage) < outbound.FindIndex(o => o.Message is RoomStateMessage));
            outbound.Clear();

            lobby.Receive(c2, new HelloMessage { Name = "Two" });
            lobby.Receive(c2, new JoinRoomMessage { RoomCode = welcome.RoomCode.ToLowerInvariant() });
            lobby.DrainOutbound(outbound);
            Assert.IsTrue(outbound.Exists(o => o.ConnectionId == c2 && o.Message is WelcomeMessage));
            var state = (RoomStateMessage)outbound.FindLast(o => o.ConnectionId == c1 && o.Message is RoomStateMessage).Message;
            Assert.AreEqual(2, state.Players.Count, "both players see each other");
            outbound.Clear();

            lobby.Receive(c1, new ReadyMessage());
            lobby.Receive(c2, new ReadyMessage());
            lobby.Tick(0.05f);
            lobby.DrainOutbound(outbound);
            Assert.IsTrue(outbound.Exists(o => o.ConnectionId == c1 && o.Message is RaceStartMessage));
            Assert.IsTrue(outbound.Exists(o => o.ConnectionId == c2 && o.Message is RaceStartMessage));

            lobby.Receive(c1, new PingMessage { ClientTime = 9 });
            outbound.Clear();
            lobby.DrainOutbound(outbound);
            Assert.AreEqual(9.0, ((PongMessage)outbound.Find(o => o.Message is PongMessage).Message).ClientTime);

            lobby.Disconnect(c1);
            lobby.Disconnect(c2);
            lobby.Tick(0.05f);
            Assert.AreEqual(0, lobby.RoomCount);
            Assert.AreEqual(0, lobby.ConnectionCount);
        }

        [Test]
        public void Lobby_RejectsUnknownRoomAndWrongProtocol()
        {
            var lobby = new RaceLobby(new RunnerConfig(), FastSettings(), 3);
            int c = lobby.Connect();
            var outbound = new List<LobbyOutbound>();
            lobby.Receive(c, new HelloMessage { ProtocolVersion = 999 });
            lobby.DrainOutbound(outbound);
            Assert.IsInstanceOf<ErrorMessage>(outbound[0].Message);
            outbound.Clear();

            lobby.Receive(c, new HelloMessage());
            lobby.Receive(c, new JoinRoomMessage { RoomCode = "NOPE" });
            lobby.DrainOutbound(outbound);
            Assert.IsInstanceOf<ErrorMessage>(outbound[0].Message);
        }

        [Test]
        public void LocalConnection_PlaysFullRaceAgainstBots()
        {
            var config = new RunnerConfig();
            var settings = FastSettings();
            using (var connection = new LocalRaceConnection(config, settings, 12))
            {
                connection.Send(new HelloMessage { Name = "Offline" });
                connection.Send(new JoinRoomMessage { CreatePrivate = true });
                byte me = 0;
                RaceStartMessage start = null;
                RaceResultMessage result = null;
                RunnerSimulation sim = null;
                var pilot = new RunnerBot(4, 1f);
                bool sentReady = false, sentFinish = false;
                int worldStates = 0;

                for (int frame = 0; frame < 20000 && result == null; frame++)
                {
                    connection.Update(config.FixedDeltaTime);
                    while (connection.TryReceive(out var message))
                    {
                        switch (message)
                        {
                            case WelcomeMessage welcome: me = welcome.PlayerId; break;
                            case RaceStartMessage s:
                                start = s;
                                sim = new RunnerSimulation(new Track(s.Seed, config), new RunnerModifiers { FinishDistance = s.RaceLength });
                                break;
                            case WorldStateMessage _: worldStates++; break;
                            case RaceResultMessage r: result = r; break;
                        }
                    }
                    if (me != 0 && !sentReady)
                    {
                        connection.Send(new ReadyMessage());
                        sentReady = true;
                    }
                    if (sim != null && worldStates > 0 && !sentFinish)
                    {
                        sim.Enqueue(pilot.Decide(sim));
                        sim.Step();
                        if (frame % 6 == 0) connection.Send(new SnapshotMessage { RaceTime = sim.Time, State = sim.ToNetState() });
                        if (sim.IsFinished || !sim.IsAlive)
                        {
                            connection.Send(new FinishedMessage { State = sim.ToNetState() });
                            sentFinish = true;
                        }
                    }
                }

                Assert.IsNotNull(start);
                Assert.IsNotNull(result, "race must resolve");
                Assert.Greater(worldStates, 10);
                Assert.AreEqual(4, result.Standings.Count);
                Assert.IsTrue(result.Standings.Exists(s => s.Id == me));
            }
        }

        [Test]
        public void Interpolator_SmoothsAndExtrapolates()
        {
            var interp = new SnapshotInterpolator();
            Assert.IsFalse(interp.TrySample(0f, out _));
            interp.Add(1f, new RunnerNetState { Distance = 10f, X = 0f, Alive = true });
            interp.Add(2f, new RunnerNetState { Distance = 30f, X = 2.5f, Alive = true });
            interp.Add(1.5f, new RunnerNetState { Distance = 999f });

            Assert.IsTrue(interp.TrySample(1.5f, out var mid));
            Assert.AreEqual(20f, mid.Distance, 1e-4f);
            Assert.AreEqual(1.25f, mid.X, 1e-4f);

            interp.TrySample(0.5f, out var early);
            Assert.AreEqual(10f, early.Distance, 1e-4f);

            interp.TrySample(2.1f, out var late);
            Assert.AreEqual(32f, late.Distance, 1e-3f);

            interp.TrySample(10f, out var veryLate);
            Assert.AreEqual(30f + 20f * 0.3f, veryLate.Distance, 1e-3f, "extrapolation is capped");

            for (int i = 0; i < 40; i++) interp.Add(3f + i, new RunnerNetState { Distance = 40f + i });
            Assert.AreEqual(16, interp.Count);
            Assert.AreEqual(42f, interp.LatestTime);
        }
    }
}
