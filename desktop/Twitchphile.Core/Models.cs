namespace Twitchphile.Core;

/// <summary>A channel you follow.</summary>
public sealed record Channel(string Id, string Login, string Name)
{
    public string AvatarUrl { get; init; } = "";
    public DateTimeOffset FollowedAt { get; init; }
}

/// <summary>A live broadcast.</summary>
public sealed record LiveStream(
    string UserId,
    string Login,
    string Name,
    string Game,
    string Title,
    int Viewers,
    DateTimeOffset StartedAt,
    string ThumbnailUrl)
{
    public string AvatarUrl { get; init; } = "";
    public string Language { get; init; } = "";
    public IReadOnlyList<string> Tags { get; init; } = [];

    /// <summary>Thumbnail at a concrete size (Twitch returns a {width}x{height} template).</summary>
    public string Thumbnail(int width, int height) =>
        ThumbnailUrl.Replace("{width}", width.ToString()).Replace("{height}", height.ToString());
}

/// <summary>Who a channel is, for the stats view.</summary>
public sealed record ChannelInfo(string Id, string Login, string Name, string AvatarUrl, string BroadcasterType, DateTimeOffset CreatedAt);

/// <summary>A past broadcast (VOD).</summary>
public sealed record PastBroadcast(string Title, DateTimeOffset CreatedAt, int Minutes, string Url);

/// <summary>A clip, for "top clips".</summary>
public sealed record ClipInfo(string Title, int Views, string Url, string ThumbnailUrl);

/// <summary>The signed-in Twitch account and its tokens.</summary>
public sealed record TwitchSession(string UserId, string Login, string AccessToken, string RefreshToken, DateTimeOffset ExpiresAt);

/// <summary>What the user must do to finish signing in: open the URL and enter the code.</summary>
public sealed record DeviceCode(string UserCode, string VerificationUri, TimeSpan ExpiresIn);

/// <summary>A drop you're working towards, as the browser extension reports it.</summary>
public sealed record Drop(string Id, string Name, string Image, int Minutes, int Required, bool Claimed, bool Claimable);

/// <summary>A drop campaign in progress.</summary>
public sealed record DropCampaign(string Id, string Name, string Game, string GameArt, string EndsAt, IReadOnlyList<Drop> Drops);

/// <summary>
/// Drop progress, sent by the paired extension. Twitch only shows drop progress to its own website session, so the
/// extension reads it on twitch.tv and passes this summary along — the app never sees that session.
/// </summary>
public sealed record DropsState(long At, IReadOnlyList<DropCampaign> Campaigns);
