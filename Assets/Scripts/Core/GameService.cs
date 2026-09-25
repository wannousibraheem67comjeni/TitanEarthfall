namespace TitanEarthfall.Core
{
    /// <summary>
    /// Marker contract for gameplay services managed by the project architecture.
    /// </summary>
    public interface IGameService
    {
        void Initialize();
        void Shutdown();
    }
}
