using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;

namespace Twitchphile.Core;

/// <summary>The few Twitch Helix endpoints the app needs. Pages through results; refreshes once on 401.</summary>
public sealed class Helix(HttpClient http, TwitchAuth auth)
{
    private const string Base = "https://api.twitch.tv/helix/";
    private const int PageSize = 100;

    /// <summary>Everyone you follow, newest follow first, with avatars.</summary>
    public async Task<IReadOnlyList<Channel>> FollowedChannelsAsync(CancellationToken ct = default)
    {
        var me = auth.Session?.UserId;
        if (me is null) return [];
        var follows = await PagedAsync<FollowRow>($"channels/followed?user_id={me}", ct);
        var avatars = await AvatarsAsync(follows.Select(f => f.BroadcasterId), ct);
        return follows
            .Select(f => new Channel(f.BroadcasterId, f.BroadcasterLogin, f.BroadcasterName)
            {
                FollowedAt = f.FollowedAt,
                AvatarUrl = avatars.GetValueOrDefault(f.BroadcasterId, ""),
            })
            .ToList();
    }

    // Profile pictures rarely change; cache them so each poll only looks up channels it hasn't seen.
    private readonly ConcurrentDictionary<string, string> _avatarCache = new(); // timer poll and Refresh can overlap

    /// <summary>Followed channels that are live right now, with avatars.</summary>
    public async Task<IReadOnlyList<LiveStream>> LiveFollowedAsync(CancellationToken ct = default)
    {
        var me = auth.Session?.UserId;
        if (me is null) return [];
        var rows = await PagedAsync<StreamRow>($"streams/followed?user_id={me}", ct);
        var missing = rows.Select(r => r.UserId).Where(id => !_avatarCache.ContainsKey(id)).ToList();
        if (missing.Count > 0)
        {
            var found = await AvatarsAsync(missing, ct);
            // Cache misses too (deleted/banned users have no row), or they'd be re-queried every poll.
            foreach (var id in missing) _avatarCache[id] = found.GetValueOrDefault(id, "");
        }
        return rows.Select(s => new LiveStream(s.UserId, s.UserLogin, s.UserName, s.GameName, s.Title, s.ViewerCount, s.StartedAt, s.ThumbnailUrl)
        {
            AvatarUrl = _avatarCache.GetValueOrDefault(s.UserId, ""),
            Language = s.Language ?? "",
            Tags = s.Tags ?? [],
        }).ToList();
    }

    /// <summary>Profile images by user id, fetched 100 at a time.</summary>
    public async Task<Dictionary<string, string>> AvatarsAsync(IEnumerable<string> userIds, CancellationToken ct = default)
    {
        var result = new Dictionary<string, string>();
        foreach (var batch in userIds.Distinct().Chunk(PageSize))
        {
            var page = await GetAsync<Page<UserRow>>("users?" + string.Join("&", batch.Select(id => $"id={id}")), ct);
            foreach (var u in page?.Data ?? [])
                if (!string.IsNullOrEmpty(u.Id)) result[u.Id] = u.ProfileImageUrl ?? "";
        }
        return result;
    }

    private async Task<List<T>> PagedAsync<T>(string path, CancellationToken ct)
    {
        var all = new List<T>();
        string? cursor = null;
        do
        {
            var page = await GetAsync<Page<T>>($"{path}&first={PageSize}" + (cursor is null ? "" : $"&after={cursor}"), ct);
            if (page is null) break;
            all.AddRange(page.Data);
            cursor = page.Pagination?.Cursor;
        } while (!string.IsNullOrEmpty(cursor));
        return all;
    }

    private async Task<T?> GetAsync<T>(string path, CancellationToken ct, bool retried = false)
    {
        var token = await auth.AccessTokenAsync(ct);
        if (token is null) return default;
        using var request = new HttpRequestMessage(HttpMethod.Get, Base + path);
        request.Headers.TryAddWithoutValidation("Client-Id", TwitchAuth.ClientId);
        request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {token}");
        using var response = await http.SendAsync(request, ct);
        if (response.StatusCode == HttpStatusCode.Unauthorized && !retried && await auth.RefreshAsync(ct, staleToken: token))
            return await GetAsync<T>(path, ct, retried: true);
        if (!response.IsSuccessStatusCode) return default;
        return await response.Content.ReadFromJsonAsync<T>(TwitchAuth.Json, ct);
    }

    // ---- Channel facts, for the stats view

    public async Task<ChannelInfo?> ChannelAsync(string login, CancellationToken ct = default)
    {
        var u = (await GetAsync<Page<ChannelRow>>($"users?login={Uri.EscapeDataString(login)}", ct))?.Data.FirstOrDefault();
        return u is null ? null : new ChannelInfo(u.Id, u.Login, u.DisplayName, u.ProfileImageUrl ?? "", u.BroadcasterType ?? "", u.CreatedAt);
    }

    /// <summary>Total followers of a channel (any signed-in user may read the total).</summary>
    public async Task<int?> FollowersAsync(string userId, CancellationToken ct = default) =>
        (await GetAsync<FollowerTotal>($"channels/followers?broadcaster_id={userId}&first=1", ct))?.Total;

    public async Task<IReadOnlyList<PastBroadcast>> PastBroadcastsAsync(string userId, CancellationToken ct = default) =>
        (await GetAsync<Page<VideoRow>>($"videos?user_id={userId}&type=archive&first=40", ct))?.Data
            .Select(v => new PastBroadcast(v.Title, v.CreatedAt, DurationMinutes(v.Duration), v.Url)).ToList() ?? [];

    public async Task<IReadOnlyList<ClipInfo>> TopClipsAsync(string userId, CancellationToken ct = default) =>
        (await GetAsync<Page<ClipRow>>($"clips?broadcaster_id={userId}&first=6&started_at={DateTimeOffset.UtcNow.AddDays(-30):yyyy-MM-ddTHH:mm:ssZ}", ct))?.Data
            .OrderByDescending(c => c.ViewCount).Select(c => new ClipInfo(c.Title, c.ViewCount, c.Url, c.ThumbnailUrl)).ToList() ?? [];

    // Helix durations look like "3h12m5s".
    private static int DurationMinutes(string d)
    {
        var m = System.Text.RegularExpressions.Regex.Match(d, @"(?:(\d+)h)?(?:(\d+)m)?");
        return (m.Groups[1].Success ? int.Parse(m.Groups[1].Value) * 60 : 0) + (m.Groups[2].Success ? int.Parse(m.Groups[2].Value) : 0);
    }

    private sealed record ChannelRow(string Id, string Login, string DisplayName, string? ProfileImageUrl, string? BroadcasterType, DateTimeOffset CreatedAt);
    private sealed record FollowerTotal(int Total);
    private sealed record VideoRow(string Title, DateTimeOffset CreatedAt, string Duration, string Url);
    private sealed record ClipRow(string Title, int ViewCount, string Url, string ThumbnailUrl);

    private sealed record Page<T>(List<T> Data, PageInfo? Pagination);
    private sealed record PageInfo(string? Cursor);
    private sealed record FollowRow(string BroadcasterId, string BroadcasterLogin, string BroadcasterName, DateTimeOffset FollowedAt);
    private sealed record StreamRow(string UserId, string UserLogin, string UserName, string GameName, string Title, int ViewerCount, DateTimeOffset StartedAt, string ThumbnailUrl, string? Language, List<string>? Tags);
    private sealed record UserRow(string? Id, string? ProfileImageUrl);
}
