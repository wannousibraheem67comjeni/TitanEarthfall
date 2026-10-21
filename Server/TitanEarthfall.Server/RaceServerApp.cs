using System;
using System.Globalization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using TitanEarthfall.Runner;
using TitanEarthfall.Runner.Net;

namespace TitanEarthfall.Server
{
    /// <summary>Composition of the race server: HTTP endpoints, WebSocket route and the lobby hub.</summary>
    public static class RaceServerApp
    {
        public const int DefaultPort = 5080;

        public static WebApplication Build(string[] args, RaceRoomSettings settings = null, RunnerConfig config = null)
        {
            var builder = WebApplication.CreateBuilder(args);
            if (string.IsNullOrEmpty(builder.Configuration["urls"]))
            {
                // Cloud hosts (Render, Fly.io, Heroku…) pass the port through $PORT.
                string port = Environment.GetEnvironmentVariable("PORT");
                builder.WebHost.UseUrls($"http://0.0.0.0:{(string.IsNullOrEmpty(port) ? DefaultPort.ToString(CultureInfo.InvariantCulture) : port)}");
            }

            var options = new RaceHubOptions
            {
                Config = config ?? new RunnerConfig(),
                Settings = settings ?? ReadSettings(builder.Configuration.GetSection("Race"))
            };
            builder.Services.AddSingleton(options);
            builder.Services.AddSingleton<RaceHub>();
            builder.Services.AddHostedService(provider => provider.GetRequiredService<RaceHub>());

            var app = builder.Build();
            app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(15) });

            app.MapGet("/", () => "Titan Earthfall race server. Connect a WebSocket to /race.");
            app.MapGet("/health", (RaceHub hub) => Results.Json(new
            {
                status = "ok",
                protocol = RaceProtocol.Version,
                connections = hub.ConnectionCount,
                rooms = hub.RoomCount
            }));
            app.Map("/race", async (HttpContext context, RaceHub hub) =>
            {
                if (!context.WebSockets.IsWebSocketRequest)
                {
                    context.Response.StatusCode = StatusCodes.Status400BadRequest;
                    await context.Response.WriteAsync("WebSocket connection required.");
                    return;
                }
                using (var socket = await context.WebSockets.AcceptWebSocketAsync())
                    await hub.RunConnectionAsync(socket, context.RequestAborted);
            });
            return app;
        }

        private static RaceRoomSettings ReadSettings(IConfiguration section)
        {
            // RaceRoomSettings uses public fields (Unity-serializable), which the configuration binder ignores.
            var settings = new RaceRoomSettings();
            settings.MaxPlayers = Math.Clamp(Read(section, "MaxPlayers", settings.MaxPlayers), 1, RaceProtocol.MaxListCount);
            settings.RaceLength = Math.Max(100f, Read(section, "RaceLength", settings.RaceLength));
            settings.CountdownSeconds = Math.Max(0f, Read(section, "CountdownSeconds", settings.CountdownSeconds));
            settings.QuickMatchAutoStartSeconds = Math.Max(0f, Read(section, "QuickMatchAutoStartSeconds", settings.QuickMatchAutoStartSeconds));
            settings.TimeLimitSeconds = Math.Max(30f, Read(section, "TimeLimitSeconds", settings.TimeLimitSeconds));
            return settings;
        }

        private static int Read(IConfiguration section, string key, int fallback) =>
            int.TryParse(section[key], NumberStyles.Integer, CultureInfo.InvariantCulture, out int value) ? value : fallback;

        private static float Read(IConfiguration section, string key, float fallback) =>
            float.TryParse(section[key], NumberStyles.Float, CultureInfo.InvariantCulture, out float value) ? value : fallback;
    }
}
