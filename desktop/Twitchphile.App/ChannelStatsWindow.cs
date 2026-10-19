using System.Diagnostics;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using Twitchphile.Core;

namespace Twitchphile.App;

/// <summary>
/// A channel's stats, from the Stats button on a live card: Twitch's facts (followers, past broadcasts, top clips)
/// plus the history this app records from its own live checks, as small native charts — the desktop twin of the
/// extension's channel-stats drawer, with the same one-click links to the big stats sites.
/// </summary>
internal sealed class ChannelStatsWindow : Window
{
    private static readonly Dictionary<string, ChannelStatsWindow> Open = [];
    private static readonly string[] Days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    private static readonly (string Name, string Url)[] Sites =
    [
        ("SullyGnome", "https://sullygnome.com/channel/{0}"),
        ("TwitchTracker", "https://twitchtracker.com/{0}"),
        ("StreamsCharts", "https://streamscharts.com/channels/{0}"),
        ("Chat stats", "https://stats.streamelements.com/c/{0}"),
        ("FrankerFaceZ", "https://www.frankerfacez.com/channel/{0}"),
        ("Chat logs", "https://logs.ivr.fi/?channel={0}"),
    ];

    private readonly StackPanel _body = new() { Spacing = 16, Padding = new Thickness(20, 8, 20, 24) };

    /// <summary>Opens (or brings forward) the stats window for a channel.</summary>
    public static void Show(App app, string login)
    {
        // Kick stats come from kick.com itself (the extension's drawer there); the app's view reads Twitch.
        if (Kick.IsKick(login))
        {
            _ = Windows.System.Launcher.LaunchUriAsync(new Uri(Kick.Url(login)));
            return;
        }
        if (Open.TryGetValue(login, out var existing))
        {
            existing.Activate();
            return;
        }
        var w = Open[login] = new ChannelStatsWindow(app, login);
        w.Closed += (_, _) => Open.Remove(login);
        w.Activate();
    }

    private ChannelStatsWindow(App app, string login)
    {
        Title = $"{login} — channel stats";
        SystemBackdrop = new MicaBackdrop();
        ExtendsContentIntoTitleBar = true;
        var titleBar = new TitleBar
        {
            Title = "Twitchphile",
            Subtitle = $"{login} · channel stats",
            IconSource = new ImageIconSource { ImageSource = new BitmapImage(new Uri("ms-appx:///Assets/twitchphile-icon.png")) },
        };
        var layout = new Grid { RowDefinitions = { new() { Height = GridLength.Auto }, new() { Height = new GridLength(1, GridUnitType.Star) } } };
        var scroller = new ScrollViewer { Content = _body };
        Grid.SetRow(scroller, 1);
        layout.Children.Add(titleBar);
        layout.Children.Add(scroller);
        Content = layout;
        SetTitleBar(titleBar);
        AppWindow.SetIcon(System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "twitchphile.ico"));
        var dpi = GetDpiForWindow(WinRT.Interop.WindowNative.GetWindowHandle(this)) / 96.0;
        AppWindow.Resize(new Windows.Graphics.SizeInt32((int)(520 * dpi), (int)(860 * dpi)));
        if (AppWindow.Presenter is OverlappedPresenter p) p.PreferredMinimumWidth = (int)(420 * dpi);

