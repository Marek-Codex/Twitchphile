using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Twitchphile.Core;

namespace Twitchphile.App.Services;

/// <summary>Where the app keeps its files: %LocalAppData%\PlexusTwitchphile (family convention).</summary>
public static class Paths
{
    public static readonly string Data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PlexusTwitchphile");
    public static string File(string name) => Path.Combine(Data, name);
}

/// <summary>JSON files encrypted for the current Windows user (DPAPI), written atomically.</summary>
public static class Protected
{
    public static T? Read<T>(string path)
    {
        try
        {
            var plain = ProtectedData.Unprotect(System.IO.File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser);
            return JsonSerializer.Deserialize<T>(Encoding.UTF8.GetString(plain));
        }
        catch (Exception e) when (e is IOException or CryptographicException or JsonException) // missing, other user, corrupt
        {
            return default;
        }
    }

    public static void Write<T>(string path, T? value)
    {
        if (value is null)
        {
            System.IO.File.Delete(path);
            return;
        }
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value)), null, DataProtectionScope.CurrentUser);
        System.IO.File.WriteAllBytes(path + ".tmp", bytes);
        System.IO.File.Move(path + ".tmp", path, overwrite: true);
    }
}

/// <summary>The Twitch session, encrypted at rest.</summary>
public sealed class SessionStore : ISessionStore
{
    private static readonly string FilePath = Paths.File("session.bin");
    public TwitchSession? Load() => Protected.Read<TwitchSession>(FilePath);
    public void Save(TwitchSession? session) => Protected.Write(FilePath, session);
}
