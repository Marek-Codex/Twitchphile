using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;

namespace Twitchphile.Core;

/// <summary>
/// Kick channels in the live list. Kick channels are written "kick/&lt;name&gt;" everywhere (favorites, the follows
/// the extension hands over), so they sit in the same lists as Twitch logins. Each is checked through Kick's public
/// channel data: no Kick sign-in needed.
/// </summary>
public sealed class Kick(HttpClient http)
{
    public const string Prefix = "kick/";

    public static bool IsKick(string login) => login.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase);
    public static string Slug(string login) => login[Prefix.Length..].ToLowerInvariant();
    public static string Url(string login, string path = "") =>
        IsKick(login) ? $"https://kick.com/{Slug(login)}{path}" : $"https://www.twitch.tv/{login}{path}";

    /// <summary>The live ones among these channels (logins with or without the kick/ prefix). Throws if most checks fail.</summary>
    public async Task<IReadOnlyList<LiveStream>> LiveAsync(IEnumerable<string> channels, CancellationToken ct = default)
    {
        var slugs = channels.Select(c => IsKick(c) ? Slug(c) : c.ToLowerInvariant()).Where(s => s.Length > 0).Distinct().Take(150).ToList();
        var live = new List<LiveStream>();
        var failed = 0;
        foreach (var batch in slugs.Chunk(6))
            foreach (var r in await Task.WhenAll(batch.Select(s => CheckAsync(s, ct))))
                if (r.Failed) failed++;
                else if (r.Stream is not null) live.Add(r.Stream);
        if (slugs.Count > 0 && failed > slugs.Count / 2) throw new HttpRequestException("Kick live check failed");
        return live;
    }

    private async Task<(bool Failed, LiveStream? Stream)> CheckAsync(string slug, CancellationToken ct)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, $"https://kick.com/api/v2/channels/{Uri.EscapeDataString(slug)}");
            req.Headers.Accept.ParseAdd("application/json");
            using var res = await http.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode) return (true, null);
            var ch = await res.Content.ReadFromJsonAsync<JsonElement>(ct);
            if (!ch.TryGetProperty("livestream", out var s) || s.ValueKind != JsonValueKind.Object || !Bool(s, "is_live")) return (false, null);
            var user = ch.TryGetProperty("user", out var u) && u.ValueKind == JsonValueKind.Object ? u : default;
            var game = s.TryGetProperty("categories", out var cats) && cats.ValueKind == JsonValueKind.Array && cats.GetArrayLength() > 0 ? Str(cats[0], "name") : "";
            var thumb = s.TryGetProperty("thumbnail", out var t) && t.ValueKind == JsonValueKind.Object ? Str(t, "url") : "";
            return (false, new LiveStream("", Prefix + slug, user.ValueKind == JsonValueKind.Object ? Str(user, "username", slug) : slug, game,
                Str(s, "session_title"), s.TryGetProperty("viewer_count", out var v) && v.TryGetInt32(out var n) ? n : 0, Started(Str(s, "start_time")), thumb)
            {
                AvatarUrl = user.ValueKind == JsonValueKind.Object ? Str(user, "profile_pic") : "",
                Language = Str(s, "lang_iso"),
            });
        }
        catch (Exception e) when (e is HttpRequestException or JsonException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            return (true, null);
        }
    }

    private static string Str(JsonElement e, string name, string fallback = "") =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? fallback : fallback;
    private static bool Bool(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    // Kick's times look like "2026-10-13 17:30:00" (UTC, no zone marker).
    private static DateTimeOffset Started(string s) =>
        DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var d) ? d : DateTimeOffset.UtcNow;
}
