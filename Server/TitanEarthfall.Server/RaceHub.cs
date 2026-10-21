using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TitanEarthfall.Runner;
using TitanEarthfall.Runner.Net;

namespace TitanEarthfall.Server
{
    public sealed class RaceHubOptions
    {
        public RunnerConfig Config;
        public RaceRoomSettings Settings;
        public float TickInterval = 0.05f;
        public int MaxMessagesPerSecond = 60;
    }

    /// <summary>
    /// Bridges WebSocket connections to the shared <see cref="RaceLobby"/>. All lobby access happens
    /// under one lock; each connection has its own bounded send queue so a slow client cannot stall others.
    /// </summary>
    public sealed class RaceHub : BackgroundService
    {
        private readonly object gate = new object();
        private readonly RaceLobby lobby;
        private readonly RaceHubOptions options;
        private readonly ILogger<RaceHub> logger;
        private readonly ConcurrentDictionary<int, ClientLink> links = new ConcurrentDictionary<int, ClientLink>();
        private readonly List<LobbyOutbound> outbound = new List<LobbyOutbound>();
        private readonly Dictionary<IRaceMessage, byte[]> encoded = new Dictionary<IRaceMessage, byte[]>();

        public RaceHub(RaceHubOptions options, ILogger<RaceHub> logger)
        {
            this.options = options;
            this.logger = logger;
            lobby = new RaceLobby(options.Config, options.Settings, Environment.TickCount);
        }

        public int ConnectionCount => links.Count;

        public int RoomCount
        {
            get
            {
                lock (gate) return lobby.RoomCount;
            }
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            using (var timer = new PeriodicTimer(TimeSpan.FromSeconds(options.TickInterval)))
            {
                var clock = Stopwatch.StartNew();
                double last = 0;
                try
                {
                    while (await timer.WaitForNextTickAsync(stoppingToken))
                    {
                        double now = clock.Elapsed.TotalSeconds;
                        float dt = (float)Math.Min(0.25, now - last);
                        last = now;
                        lock (gate)
                        {
                            lobby.Tick(dt);
                            Dispatch();
                        }
                    }
                }
                catch (OperationCanceledException)
                {
                }
            }
        }

        public async Task RunConnectionAsync(WebSocket socket, CancellationToken aborted)
        {
            int id;
            lock (gate) id = lobby.Connect();
            var link = new ClientLink(id, socket);
            links[id] = link;
            logger.LogInformation("Runner {Id} connected ({Count} online)", id, links.Count);
            var sendTask = link.RunSendLoopAsync(aborted);
            try
            {
                await ReceiveLoopAsync(link, aborted);
            }
            catch (InvalidDataException e)
            {
                logger.LogWarning("Runner {Id} sent invalid data: {Message}", id, e.Message);
                await link.CloseAsync(WebSocketCloseStatus.PolicyViolation, e.Message);
            }
            catch (Exception e) when (e is OperationCanceledException || e is WebSocketException)
            {
            }
            finally
            {
                lock (gate)
                {
                    lobby.Disconnect(id);
                    Dispatch();
                }
                links.TryRemove(id, out _);
                link.Complete();
                await sendTask;
                logger.LogInformation("Runner {Id} disconnected ({Count} online)", id, links.Count);
            }
        }

        private async Task ReceiveLoopAsync(ClientLink link, CancellationToken token)
        {
            var socket = link.Socket;
            var buffer = new byte[RaceProtocol.MaxMessageBytes];
            double allowance = options.MaxMessagesPerSecond * 2;
            var clock = Stopwatch.StartNew();
            double lastCheck = 0;

            while (socket.State == WebSocketState.Open)
            {
                int count = 0;
                WebSocketReceiveResult result;
                do
                {
                    if (count >= buffer.Length) throw new InvalidDataException("Message too large.");
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer, count, buffer.Length - count), token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await link.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye");
                        return;
                    }
                    count += result.Count;
                }
                while (!result.EndOfMessage);

                if (result.MessageType != WebSocketMessageType.Binary || count == 0) continue;

                // Token bucket: a client may burst, but not sustain more than MaxMessagesPerSecond.
                double now = clock.Elapsed.TotalSeconds;
                allowance = Math.Min(options.MaxMessagesPerSecond * 2, allowance + (now - lastCheck) * options.MaxMessagesPerSecond);
                lastCheck = now;
                if (allowance < 1) throw new InvalidDataException("Too many messages.");
                allowance -= 1;

                var message = RaceProtocol.Decode(buffer, count);
                lock (gate)
                {
                    lobby.Receive(link.Id, message);
                    Dispatch();
                }
            }
        }

        /// <summary>Moves lobby output to connection queues. Caller holds <see cref="gate"/>.</summary>
        private void Dispatch()
        {
            outbound.Clear();
            lobby.DrainOutbound(outbound);
            if (outbound.Count == 0) return;
            encoded.Clear();
            foreach (var item in outbound)
            {
                if (!links.TryGetValue(item.ConnectionId, out var link)) continue;
                if (!encoded.TryGetValue(item.Message, out var bytes))
                    encoded[item.Message] = bytes = RaceProtocol.Encode(item.Message);
                link.Enqueue(bytes);
            }
        }

        private sealed class ClientLink
        {
            private readonly Channel<byte[]> outbox = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(256)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true
            });
            private readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);

            public ClientLink(int id, WebSocket socket)
            {
                Id = id;
                Socket = socket;
            }

            public int Id { get; }
            public WebSocket Socket { get; }

            public void Enqueue(byte[] bytes) => outbox.Writer.TryWrite(bytes);

            public void Complete() => outbox.Writer.TryComplete();

            public async Task RunSendLoopAsync(CancellationToken token)
            {
                try
                {
                    await foreach (var bytes in outbox.Reader.ReadAllAsync(token))
                    {
                        if (Socket.State != WebSocketState.Open) break;
                        await sendLock.WaitAsync(token);
                        try
                        {
                            await Socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Binary, true, token);
                        }
                        finally
                        {
                            sendLock.Release();
                        }
                    }
                }
                catch (Exception e) when (e is OperationCanceledException || e is WebSocketException)
                {
                }
            }

            public async Task CloseAsync(WebSocketCloseStatus status, string reason)
            {
                if (Socket.State != WebSocketState.Open && Socket.State != WebSocketState.CloseReceived) return;
                await sendLock.WaitAsync();
                try
                {
                    using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2)))
                        await Socket.CloseAsync(status, reason, timeout.Token);
                }
                catch (Exception e) when (e is OperationCanceledException || e is WebSocketException)
                {
                }
                finally
                {
                    sendLock.Release();
                }
            }
        }
    }
}
