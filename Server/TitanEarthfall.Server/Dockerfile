# Build from the repository root:  docker build -f Server/TitanEarthfall.Server/Dockerfile -t titan-race .
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY Assets/Scripts/Runner/Core Assets/Scripts/Runner/Core
COPY Server/TitanEarthfall.Server Server/TitanEarthfall.Server
RUN dotnet publish Server/TitanEarthfall.Server/TitanEarthfall.Server.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app .
ENV PORT=5080
EXPOSE 5080
ENTRYPOINT ["dotnet", "TitanEarthfall.Server.dll"]
