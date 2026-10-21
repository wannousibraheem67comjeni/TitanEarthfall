using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using NUnit.Framework;
using TitanEarthfall.Runner;
using TitanEarthfall.Runner.Net;

namespace TitanEarthfall.Server.Tests
{
    /// <summary>End-to-end tests: real Kestrel server, real WebSocket clients, shared protocol.</summary>
    public sealed class RaceServerTests
    {
        private WebApplication app;
        private Uri httpBase;
        private Uri raceUri;

        [SetUp]
        public async Task StartServer()
        {
            var settings = new RaceRoomSettings
            {
                CountdownSeconds = 0.3f,
                RaceLength = 300f,
                QuickMatchAutoStartSeconds = 0.5f,
                ResultsLingerSeconds = 1f
            };
            app = RaceServerApp.Build(new[] { "--urls", "http://127.0.0.1:0" }, settings);
            await app.StartAsync();
            httpBase = new Uri(app.Urls.First());
            raceUri = new UriBuilder(httpBase) { Scheme = "ws", Path = "/race" }.Uri;
        }

        [TearDown]
        public async Task StopServer()
        {
            await app.StopAsync();
            await app.DisposeAsync();
        }

        private static async Task<T> WaitFor<T>(IRaceConnection connection, List<IRaceMessage> log, double seconds = 5) where T : class, IRaceMessage
        {
            var deadline = DateTime.UtcNow.AddSeconds(seconds);
            while (DateTime.UtcNow < deadline)
            {
                var found = log.OfType<T>().FirstOrDefault();
                if (found != null)
                {
                    log.Remove(found);
                    return found;
                }
                while (connection.TryReceive(out var message)) log.Add(message);
                if (log.OfType<T>().Any()) continue;
                Assert.IsNull(connection.LastError, "connection failed");
                await Task.Delay(10);
            }
            Assert.Fail($"Timed out waiting for {typeof(T).Name}.");
            return null;
        }

        [Test]
        public async Task HealthAndPlainHttpEndpoints()
        {
            using (var http = new HttpClient { BaseAddress = httpBase })
            {
                string health = await http.GetStringAsync("/health");
                StringAssert.Contains("\"status\":\"ok\"", health);
                var plain = await http.GetAsync("/race");
                Assert.AreEqual(HttpStatusCode.BadRequest, plain.StatusCode);
            }
        }

