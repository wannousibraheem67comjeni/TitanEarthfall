using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace TitanEarthfall.Runner.Net
{
    public enum RaceMessageType : byte
    {
        Hello = 1,
        Welcome = 2,
        JoinRoom = 3,
        RoomState = 4,
        Ready = 5,
        RaceStart = 6,
        Snapshot = 7,
        WorldState = 8,
        Finished = 9,
        RaceResult = 10,
        Leave = 11,
        Error = 12,
        Ping = 13,
        Pong = 14
    }

    public enum RoomPhase : byte { Lobby, Countdown, Racing, Results, Closed }

    public interface IRaceMessage
    {
        RaceMessageType Type { get; }
        void Write(BinaryWriter writer);
        void Read(BinaryReader reader);
    }

    /// <summary>Binary wire format shared by the Unity client and the race server.</summary>
    public static class RaceProtocol
    {
        public const ushort Version = 1;
        public const int MaxMessageBytes = 4096;
        public const int MaxNameLength = 16;
        public const int MaxListCount = 16;

        public static byte[] Encode(IRaceMessage message)
        {
            using (var stream = new MemoryStream(64))
            using (var writer = new BinaryWriter(stream, Encoding.UTF8))
            {
                writer.Write((byte)message.Type);
                message.Write(writer);
                writer.Flush();
                return stream.ToArray();
            }
        }

        /// <summary>Decodes a message; throws <see cref="InvalidDataException"/> on malformed input.</summary>
        public static IRaceMessage Decode(byte[] buffer, int count)
        {
            if (buffer == null || count <= 0 || count > MaxMessageBytes || count > buffer.Length)
                throw new InvalidDataException("Invalid race message length.");
            try
            {
                using (var stream = new MemoryStream(buffer, 0, count, false))
                using (var reader = new BinaryReader(stream, Encoding.UTF8))
                {
                    var message = Create((RaceMessageType)reader.ReadByte());
                    message.Read(reader);
                    return message;
                }
            }
            catch (EndOfStreamException e)
            {
                throw new InvalidDataException("Truncated race message.", e);
            }
            catch (FormatException e)
            {
                throw new InvalidDataException("Malformed race message.", e);
            }
        }

        public static IRaceMessage Create(RaceMessageType type)
        {
            switch (type)
            {
                case RaceMessageType.Hello: return new HelloMessage();
                case RaceMessageType.Welcome: return new WelcomeMessage();
                case RaceMessageType.JoinRoom: return new JoinRoomMessage();
                case RaceMessageType.RoomState: return new RoomStateMessage();
                case RaceMessageType.Ready: return new ReadyMessage();
                case RaceMessageType.RaceStart: return new RaceStartMessage();
                case RaceMessageType.Snapshot: return new SnapshotMessage();
                case RaceMessageType.WorldState: return new WorldStateMessage();
                case RaceMessageType.Finished: return new FinishedMessage();
                case RaceMessageType.RaceResult: return new RaceResultMessage();
                case RaceMessageType.Leave: return new LeaveMessage();
                case RaceMessageType.Error: return new ErrorMessage();
                case RaceMessageType.Ping: return new PingMessage();
                case RaceMessageType.Pong: return new PongMessage();
                default: throw new InvalidDataException($"Unknown race message type {(byte)type}.");
            }
        }

        /// <summary>Trims, strips control characters and limits length of a player-provided name.</summary>
        public static string SanitizeName(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return "Runner";
            var builder = new StringBuilder(MaxNameLength);
            foreach (char c in name.Trim())
            {
                if (char.IsControl(c)) continue;
                builder.Append(c);
                if (builder.Length >= MaxNameLength) break;
            }
            return builder.Length == 0 ? "Runner" : builder.ToString();
        }

        internal static int ReadCount(BinaryReader reader)
        {
            int count = reader.ReadByte();
            if (count > MaxListCount) throw new InvalidDataException("Race message list too long.");
            return count;
        }

        internal static string ReadString(BinaryReader reader, int maxLength)
        {
            string value = reader.ReadString();
            if (value.Length > maxLength) throw new InvalidDataException("Race message string too long.");
            return value;
        }
    }

    public struct RacePlayerInfo
    {
        public byte Id;
        public string Name;
        public bool IsBot;
        public bool Ready;
        public bool Connected;

        public void Write(BinaryWriter writer)
        {
            writer.Write(Id);
            writer.Write(Name ?? "");
            writer.Write((byte)((IsBot ? 1 : 0) | (Ready ? 2 : 0) | (Connected ? 4 : 0)));
        }

        public static RacePlayerInfo Read(BinaryReader reader)
        {
            var info = new RacePlayerInfo { Id = reader.ReadByte(), Name = RaceProtocol.ReadString(reader, RaceProtocol.MaxNameLength) };
            byte flags = reader.ReadByte();
            info.IsBot = (flags & 1) != 0;
            info.Ready = (flags & 2) != 0;
            info.Connected = (flags & 4) != 0;
            return info;
        }

        internal static void WriteList(BinaryWriter writer, List<RacePlayerInfo> players)
        {
            int count = Math.Min(players.Count, RaceProtocol.MaxListCount);
            writer.Write((byte)count);
            for (int i = 0; i < count; i++) players[i].Write(writer);
        }

        internal static void ReadList(BinaryReader reader, List<RacePlayerInfo> players)
        {
            players.Clear();
            int count = RaceProtocol.ReadCount(reader);
            for (int i = 0; i < count; i++) players.Add(Read(reader));
        }
    }

    public struct PlayerNetEntry
    {
        public byte Id;
        public RunnerNetState State;
    }

    public struct RaceStanding
    {
        public byte Id;
        public string Name;
        public byte Place;
        public bool IsBot;
        public bool Finished;
        public float FinishTime;
        public float Distance;
        public int Score;
        public int Coins;
    }

    /// <summary>Client → server: first message after connecting.</summary>
    public sealed class HelloMessage : IRaceMessage
    {
        public ushort ProtocolVersion = RaceProtocol.Version;
        public string Name = "Runner";

        public RaceMessageType Type => RaceMessageType.Hello;

        public void Write(BinaryWriter writer)
        {
            writer.Write(ProtocolVersion);
            writer.Write(Name ?? "");
        }

        public void Read(BinaryReader reader)
        {
            ProtocolVersion = reader.ReadUInt16();
            Name = RaceProtocol.ReadString(reader, 64);
        }
    }

    /// <summary>Server → client: you joined <see cref="RoomCode"/> as <see cref="PlayerId"/>.</summary>
    public sealed class WelcomeMessage : IRaceMessage
    {
        public byte PlayerId;
        public string RoomCode = "";

        public RaceMessageType Type => RaceMessageType.Welcome;

        public void Write(BinaryWriter writer)
        {
            writer.Write(PlayerId);
            writer.Write(RoomCode ?? "");
        }

        public void Read(BinaryReader reader)
        {
            PlayerId = reader.ReadByte();
            RoomCode = RaceProtocol.ReadString(reader, 16);
        }
    }

    /// <summary>Client → server: join a room by code, quick-match (empty code) or create a private room.</summary>
    public sealed class JoinRoomMessage : IRaceMessage
    {
        public string RoomCode = "";
        public bool CreatePrivate;
        public bool FillWithBots = true;

        public RaceMessageType Type => RaceMessageType.JoinRoom;

        public void Write(BinaryWriter writer)
        {
            writer.Write(RoomCode ?? "");
            writer.Write((byte)((CreatePrivate ? 1 : 0) | (FillWithBots ? 2 : 0)));
        }

        public void Read(BinaryReader reader)
        {
            RoomCode = RaceProtocol.ReadString(reader, 16);
            byte flags = reader.ReadByte();
            CreatePrivate = (flags & 1) != 0;
            FillWithBots = (flags & 2) != 0;
        }
    }

    public sealed class RoomStateMessage : IRaceMessage
    {
        public string RoomCode = "";
        public RoomPhase Phase;
        public bool IsPrivate;
        /// <summary>Seconds until a quick-match room starts on its own; negative when no timer runs.</summary>
        public float AutoStartIn = -1f;
        public List<RacePlayerInfo> Players = new List<RacePlayerInfo>();

        public RaceMessageType Type => RaceMessageType.RoomState;

        public void Write(BinaryWriter writer)
        {
            writer.Write(RoomCode ?? "");
            writer.Write((byte)Phase);
            writer.Write(IsPrivate);
            writer.Write(AutoStartIn);
            RacePlayerInfo.WriteList(writer, Players);
        }

        public void Read(BinaryReader reader)
        {
            RoomCode = RaceProtocol.ReadString(reader, 16);
            Phase = (RoomPhase)reader.ReadByte();
            IsPrivate = reader.ReadBoolean();
            AutoStartIn = reader.ReadSingle();
            RacePlayerInfo.ReadList(reader, Players);
        }
    }

    public sealed class ReadyMessage : IRaceMessage
    {
        public bool Ready = true;

        public RaceMessageType Type => RaceMessageType.Ready;

        public void Write(BinaryWriter writer) => writer.Write(Ready);

        public void Read(BinaryReader reader) => Ready = reader.ReadBoolean();
    }

    /// <summary>Server → clients: everyone runs the same seeded track to <see cref="RaceLength"/> after the countdown.</summary>
    public sealed class RaceStartMessage : IRaceMessage
    {
        public int Seed;
        public float RaceLength;
        public float Countdown;
        public List<RacePlayerInfo> Players = new List<RacePlayerInfo>();

        public RaceMessageType Type => RaceMessageType.RaceStart;

        public void Write(BinaryWriter writer)
        {
            writer.Write(Seed);
            writer.Write(RaceLength);
            writer.Write(Countdown);
            RacePlayerInfo.WriteList(writer, Players);
        }

        public void Read(BinaryReader reader)
        {
            Seed = reader.ReadInt32();
            RaceLength = reader.ReadSingle();
            Countdown = reader.ReadSingle();
            RacePlayerInfo.ReadList(reader, Players);
        }
    }

    /// <summary>Client → server: the local runner's state, sent several times per second.</summary>
    public sealed class SnapshotMessage : IRaceMessage
    {
        public float RaceTime;
        public RunnerNetState State;

        public RaceMessageType Type => RaceMessageType.Snapshot;

        public void Write(BinaryWriter writer)
        {
            writer.Write(RaceTime);
            State.Write(writer);
        }

        public void Read(BinaryReader reader)
        {
            RaceTime = reader.ReadSingle();
            State = RunnerNetState.Read(reader);
        }
    }

    /// <summary>Server → clients: authoritative-ish view of every runner in the race.</summary>
    public sealed class WorldStateMessage : IRaceMessage
    {
        public float RaceTime;
        public List<PlayerNetEntry> Players = new List<PlayerNetEntry>();

        public RaceMessageType Type => RaceMessageType.WorldState;

        public void Write(BinaryWriter writer)
        {
            writer.Write(RaceTime);
            int count = Math.Min(Players.Count, RaceProtocol.MaxListCount);
            writer.Write((byte)count);
            for (int i = 0; i < count; i++)
            {
                writer.Write(Players[i].Id);
                Players[i].State.Write(writer);
            }
        }

        public void Read(BinaryReader reader)
        {
            RaceTime = reader.ReadSingle();
            Players.Clear();
            int count = RaceProtocol.ReadCount(reader);
            for (int i = 0; i < count; i++)
                Players.Add(new PlayerNetEntry { Id = reader.ReadByte(), State = RunnerNetState.Read(reader) });
        }
    }

    /// <summary>Client → server: the local runner is out of the race (finished, or crashed without reviving).</summary>
    public sealed class FinishedMessage : IRaceMessage
    {
        public RunnerNetState State;

        public RaceMessageType Type => RaceMessageType.Finished;

        public void Write(BinaryWriter writer) => State.Write(writer);

        public void Read(BinaryReader reader) => State = RunnerNetState.Read(reader);
    }

    public sealed class RaceResultMessage : IRaceMessage
    {
        public List<RaceStanding> Standings = new List<RaceStanding>();

        public RaceMessageType Type => RaceMessageType.RaceResult;

        public void Write(BinaryWriter writer)
        {
            int count = Math.Min(Standings.Count, RaceProtocol.MaxListCount);
            writer.Write((byte)count);
            for (int i = 0; i < count; i++)
            {
                var s = Standings[i];
                writer.Write(s.Id);
                writer.Write(s.Name ?? "");
                writer.Write(s.Place);
                writer.Write((byte)((s.IsBot ? 1 : 0) | (s.Finished ? 2 : 0)));
                writer.Write(s.FinishTime);
                writer.Write(s.Distance);
                writer.Write(s.Score);
                writer.Write(s.Coins);
            }
        }

        public void Read(BinaryReader reader)
        {
            Standings.Clear();
            int count = RaceProtocol.ReadCount(reader);
            for (int i = 0; i < count; i++)
            {
                var s = new RaceStanding
                {
                    Id = reader.ReadByte(),
                    Name = RaceProtocol.ReadString(reader, RaceProtocol.MaxNameLength),
                    Place = reader.ReadByte()
                };
                byte flags = reader.ReadByte();
                s.IsBot = (flags & 1) != 0;
                s.Finished = (flags & 2) != 0;
                s.FinishTime = reader.ReadSingle();
                s.Distance = reader.ReadSingle();
                s.Score = reader.ReadInt32();
                s.Coins = reader.ReadInt32();
                Standings.Add(s);
            }
        }
    }

    public sealed class LeaveMessage : IRaceMessage
    {
        public RaceMessageType Type => RaceMessageType.Leave;

        public void Write(BinaryWriter writer) { }

        public void Read(BinaryReader reader) { }
    }

    public sealed class ErrorMessage : IRaceMessage
    {
        public string Text = "";

        public RaceMessageType Type => RaceMessageType.Error;

        public void Write(BinaryWriter writer) => writer.Write(Text ?? "");

        public void Read(BinaryReader reader) => Text = RaceProtocol.ReadString(reader, 256);
    }

    public sealed class PingMessage : IRaceMessage
    {
        public double ClientTime;

        public RaceMessageType Type => RaceMessageType.Ping;

        public void Write(BinaryWriter writer) => writer.Write(ClientTime);

        public void Read(BinaryReader reader) => ClientTime = reader.ReadDouble();
    }

    public sealed class PongMessage : IRaceMessage
    {
        public double ClientTime;

        public RaceMessageType Type => RaceMessageType.Pong;

        public void Write(BinaryWriter writer) => writer.Write(ClientTime);

        public void Read(BinaryReader reader) => ClientTime = reader.ReadDouble();
    }
}
