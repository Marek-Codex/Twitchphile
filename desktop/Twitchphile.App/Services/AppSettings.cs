using System.Text.Json;

namespace Twitchphile.App.Services;

public enum FollowSort { LiveFirst, Name, RecentlyFollowed }

/// <summary>User preferences, as plain JSON. The pairing token lives separately, encrypted (see <see cref="PairingToken"/>).</summary>
public sealed class AppSettings
{
    private static readonly string FilePath = Paths.File("settings.json");

    public bool Notifications { get; set; } = true;

    /// <summary>Send go-live notifications as "urgent", which Windows lets through Do Not Disturb if you allow it.</summary>
    public bool PriorityNotifications { get; set; }

    public bool CloseToTray { get; set; } = true;

    /// <summary>How often to check who's live, in minutes (1–15, like the extension's "Check every").</summary>
    public int PollMinutes { get; set; } = 2;
    public FollowSort FollowSort { get; set; } = FollowSort.LiveFirst;

    public static AppSettings Load()
    {
        try { return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath)) ?? new(); }
        catch (Exception e) when (e is IOException or JsonException) { return new(); }
    }

    public void Save()
    {
        Directory.CreateDirectory(Paths.Data);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}

/// <summary>The extension pairing token, encrypted at rest.</summary>
public static class PairingToken
{
    private static readonly string FilePath = Paths.File("pairing.bin");
    public static string? Load() => Protected.Read<string>(FilePath);
    public static void Save(string? token) => Protected.Write(FilePath, token);
}