        [Test]
        public async Task TwoPlayers_PrivateRoom_FullRaceOverWebSockets()
        {
            using (var alice = WebSocketRaceConnection.Connect(raceUri))
            using (var bob = WebSocketRaceConnection.Connect(raceUri))
            {
                var aliceLog = new List<IRaceMessage>();
                var bobLog = new List<IRaceMessage>();

                alice.Send(new HelloMessage { Name = "Alice" });
                alice.Send(new JoinRoomMessage { CreatePrivate = true });
                var aliceWelcome = await WaitFor<WelcomeMessage>(alice, aliceLog);
                Assert.AreEqual(4, aliceWelcome.RoomCode.Length);

                bob.Send(new HelloMessage { Name = "Bob" });
                bob.Send(new JoinRoomMessage { RoomCode = aliceWelcome.RoomCode });
                var bobWelcome = await WaitFor<WelcomeMessage>(bob, bobLog);
                Assert.AreNotEqual(aliceWelcome.PlayerId, bobWelcome.PlayerId);

                alice.Send(new ReadyMessage());
                bob.Send(new ReadyMessage());
                var aliceStart = await WaitFor<RaceStartMessage>(alice, aliceLog);
                var bobStart = await WaitFor<RaceStartMessage>(bob, bobLog);
                Assert.AreEqual(aliceStart.Seed, bobStart.Seed, "everyone races the same seeded track");
                Assert.AreEqual(4, aliceStart.Players.Count, "empty seats are filled with bots");
                Assert.AreEqual(2, aliceStart.Players.Count(p => p.IsBot));

                // Alice runs for real for a moment and streams snapshots; Bob must see her move.
                var config = new RunnerConfig();
                var sim = new RunnerSimulation(new Track(aliceStart.Seed, config), new RunnerModifiers { FinishDistance = aliceStart.RaceLength });
                var pilot = new RunnerBot(1, 1f);
                await Task.Delay(TimeSpan.FromSeconds(aliceStart.Countdown));
                var clock = System.Diagnostics.Stopwatch.StartNew();
                float simulated = 0f, lastSnapshot = 0f;
                while (clock.Elapsed.TotalSeconds < 1.2)
                {
                    while (simulated < clock.Elapsed.TotalSeconds)
                    {
                        sim.Enqueue(pilot.Decide(sim));
                        sim.Step();
                        simulated += config.FixedDeltaTime;
                    }
                    if (simulated - lastSnapshot >= 0.066f)
                    {
                        lastSnapshot = simulated;
                        alice.Send(new SnapshotMessage { RaceTime = sim.Time, State = sim.ToNetState() });
                    }
                    await Task.Delay(5);
                }

                WorldStateMessage seen = null;
                var deadline = DateTime.UtcNow.AddSeconds(3);
                while (seen == null && DateTime.UtcNow < deadline)
                {
                    var world = await WaitFor<WorldStateMessage>(bob, bobLog);
                    var aliceEntry = world.Players.FirstOrDefault(p => p.Id == aliceWelcome.PlayerId);
                    if (aliceEntry.State.Distance > 5f) seen = world;
                }
                Assert.IsNotNull(seen, "Bob receives Alice's progress");
                Assert.AreEqual(4, seen.Players.Count);

                alice.Send(new FinishedMessage { State = sim.ToNetState() });
                bob.Send(new FinishedMessage { State = new RunnerNetState { Distance = 1f } });

                var aliceResult = await WaitFor<RaceResultMessage>(alice, aliceLog);
                var bobResult = await WaitFor<RaceResultMessage>(bob, bobLog);
                Assert.AreEqual(4, aliceResult.Standings.Count);
                CollectionAssert.AreEqual(aliceResult.Standings.Select(s => s.Id), bobResult.Standings.Select(s => s.Id));
                var alicePlace = aliceResult.Standings.First(s => s.Id == aliceWelcome.PlayerId).Place;
                var bobPlace = aliceResult.Standings.First(s => s.Id == bobWelcome.PlayerId).Place;
                Assert.Less(alicePlace, bobPlace, "the runner who got further ranks higher");
            }
        }

        [Test]
        public async Task QuickMatch_PutsPlayersTogether()
        {
            using (var a = WebSocketRaceConnection.Connect(raceUri))
            using (var b = WebSocketRaceConnection.Connect(raceUri))
            {
                var logA = new List<IRaceMessage>();
                var logB = new List<IRaceMessage>();
                a.Send(new HelloMessage { Name = "A" });
                a.Send(new JoinRoomMessage());
                var welcomeA = await WaitFor<WelcomeMessage>(a, logA);
                b.Send(new HelloMessage { Name = "B" });
                b.Send(new JoinRoomMessage());
                var welcomeB = await WaitFor<WelcomeMessage>(b, logB);
                Assert.AreEqual(welcomeA.RoomCode, welcomeB.RoomCode);

                a.Send(new ReadyMessage());
                var start = await WaitFor<RaceStartMessage>(b, logB);
                Assert.AreEqual(4, start.Players.Count);
            }
        }

        [Test]
        public async Task MalformedMessage_ClosesConnection()
        {
            using (var socket = new ClientWebSocket())
            {
                await socket.ConnectAsync(raceUri, CancellationToken.None);
                await socket.SendAsync(new ArraySegment<byte>(new byte[] { 250, 1, 2, 3 }), WebSocketMessageType.Binary, true, CancellationToken.None);
                var buffer = new byte[256];
                using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
                {
                    var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), timeout.Token);
                    Assert.AreEqual(WebSocketMessageType.Close, result.MessageType);
                    Assert.AreEqual(WebSocketCloseStatus.PolicyViolation, result.CloseStatus);
                }
            }
        }

        [Test]
        public async Task UnreachableServer_ReportsError()
        {
            using (var connection = WebSocketRaceConnection.Connect(new Uri("ws://127.0.0.1:1/race"), TimeSpan.FromSeconds(2)))
            {
                var deadline = DateTime.UtcNow.AddSeconds(5);
                while (connection.IsConnecting && DateTime.UtcNow < deadline) await Task.Delay(20);
                Assert.IsFalse(connection.IsOpen);
                Assert.IsNotNull(connection.LastError);
            }
        }
    }
}
