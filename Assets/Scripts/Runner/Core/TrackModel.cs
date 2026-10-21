namespace TitanEarthfall.Runner
{
    public enum TrackItemKind : byte
    {
        Coin,
        SkyCoin,
        Gem,
        Hurdle,
        Overhead,
        Train,
        Ramp,
        Magnet,
        Jetpack,
        SuperSneakers,
        Multiplier,
        Shield,
        MysteryBox
    }

    public enum PowerUpKind : byte
    {
        Magnet,
        Jetpack,
        SuperSneakers,
        Multiplier,
        Shield
    }

    /// <summary>A single obstacle, surface or pickup placed on the track. Immutable once generated.</summary>
    public struct TrackItem
    {
        public int Id;
        public TrackItemKind Kind;
        public int Lane;
        /// <summary>Start of the item along the track.</summary>
        public float Z;
        /// <summary>Extent along the track (0 for point pickups).</summary>
        public float Length;
        /// <summary>Height of the item's centre for pickups.</summary>
        public float Y;

        public float EndZ => Z + Length;

        public bool IsObstacle => Kind == TrackItemKind.Hurdle || Kind == TrackItemKind.Overhead || Kind == TrackItemKind.Train;

        public bool IsSurface => Kind == TrackItemKind.Train || Kind == TrackItemKind.Ramp;

        public bool IsPickup => !IsObstacle && Kind != TrackItemKind.Ramp;

        public bool IsPowerUp => Kind >= TrackItemKind.Magnet && Kind <= TrackItemKind.Shield;

        public PowerUpKind PowerUp => (PowerUpKind)(Kind - TrackItemKind.Magnet);

        public static TrackItemKind KindOf(PowerUpKind kind) => (TrackItemKind)((int)TrackItemKind.Magnet + (int)kind);
    }

    /// <summary>A generated slice of track. Chunks are self-contained so they can be generated in any order.</summary>
    public sealed class TrackChunk
    {
        public const int MaxItems = 1024;

        public int Index;
        public float StartZ;
        public float EndZ;
        public int Biome;
        public ulong DecorSeed;
        /// <summary>Items sorted by <see cref="TrackItem.Z"/>.</summary>
        public TrackItem[] Items;
    }
}