        _body.Children.Add(Caption("Loading…"));
        _ = LoadAsync(app, login);
    }

    private async Task LoadAsync(App app, string login)
    {
        ChannelInfo? info = null;
        int? followers = null;
        IReadOnlyList<PastBroadcast> vods = [];
        IReadOnlyList<ClipInfo> clips = [];
        try
        {
            info = await app.Helix.ChannelAsync(login);
            if (info is not null)
            {
                var f = app.Helix.FollowersAsync(info.Id);
                var v = app.Helix.PastBroadcastsAsync(info.Id);
                var c = app.Helix.TopClipsAsync(info.Id);
                await Task.WhenAll(f, v, c);
                (followers, vods, clips) = (f.Result, v.Result, c.Result);
            }
        }
        catch (Exception) { /* offline: show what's recorded */ }
        Render(login, info, followers, vods, clips, app.History.SessionsOf(login), app.History.FollowersOf(login));
    }

    private void Render(string login, ChannelInfo? info, int? followers, IReadOnlyList<PastBroadcast> vods, IReadOnlyList<ClipInfo> clips,
        IReadOnlyList<StreamSession> sessions, IReadOnlyList<(DateOnly Day, int Followers)> followerHistory)
    {
        _body.Children.Clear();
        var month = DateTimeOffset.UtcNow.AddDays(-30);

        // Header
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        if (info?.AvatarUrl is { Length: > 0 } avatar)
            header.Children.Add(new Ellipse { Width = 48, Height = 48, Fill = new ImageBrush { ImageSource = new BitmapImage(new Uri(avatar)) } });
        var who = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        who.Children.Add(new TextBlock { Text = info?.Name ?? login, Style = Res<Style>("SubtitleTextBlockStyle") });
        who.Children.Add(Caption(string.Join(" · ", new[] { info?.BroadcasterType is { Length: > 0 } t ? t : null, info is not null ? $"since {info.CreatedAt.Year}" : null }.Where(x => x is not null))));
        header.Children.Add(who);
        _body.Children.Add(header);

        // Links
        var links = new VariableSizedWrapGrid { Orientation = Orientation.Horizontal, ItemWidth = 118, ItemHeight = 34 };
        foreach (var (name, url) in Sites)
        {
            var b = new HyperlinkButton { Content = name, Padding = new Thickness(6, 2, 6, 2) };
            b.Click += (_, _) => Process.Start(new ProcessStartInfo(string.Format(url, Uri.EscapeDataString(login))) { UseShellExecute = true });
            links.Children.Add(b);
        }
        _body.Children.Add(links);

        // Tiles
        var recent = sessions.Where(s => s.Last >= month).ToList();
        var starts = vods.Select(v => v.CreatedAt).Concat(sessions.Select(s => s.Start))
            .GroupBy(d => d.ToUniversalTime().ToString("yyyy-MM-ddTHH")).Select(g => g.First()).ToList();
        var grid = ChannelHistory.StartHeatmap(starts);
        var weeks = HoursPerWeek(vods, sessions);
        var perWeek = weeks.Count > 0 ? weeks.TakeLast(4).Average(w => w.Hours) : (double?)null;
        var growth = followerHistory.Count >= 2 ? followerHistory[^1].Followers - followerHistory[0].Followers : (int?)null;
        var tiles = new Grid { ColumnSpacing = 8, RowSpacing = 8, ColumnDefinitions = { new(), new() }, RowDefinitions = { new(), new() } };
        AddTile(tiles, 0, 0, "FOLLOWERS", followers is { } fl ? Format.Compact(fl) : "—", growth is { } g ? $"{(g >= 0 ? "+" : "")}{Format.Compact(g)} since {followerHistory[0].Day:MMM d}" : "");
        AddTile(tiles, 0, 1, "AVG VIEWERS", recent.Count > 0 ? Format.Compact((int)recent.Average(s => s.Average)) : "—", recent.Count > 0 ? $"peak {Format.Compact(recent.Max(s => s.Peak))}" : "30 days");
        AddTile(tiles, 1, 0, "HOURS / WEEK", perWeek is { } pw ? pw.ToString("0.0") : "—", $"{starts.Count(d => d >= month)} streams in 30d");
        var usual = Usual(grid);
        AddTile(tiles, 1, 1, "USUALLY LIVE", usual is { } u ? new DateTime(2000, 1, 1, u.Hour, 0, 0).ToString("h tt") : "—", usual is { } u2 ? string.Join(" · ", u2.Days.Select(d => Days[d])) : "not enough data");
        _body.Children.Add(tiles);

        if (info is null) _body.Children.Add(Caption("Sign in (Connect) to see followers, past broadcasts and clips. Recorded history still shows."));

        Section("VIEWERS PER STREAM", sessions.Count > 0
            ? Bars(sessions.TakeLast(24).Select(s => ((double)s.Average, $"{s.Start.ToLocalTime():MMM d} · avg {Format.Compact(s.Average)}, peak {Format.Compact(s.Peak)} · {Format.Duration(TimeSpan.FromMinutes(s.Minutes))}")).ToList())
            : Caption("Recording starts with their next stream (the app records live favorites and follows while it runs)."));
        Section("HOURS STREAMED PER WEEK", weeks.Count > 0
            ? Bars(weeks.TakeLast(10).Select(w => (w.Hours, $"Week of {w.Start:MMM d}: {w.Hours:0.0}h")).ToList())
            : Caption("No past broadcasts to go on."));
        Section("WHEN THEY GO LIVE (YOUR TIME)", starts.Count > 0 ? Heatmap(grid) : Caption("No stream starts known yet."));

        var games = sessions.SelectMany(s => s.Games).GroupBy(kv => kv.Key).Select(g => (Game: g.Key, Minutes: g.Sum(kv => kv.Value))).OrderByDescending(x => x.Minutes).Take(6).ToList();
        if (games.Count > 0) Section("WHAT THEY PLAY", Categories(games));
        if (followerHistory.Count >= 2) Section($"FOLLOWERS · {followerHistory.Count} DAYS", Spark(followerHistory.Select(f => (double)f.Followers).ToList()));

        if (clips.Count > 0)
        {
            var list = new StackPanel { Spacing = 2 };
            foreach (var c in clips)
            {
                var b = new HyperlinkButton { Content = $"{c.Title}  ·  {Format.Compact(c.Views)} views", Padding = new Thickness(0) };
                b.Click += (_, _) => Process.Start(new ProcessStartInfo(c.Url) { UseShellExecute = true });
                list.Children.Add(b);
            }
            Section("TOP CLIPS · 30 DAYS", list);
        }
    }

    // ---- Pieces

    private void Section(string title, UIElement content)
    {
        _body.Children.Add(new StackPanel
        {
            Spacing = 6,
            Children = { new TextBlock { Text = title, Style = Res<Style>("CaptionTextBlockStyle"), Foreground = Res<Brush>("TextFillColorTertiaryBrush"), CharacterSpacing = 60 }, content },
        });
    }

    private static TextBlock Caption(string text) =>
        new() { Text = text, TextWrapping = TextWrapping.Wrap, Foreground = Res<Brush>("TextFillColorSecondaryBrush"), Style = Res<Style>("CaptionTextBlockStyle") };

    private static void AddTile(Grid grid, int row, int col, string label, string value, string sub)
    {
        var card = Card(new StackPanel
        {
            Spacing = 2,
            Children =
            {
                new TextBlock { Text = label, Style = Res<Style>("CaptionTextBlockStyle"), Foreground = Res<Brush>("TextFillColorTertiaryBrush") },
                new TextBlock { Text = value, Style = Res<Style>("SubtitleTextBlockStyle") },
                new TextBlock { Text = sub, Style = Res<Style>("CaptionTextBlockStyle"), Foreground = Res<Brush>("TextFillColorSecondaryBrush"), TextWrapping = TextWrapping.Wrap },
            },
        });
        Grid.SetRow(card, row);
        Grid.SetColumn(card, col);
        grid.Children.Add(card);
    }

    private static Border Card(UIElement child) => new()
    {
        Padding = new Thickness(12, 10, 12, 10),
        CornerRadius = new CornerRadius(8),
        BorderThickness = new Thickness(1),
        BorderBrush = Res<Brush>("CardStrokeColorDefaultBrush"),
        Background = Res<Brush>("CardBackgroundFillColorDefaultBrush"),
        Child = child,
    };

    // Bottom-aligned bars, one per value, hover for the details.
    private static Border Bars(IReadOnlyList<(double Value, string Tip)> values)
    {
        var max = Math.Max(values.Max(v => v.Value), 1);
        var grid = new Grid { Height = 90, ColumnSpacing = 3 };
        for (var i = 0; i < values.Count; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition());
            var bar = new Border
            {
                Height = Math.Max(2, values[i].Value / max * 86),
                VerticalAlignment = VerticalAlignment.Bottom,
                CornerRadius = new CornerRadius(2, 2, 0, 0),
                Background = Res<Brush>("AccentFillColorDefaultBrush"),
                Opacity = 0.8,
            };
            ToolTipService.SetToolTip(bar, values[i].Tip);
            Grid.SetColumn(bar, i);
            grid.Children.Add(bar);
        }
        return Card(grid);
    }

    private static Border Heatmap(int[,] cells)
    {
        var max = 1;
        foreach (var n in cells) max = Math.Max(max, n);
        var grid = new Grid { ColumnSpacing = 2, RowSpacing = 2 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(28) });
        for (var h = 0; h < 24; h++) grid.ColumnDefinitions.Add(new ColumnDefinition());
        for (var d = 0; d < 7; d++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(12) });
            var label = new TextBlock { Text = Days[d], FontSize = 10, Foreground = Res<Brush>("TextFillColorTertiaryBrush") };
            Grid.SetRow(label, d);
            grid.Children.Add(label);
            for (var h = 0; h < 24; h++)
            {
                var n = cells[d, h];
                var cell = new Border
                {
                    CornerRadius = new CornerRadius(2),
                    Background = n > 0 ? Res<Brush>("AccentFillColorDefaultBrush") : Res<Brush>("ControlFillColorSecondaryBrush"),
                    Opacity = n > 0 ? 0.25 + 0.75 * n / max : 1,
                };
                ToolTipService.SetToolTip(cell, $"{Days[d]} {new DateTime(2000, 1, 1, h, 0, 0):h tt}: {n} start{(n == 1 ? "" : "s")}");
                Grid.SetRow(cell, d);
                Grid.SetColumn(cell, h + 1);
                grid.Children.Add(cell);
            }
        }
        return Card(grid);
    }

    private static StackPanel Categories(IReadOnlyList<(string Game, double Minutes)> games)
    {
        var total = games.Sum(g => g.Minutes);
        var panel = new StackPanel { Spacing = 6 };
        foreach (var (game, minutes) in games)
        {
            var row = new Grid { ColumnSpacing = 8, ColumnDefinitions = { new() { Width = new GridLength(150) }, new(), new() { Width = new GridLength(40) } } };
            var name = new TextBlock { Text = game, TextTrimming = TextTrimming.CharacterEllipsis };
            var bar = new ProgressBar { Value = minutes / total * 100, VerticalAlignment = VerticalAlignment.Center };
            var pct = new TextBlock { Text = $"{minutes / total:P0}", HorizontalAlignment = HorizontalAlignment.Right, Foreground = Res<Brush>("TextFillColorSecondaryBrush") };
            Grid.SetColumn(bar, 1);
            Grid.SetColumn(pct, 2);
            row.Children.Add(name);
            row.Children.Add(bar);
            row.Children.Add(pct);
            panel.Children.Add(row);
        }
        return panel;
    }

    private static Border Spark(IReadOnlyList<double> points)
    {
        double lo = points.Min(), hi = points.Max(), span = Math.Max(hi - lo, 1);
        var line = new Polyline { Stroke = Res<Brush>("AccentFillColorDefaultBrush"), StrokeThickness = 2 };
        for (var i = 0; i < points.Count; i++) line.Points.Add(new Windows.Foundation.Point(i * 400.0 / (points.Count - 1), 56 - (points[i] - lo) / span * 52));
        return Card(new Viewbox { Height = 60, Stretch = Stretch.Fill, Child = new Canvas { Width = 400, Height = 60, Children = { line } } });
    }

    // ---- Numbers

    private sealed record Week(DateTime Start, double Hours);

    private static List<Week> HoursPerWeek(IReadOnlyList<PastBroadcast> vods, IReadOnlyList<StreamSession> sessions)
    {
        static DateTime WeekOf(DateTimeOffset t)
        {
            var d = t.ToLocalTime().Date;
            return d.AddDays(-(((int)d.DayOfWeek + 6) % 7));
        }
        var byWeek = new Dictionary<DateTime, double>();
        var vodHours = vods.Select(v => v.CreatedAt.ToUniversalTime().ToString("yyyy-MM-ddTHH")).ToHashSet();
        foreach (var v in vods) byWeek[WeekOf(v.CreatedAt)] = byWeek.GetValueOrDefault(WeekOf(v.CreatedAt)) + v.Minutes;
        foreach (var s in sessions.Where(s => !vodHours.Contains(s.Start.ToUniversalTime().ToString("yyyy-MM-ddTHH"))))
            byWeek[WeekOf(s.Start)] = byWeek.GetValueOrDefault(WeekOf(s.Start)) + s.Minutes;
        if (byWeek.Count == 0) return [];
        var weeks = new List<Week>();
        for (var w = byWeek.Keys.Min(); w <= WeekOf(DateTimeOffset.Now); w = w.AddDays(7)) weeks.Add(new Week(w, byWeek.GetValueOrDefault(w) / 60));
        return weeks;
    }

    // "Usually live around 7 PM on Tue · Thu", from the busiest cells; null with too little data.
    private static (int Hour, List<int> Days)? Usual(int[,] grid)
    {
        var total = 0;
        foreach (var n in grid) total += n;
        if (total < 4) return null;
        var byDay = Enumerable.Range(0, 7).Select(d => Enumerable.Range(0, 24).Sum(h => grid[d, h])).ToList();
        var byHour = Enumerable.Range(0, 24).Select(h => Enumerable.Range(0, 7).Sum(d => grid[d, h])).ToList();
        var days = Enumerable.Range(0, 7).Where(d => byDay[d] >= Math.Max(2, total * 0.15)).ToList();
        return (byHour.IndexOf(byHour.Max()), days);
    }

    private static T Res<T>(string key) => (T)Application.Current.Resources[key];

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(nint hwnd);
}
