using System;
using System.Collections.Generic;

namespace TitanEarthfall.Runner.Net
{
    public readonly struct LobbyOutbound
    {
        public readonly int ConnectionId;
        public readonly IRaceMessage Message;

        public LobbyOutbound(int connectionId, IRaceMessage message)
        {
            ConnectionId = connectionId;
            Message = message;
        }
    }

    /// <summary>
    /// Transport-agnostic matchmaking and message routing. The WebSocket server and the offline
    /// "race vs bots" mode both drive this same class, so online and offline races share every rule.
    /// Not thread-safe: callers serialize access (the server holds a lock).
    /// </summary>
    public sealed class RaceLobby
    {
        private const string CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";

        private sealed class Session
        {
            public int Id;
            public string Name = "Runner";
            public bool Greeted;
            public RaceRoom Room;
            public byte PlayerId;
        }

        private readonly RunnerConfig config;
        private readonly RaceRoomSettings settings;
        private readonly DeterministicRandom rng;
        private readonly Dictionary<int, Session> sessions = new Dictionary<int, Session>();
        private readonly List<RaceRoom> rooms = new List<RaceRoom>();
        private readonly List<LobbyOutbound> outbound = new List<LobbyOutbound>();
        private readonly List<RaceOutbound> roomScratch = new List<RaceOutbound>();
        private int nextConnectionId = 1;

        public RaceLobby(RunnerConfig config, RaceRoomSettings settings, int seed)
        {
            this.config = config ?? throw new ArgumentNullException(nameof(config));
            this.settings = settings ?? throw new ArgumentNullException(nameof(settings));
            rng = new DeterministicRandom((ulong)(uint)seed);
        }

        public int ConnectionCount => sessions.Count;
        public int RoomCount => rooms.Count;
        public IReadOnlyList<RaceRoom> Rooms => rooms;

        public int Connect()
        {
            int id = nextConnectionId++;
            sessions[id] = new Session { Id = id };
            return id;
        }

        public void Disconnect(int connectionId)
        {
            if (!sessions.TryGetValue(connectionId, out var session)) return;
            LeaveRoom(session);
            sessions.Remove(connectionId);
        }

        public void Receive(int connectionId, IRaceMessage message)
        {
            if (message == null || !sessions.TryGetValue(connectionId, out var session)) return;
            switch (message)
            {
                case HelloMessage hello:
                    if (hello.ProtocolVersion != RaceProtocol.Version)
                    {
                        SendError(session, $"Protocol mismatch (server {RaceProtocol.Version}, client {hello.ProtocolVersion}). Please update the game.");
                        return;
                    }
                    session.Name = RaceProtocol.SanitizeName(hello.Name);
                    session.Greeted = true;
                    break;
                case JoinRoomMessage join:
                    HandleJoin(session, join);
                    break;
                case ReadyMessage ready:
                    session.Room?.SetReady(session.PlayerId, ready.Ready);
                    break;
                case SnapshotMessage snapshot:
                    session.Room?.HandleSnapshot(session.PlayerId, snapshot);
                    break;
                case FinishedMessage finished:
                    session.Room?.HandleFinished(session.PlayerId, finished);
                    break;
                case LeaveMessage _:
                    LeaveRoom(session);
                    break;
                case PingMessage ping:
                    outbound.Add(new LobbyOutbound(session.Id, new PongMessage { ClientTime = ping.ClientTime }));
                    break;
            }
            if (session.Room != null) Flush(session.Room);
        }

        public void Tick(float deltaTime)
        {
            for (int i = rooms.Count - 1; i >= 0; i--)
            {
                var room = rooms[i];
                room.Tick(deltaTime);
                Flush(room);
                if (room.Phase != RoomPhase.Closed) continue;
                foreach (var session in sessions.Values)
                    if (session.Room == room) session.Room = null;
                rooms.RemoveAt(i);
            }
        }

        public void DrainOutbound(List<LobbyOutbound> into)
        {
            into.AddRange(outbound);
            outbound.Clear();
        }

        private void HandleJoin(Session session, JoinRoomMessage join)
        {
            if (!session.Greeted)
            {
                SendError(session, "Say hello before joining a room.");
                return;
            }
            LeaveRoom(session);

            RaceRoom room;
            string code = (join.RoomCode ?? "").Trim().ToUpperInvariant();
            if (join.CreatePrivate)
            {
                room = CreateRoom(true, join.FillWithBots);
            }
            else if (code.Length > 0)
            {
                room = rooms.Find(r => r.Code == code && r.HasFreeSlot);
                if (room == null)
                {
                    SendError(session, $"Room {code} was not found, is full or has already started.");
                    return;
                }
            }
            else
            {
                room = rooms.Find(r => !r.IsPrivate && r.HasFreeSlot) ?? CreateRoom(false, join.FillWithBots);
            }

            byte playerId = room.AddHuman(session.Name);
            if (playerId == 0)
            {
                SendError(session, "Could not join the room.");
                return;
            }
            session.Room = room;
            session.PlayerId = playerId;
            // Welcome must reach the client before the room state that lists it.
            outbound.Add(new LobbyOutbound(session.Id, new WelcomeMessage { PlayerId = playerId, RoomCode = room.Code }));
        }

        private RaceRoom CreateRoom(bool isPrivate, bool fillWithBots)
        {
            var room = new RaceRoom(NewCode(), isPrivate, (int)rng.NextUInt(), config, settings) { FillWithBots = fillWithBots };
            rooms.Add(room);
            return room;
        }

        private string NewCode()
        {
            var chars = new char[4];
            for (int attempt = 0; attempt < 1000; attempt++)
            {
                for (int i = 0; i < chars.Length; i++) chars[i] = CodeAlphabet[rng.Range(0, CodeAlphabet.Length)];
                string code = new string(chars);
                if (!rooms.Exists(r => r.Code == code)) return code;
            }
            return Guid.NewGuid().ToString("N").Substring(0, 6).ToUpperInvariant();
        }

        private void LeaveRoom(Session session)
        {
            var room = session.Room;
            if (room == null) return;
            room.RemovePlayer(session.PlayerId);
            session.Room = null;
            session.PlayerId = 0;
            Flush(room);
        }

        private void Flush(RaceRoom room)
        {
            roomScratch.Clear();
            room.DrainOutbound(roomScratch);
            foreach (var message in roomScratch)
            {
                foreach (var session in sessions.Values)
                {
                    if (session.Room != room) continue;
                    if (message.Target == 0 || message.Target == session.PlayerId)
                        outbound.Add(new LobbyOutbound(session.Id, message.Message));
                }
            }
        }

        private void SendError(Session session, string text) =>
            outbound.Add(new LobbyOutbound(session.Id, new ErrorMessage { Text = text }));
    }
}
