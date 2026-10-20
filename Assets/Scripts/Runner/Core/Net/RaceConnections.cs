using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;

namespace TitanEarthfall.Runner.Net
{
    /// <summary>Client-side link to a race lobby. Polled from the game loop; never blocks.</summary>
    public interface IRaceConnection : IDisposable
    {
        bool IsOpen { get; }
        bool IsConnecting { get; }
        /// <summary>Last transport error, or null.</summary>
        string LastError { get; }
        void Send(IRaceMessage message);
        bool TryReceive(out IRaceMessage message);
        /// <summary>Advances local hosts; network connections ignore it.</summary>
        void Update(float deltaTime);
    }

    /// <summary>
    /// Runs a private <see cref="RaceLobby"/> in-process (race against bots, no server needed).
    /// Messages still go through the binary protocol so offline play exercises the online code path.
    /// </summary>
    public sealed class LocalRaceConnection : IRaceConnection
    {
        private readonly RaceLobby lobby;
        private readonly int connectionId;
        private readonly Queue<IRaceMessage> inbox = new Queue<IRaceMessage>();
        private readonly List<LobbyOutbound> scratch = new List<LobbyOutbound>();
        private bool disposed;

        public LocalRaceConnection(RunnerConfig config, RaceRoomSettings settings, int seed)
        {
            lobby = new RaceLobby(config, settings, seed);
            connectionId = lobby.Connect();
        }

        public bool IsOpen => !disposed;
        public bool IsConnecting => false;
        public string LastError => null;

        public void Send(IRaceMessage message)
        {
            if (disposed) return;
            lobby.Receive(connectionId, RoundTrip(message));
            Pump();
        }

        public bool TryReceive(out IRaceMessage message)
        {
            if (inbox.Count > 0)
            {
                message = inbox.Dequeue();
                return true;
            }
            message = null;
            return false;
        }

        public void Update(float deltaTime)
        {
            if (disposed) return;
            lobby.Tick(deltaTime);
            Pump();
        }

        public void Dispose()
        {
            if (disposed) return;
            lobby.Disconnect(connectionId);
            disposed = true;
        }

        private void Pump()
        {
            scratch.Clear();
            lobby.DrainOutbound(scratch);
            foreach (var item in scratch)
                if (item.ConnectionId == connectionId) inbox.Enqueue(RoundTrip(item.Message));
        }

        private static IRaceMessage RoundTrip(IRaceMessage message)
        {
            var bytes = RaceProtocol.Encode(message);
            return RaceProtocol.Decode(bytes, bytes.Length);
        }
    }

    /// <summary>
    /// WebSocket client for the race server (Standalone, Android, iOS; not WebGL).
    /// Receiving and sending run on background tasks; the game thread polls <see cref="TryReceive"/>.
    /// </summary>
    public sealed class WebSocketRaceConnection : IRaceConnection
    {
        private readonly ClientWebSocket socket = new ClientWebSocket();
        private readonly CancellationTokenSource cancellation = new CancellationTokenSource();
        private readonly ConcurrentQueue<IRaceMessage> inbox = new ConcurrentQueue<IRaceMessage>();
        private readonly ConcurrentQueue<byte[]> outbox = new ConcurrentQueue<byte[]>();
        private readonly SemaphoreSlim outboxSignal = new SemaphoreSlim(0);
        private volatile bool connecting = true;
        private volatile string lastError;
        private int disposed;

        private WebSocketRaceConnection()
        {
        }

        public bool IsOpen => !connecting && socket.State == WebSocketState.Open;
        public bool IsConnecting => connecting;
        public string LastError => lastError;

        /// <summary>Starts connecting in the background. Messages sent before the socket opens are queued.</summary>
        public static WebSocketRaceConnection Connect(Uri uri, TimeSpan? timeout = null)
        {
            var connection = new WebSocketRaceConnection();
            connection.socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(15);
            _ = connection.RunAsync(uri, timeout ?? TimeSpan.FromSeconds(8));
            return connection;
        }

        public void Send(IRaceMessage message)
        {
            if (Volatile.Read(ref disposed) != 0) return;
            outbox.Enqueue(RaceProtocol.Encode(message));
            outboxSignal.Release();
        }

        public bool TryReceive(out IRaceMessage message) => inbox.TryDequeue(out message);

        public void Update(float deltaTime)
        {
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref disposed, 1) != 0) return;
            connecting = false;
            try
            {
                if (socket.State == WebSocketState.Open)
                    socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None).Wait(500);
            }
            catch (Exception)
            {
                // Best effort: the socket is being torn down anyway.
            }
            cancellation.Cancel();
            socket.Dispose();
        }

        private async Task RunAsync(Uri uri, TimeSpan timeout)
        {
            var token = cancellation.Token;
            try
            {
                using (var connectTimeout = CancellationTokenSource.CreateLinkedTokenSource(token))
                {
                    connectTimeout.CancelAfter(timeout);
                    await socket.ConnectAsync(uri, connectTimeout.Token).ConfigureAwait(false);
                }
                connecting = false;
                var sendTask = SendLoopAsync(token);
                try
                {
                    await ReceiveLoopAsync(token).ConfigureAwait(false);
                }
                finally
                {
                    // Wake the send loop so it notices the socket is no longer open.
                    outboxSignal.Release();
                }
                await sendTask.ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!token.IsCancellationRequested)
            {
                lastError = $"Could not reach {uri} (timed out).";
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception e) when (Volatile.Read(ref disposed) == 0)
            {
                lastError = e.InnerException != null ? e.InnerException.Message : e.Message;
            }
            catch (Exception)
            {
            }
            finally
            {
                connecting = false;
                if (lastError == null && Volatile.Read(ref disposed) == 0) lastError = "Disconnected from race server.";
                outboxSignal.Release();
            }
        }

        private async Task ReceiveLoopAsync(CancellationToken token)
        {
            var buffer = new byte[RaceProtocol.MaxMessageBytes];
            while (!token.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                int count = 0;
                WebSocketReceiveResult result;
                do
                {
                    if (count >= buffer.Length) throw new InvalidDataException("Race message too large.");
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer, count, buffer.Length - count), token).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        lastError = string.IsNullOrEmpty(result.CloseStatusDescription) ? "Server closed the connection." : result.CloseStatusDescription;
                        return;
                    }
                    count += result.Count;
                }
                while (!result.EndOfMessage);

                if (result.MessageType == WebSocketMessageType.Binary && count > 0)
                    inbox.Enqueue(RaceProtocol.Decode(buffer, count));
            }
        }

        private async Task SendLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                await outboxSignal.WaitAsync(token).ConfigureAwait(false);
                while (outbox.TryDequeue(out var bytes))
                {
                    if (socket.State != WebSocketState.Open) return;
                    await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Binary, true, token).ConfigureAwait(false);
                }
            }
        }
    }
}
