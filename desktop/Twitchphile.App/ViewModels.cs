using System.ComponentModel;
using System.Runtime.CompilerServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Twitchphile.Core;

namespace Twitchphile.App;

public abstract class Observable : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    protected bool Set<T>(ref T field, T value, [CallerMemberName] string name = "")
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        Notify(name);
        return true;
    }

    protected void Notify(string name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

/// <summary>A live favorite in the Live view. Updated in place each poll so an open player isn't torn down.</summary>
public sealed class LiveItem(string login) : Observable
{
    public string Login { get; } = login;

    private const int MaxTags = 3;

    private string _name = "", _game = "", _title = "", _viewers = "", _uptime = "", _avatarUrl = "";
    private ImageSource? _avatar, _thumb;
    private IReadOnlyList<string> _pills = [];
    private bool _expanded;
    private DateTimeOffset _startedAt;

    public string Name { get => _name; set => Set(ref _name, value); }
    public string Game { get => _game; set => Set(ref _game, value); }
    public string Title { get => _title; set => Set(ref _title, value); }
    public string Viewers { get => _viewers; set => Set(ref _viewers, value); }
    public string Uptime { get => _uptime; set => Set(ref _uptime, value); }
    public ImageSource? Avatar { get => _avatar; set => Set(ref _avatar, value); }
    public bool IsExpanded { get => _expanded; set => Set(ref _expanded, value); }

    /// <summary>What's on screen right now — shown when you hover the avatar.</summary>
    public ImageSource? Thumb { get => _thumb; set => Set(ref _thumb, value); }

    /// <summary>Language + a few of the stream's tags, as small pills.</summary>
    public IReadOnlyList<string> Pills
    {
        get => _pills;
        set { if (!_pills.SequenceEqual(value)) Set(ref _pills, value); }
    }

    public void Update(LiveStream s)
    {
        Name = s.Name;
        Game = string.IsNullOrEmpty(s.Game) ? "Streaming" : s.Game;
        Title = s.Title;
        Viewers = Format.Compact(s.Viewers);
        _startedAt = s.StartedAt;
        Tick();
        Pills = [.. Kick.IsKick(s.Login) ? new[] { "KICK" } : [], .. string.IsNullOrEmpty(s.Language) ? [] : new[] { s.Language.ToUpperInvariant() }, .. s.Tags.Take(MaxTags)];
        if (s.AvatarUrl != _avatarUrl) (_avatarUrl, Avatar) = (s.AvatarUrl, Format.Avatar(s.AvatarUrl));
        // Twitch caches thumbnails; the minute stamp makes each poll fetch a fresh frame.
        Thumb = Format.Image(s.Thumbnail(320, 180) + $"?t={DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 60}");
    }

    /// <summary>Keeps uptime moving between polls.</summary>
    public void Tick() => Uptime = Format.Duration(DateTimeOffset.UtcNow - _startedAt);
}

/// <summary>A followed channel in the Following view.</summary>
public sealed class FollowItem(Channel channel) : Observable
{
    public Channel Channel { get; } = channel;
    public string Login => Channel.Login;
    public string Name => Channel.Name;
    public ImageSource? Avatar { get; } = Format.Avatar(channel.AvatarUrl);

    private bool _favorite;

    public bool Isfavorite
    {
        get => _favorite;
        set { if (Set(ref _favorite, value)) Notify(nameof(StarGlyph)); }
    }

    // Segoe Fluent Icons: filled / outline star.
    public string StarGlyph => Isfavorite ? "" : "";

    // Set once per list build (rows are rebuilt when live or hidden status changes, so these needn't notify).
    public bool IsHidden { get; init; }
    public string HideText => IsHidden ? "Unhide" : "Hide from lists";
    public double RowOpacity => IsHidden ? 0.45 : 1;
    public bool IsLive { get; private set; }
    public string Game { get; private set; } = "";
    public string Title { get; private set; } = "";
    public string Viewers { get; private set; } = "";
    public string Uptime { get; private set; } = "";

    public void SetLive(LiveStream? s)
    {
        IsLive = s is not null;
        if (s is null) return;
        Game = string.IsNullOrEmpty(s.Game) ? "Streaming" : s.Game;
        Title = s.Title;
        Viewers = Format.Compact(s.Viewers);
        Uptime = Format.Duration(DateTimeOffset.UtcNow - s.StartedAt);
    }
}

/// <summary>A drop campaign in the Drops view, with its drops' progress.</summary>
public sealed class DropCampaignItem(DropCampaign c)
{
    public string Title { get; } = string.IsNullOrEmpty(c.Game) ? c.Name : c.Game;
    public string Subtitle { get; } = c.Name + (DateTimeOffset.TryParse(c.EndsAt, out var end) && end > DateTimeOffset.UtcNow
        ? $" · {Format.Duration(end - DateTimeOffset.UtcNow)} left" : " · ending");
    public ImageSource? Art { get; } = Format.Avatar(c.GameArt.Replace("{width}", "52").Replace("{height}", "72"));
    public IReadOnlyList<DropItem> Drops { get; } = c.Drops.Select(d => new DropItem(d)).ToList();
}

public sealed class DropItem(Drop d)
{
    public string Name { get; } = d.Name;
    public double Percent { get; } = d.Required > 0 ? 100.0 * d.Minutes / d.Required : 0;
    public string Status { get; } = d.Claimed ? "Claimed" : d.Claimable ? "Ready to claim" : $"{Hm(d.Minutes)} / {Hm(d.Required)}";
    public bool Ready { get; } = d.Claimable;

    private static string Hm(int minutes) => minutes >= 60 ? $"{minutes / 60}h {minutes % 60:00}m" : $"{minutes}m";
}

/// <summary>A section heading in the Following list ("[ LIVE NOW · 3 ]").</summary>
public sealed record FollowHeader(string Text);

/// <summary>Live rows get the rich popup-style layout; offline rows stay compact; headers are headers.</summary>
public sealed partial class FollowTemplateSelector : Microsoft.UI.Xaml.Controls.DataTemplateSelector
{
    public DataTemplate? Header { get; set; }
    public DataTemplate? Live { get; set; }
    public DataTemplate? Offline { get; set; }

    protected override DataTemplate? SelectTemplateCore(object item) =>
        item switch
        {
            FollowHeader => Header,
            FollowItem { IsLive: true } => Live,
            _ => Offline,
        };

    protected override DataTemplate? SelectTemplateCore(object item, DependencyObject container) => SelectTemplateCore(item);
}

public static class Format
{
    public static string Compact(int n) => n >= 10_000 ? $"{n / 1000}K" : n >= 1000 ? $"{n / 1000.0:0.0}K" : n.ToString();

    public static string Duration(TimeSpan t) =>
        t.TotalMinutes < 60 ? $"{(int)t.TotalMinutes}m" : $"{(int)t.TotalHours}h {t.Minutes:00}m";

    public static ImageSource? Image(string url) => Uri.TryCreate(url, UriKind.Absolute, out var uri) ? new BitmapImage(uri) : null;

    // Avatars are shared by every list rebuild (each poll, each search keystroke); one decoded image per URL.
    // UI thread only. Profile pictures are small and few (one per followed channel), so no eviction.
    private static readonly Dictionary<string, ImageSource?> Avatars = [];
    public static ImageSource? Avatar(string url)
    {
        if (!Avatars.TryGetValue(url, out var image)) Avatars[url] = image = Image(url);
        return image;
    }

    // x:Bind helper
    public static Visibility Show(bool value) => value ? Visibility.Visible : Visibility.Collapsed;
}
