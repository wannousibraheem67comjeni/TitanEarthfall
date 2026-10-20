using System.IO;

namespace TitanEarthfall.Runner
{
    /// <summary>Compact, network-friendly view of one runner, shared by snapshots, bots and results.</summary>
    public struct RunnerNetState
    {
        public float Distance;
        public float X;
        public float Y;
        public RunnerPose Pose;
        /// <summary>Bit per <see cref="PowerUpKind"/> that is currently active.</summary>
        public byte PowerUps;
        public int Score;
        public int Coins;
        public bool Alive;
        public bool Finished;
        public float FinishTime;

        public bool HasPowerUp(PowerUpKind kind) => (PowerUps & (1 << (int)kind)) != 0;

        public void Write(BinaryWriter writer)
        {
            writer.Write(Distance);
            writer.Write(X);
            writer.Write(Y);
            writer.Write((byte)Pose);
            writer.Write(PowerUps);
            writer.Write(Score);
            writer.Write(Coins);
            writer.Write((byte)((Alive ? 1 : 0) | (Finished ? 2 : 0)));
            writer.Write(FinishTime);
        }

        public static RunnerNetState Read(BinaryReader reader)
        {
            var state = new RunnerNetState
            {
                Distance = reader.ReadSingle(),
                X = reader.ReadSingle(),
                Y = reader.ReadSingle(),
                Pose = (RunnerPose)reader.ReadByte(),
                PowerUps = reader.ReadByte(),
                Score = reader.ReadInt32(),
                Coins = reader.ReadInt32()
            };
            byte flags = reader.ReadByte();
            state.Alive = (flags & 1) != 0;
            state.Finished = (flags & 2) != 0;
            state.FinishTime = reader.ReadSingle();
            return state;
        }
    }
}
