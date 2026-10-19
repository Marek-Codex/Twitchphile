using System.Net.Sockets;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using Microsoft.Windows.AppNotifications;
using Twitchphile.App.Interop;
using Twitchphile.App.Services;
using Twitchphile.Core;

namespace Twitchphile.App;

/// <summary>Composition root: builds the services once, wires them to the window, tray and notifications.</summary>
public partial class App : Application
{
    private readonly bool _startHidden;
    private TrayIcon? _tray;
    private MainWindow? _window;

    // Runs once, before any instance field initializer, so the favorites ChannelList below loads the
    // migrated file. Spelling pass (British → American): an older install stored favorites in
    // "favourites.json"; move it to "favorites.json" so nobody loses their list across the rename.
    static App() => MigrateLegacyFiles();

    private static void MigrateLegacyFiles()
    {
        try
        {
            var oldFavorites = Paths.File("favourites.json");
            var newFavorites = Paths.File("favorites.json");
            if (File.Exists(oldFavorites) && !File.Exists(newFavorites)) File.Move(oldFavorites, newFavorites);
        }
        catch (IOException) { /* leave it; the app just starts with an empty list */ }
    }

    internal static readonly HttpClient Http = new() { DefaultRequestHeaders = { { "User-Agent", "PlexusTwitchphile" } } };
    internal AppSettings Settings { get; } = AppSettings.Load();
    internal TwitchAuth Auth { get; }
    internal Helix Helix { get; }
    internal ChannelList favorites { get; } = new(Paths.File("favorites.json"));
    internal ChannelList Hidden { get; } = new(Paths.File("hidden.json"));
    internal ChannelHistory History { get; } = new(Paths.File("history.json"));
    internal LiveWatcher Watcher { get; }
    internal PairingListener Pairing { get; }
    internal Notifier Notifier { get; } = new(Http);

    public App(bool startHidden)
    {
        _startHidden = startHidden;
        Auth = new TwitchAuth(Http, new SessionStore());
        Helix = new Helix(Http, Auth);
        Watcher = new LiveWatcher(Helix, new Kick(Http))
        {
            // Kick channels: "kick/name" favorites plus the Kick follows the extension handed over.
            KickChannels = () => favorites.Current.Logins.Where(Kick.IsKick).Concat(_kickFollows),
        };
        Pairing = new PairingListener(favorites, Auth, hidden: Hidden) { Token = PairingToken.Load(), Version = typeof(App).Assembly.GetName().Version?.ToString(3) ?? "0" };
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        // WebView2 (the inline player): keep its profile with our data. Twitch's embed owns playback UI;
        // don't override the browser's autoplay policy globally.
        Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", Paths.File("webview"));

        UrlScheme.Register();
        var window = _window = new MainWindow(this);
        var ui = window.DispatcherQueue;

        Pairing.PairRequested = origin => window.ConfirmPairingAsync(origin);
        Pairing.Paired += PairingToken.Save;
        try { Pairing.Start(); }
        catch (SocketException) { window.SetFooter("Port 9616 is in use — extension sync is off."); }

        // A second instance (e.g. a twitchphile: link opened while we're already running) is redirected here by
        // Program.cs; handle it on the UI thread just like a fresh activation, so the window comes forward.
        AppInstance.GetCurrent().Activated += (_, e) => ui.TryEnqueue(() => Activate(e));

        // Packaged "start with Windows" state is only known once Windows answers, so read it back async and
        // refresh the toggle (unpackaged reads the registry synchronously, so this is a no-op there).
        _ = Startup.RefreshAsync().ContinueWith(_ => ui.TryEnqueue(window.RefreshStartupToggle), TaskContinuationOptions.OnlyOnRanToCompletion);

        Watcher.Updated += live => ui.TryEnqueue(() => window.ShowLive(live));
        Watcher.Updated += live => _ = RecordHistoryAsync(live); // background thread; history is thread-safe
        // The last drop progress survives restarts, so the tab isn't empty until a Twitch tab reports again.
        if (Protected.Read<DropsState>(Paths.File("drops.bin")) is { } saved) window.ShowDrops(saved);
        Pairing.DropsUpdated += d =>
        {
            Protected.Write(Paths.File("drops.bin"), d);
            ui.TryEnqueue(() => window.ShowDrops(d));
        };
        Pairing.KickFollowsUpdated += follows =>
        {
            var changed = !follows.SequenceEqual(_kickFollows);
            _kickFollows = follows;
            try { File.WriteAllText(Paths.File("kick-follows.json"), System.Text.Json.JsonSerializer.Serialize(follows)); }
            catch (IOException) { }
            if (changed) _ = Watcher.PollAsync().ContinueWith(_ => { }, TaskContinuationOptions.OnlyOnFaulted);
        };
        Watcher.WentLive += s =>
        {
            if (Settings.Notifications && favorites.Contains(s.Login)) _ = Notifier.ShowWentLiveAsync(s, Settings.PriorityNotifications);
        };
        Notifier.WatchRequested += login => ui.TryEnqueue(() => window.Watch(login));
        Auth.SessionChanged += () => ui.TryEnqueue(OnSessionChanged);

        // A second launch (or a notification clicked while running) lands here.
        AppInstance.GetCurrent().Activated += (_, e) => ui.TryEnqueue(() => Activate(e));

        _tray = new TrayIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "twitchphile.ico"), "Twitchphile");
        _tray.Activated += () => ui.TryEnqueue(window.ShowAndFocus);
        _tray.AddMenuItem("Open Twitchphile", () => ui.TryEnqueue(window.ShowAndFocus));
        _tray.AddMenuItem("Check now", () => Watcher.PollAsync().ContinueWith(_ => { }, TaskContinuationOptions.OnlyOnFaulted));
        _tray.AddSeparator();
        _tray.AddMenuItem("Quit", () => ui.TryEnqueue(Quit));

        OnSessionChanged();
        Activate(AppInstance.GetCurrent().GetActivatedEventArgs(), launching: true);
    }

    private void Activate(AppActivationArguments e, bool launching = false)
    {
        // Launched by clicking a notification while the app wasn't running.
        if (e.Kind == ExtendedActivationKind.AppNotification && e.Data is AppNotificationActivatedEventArgs n && n.Arguments.TryGetValue("login", out var login))
            _window!.Watch(login);
        // A twitchphile: link (the extension's "Start app" button, when installed from an MSIX). The link
        // carries no instructions — opening it just starts or shows the app.
        else if (e.Kind == ExtendedActivationKind.Protocol)
            _window!.ShowAndFocus();
        else if (!(launching && _startHidden))
            _window!.ShowAndFocus();
    }

    private string? _watchingUser;

    private void OnSessionChanged()
    {
        _window!.ShowSignedIn(Auth.Session);
        var user = Auth.Session?.UserId;
        // Token refreshes also raise SessionChanged; only a different account needs a new baseline and restart.
        // Signed out still polls: Kick channels need no Twitch sign-in (the Twitch part is just empty).
        if (_watchStarted && user == _watchingUser) return;
        _watchStarted = true;
        _watchingUser = user;
        Watcher.ResetBaseline();
        StartWatching();
    }

    private bool _watchStarted;
    private IReadOnlyList<string> _kickFollows = LoadKickFollows();
    internal IReadOnlyList<string> KickFollows => _kickFollows;

    private static IReadOnlyList<string> LoadKickFollows()
    {
        try { return System.Text.Json.JsonSerializer.Deserialize<List<string>>(File.ReadAllText(Paths.File("kick-follows.json"))) ?? []; }
        catch (Exception e) when (e is IOException or System.Text.Json.JsonException) { return []; }
    }

    // Each live check feeds the channel history; follower counts are read once a day per channel (a few per check).
    private async Task RecordHistoryAsync(IReadOnlyList<LiveStream> live)
    {
        History.Record(live, DateTimeOffset.UtcNow);
        var today = DateOnly.FromDateTime(DateTime.Today);
        foreach (var s in live.Where(s => s.UserId.Length > 0 && History.NeedsFollowers(s.Login, today)).Take(20)) // Twitch only
        {
            try
            {
                if (await Helix.FollowersAsync(s.UserId) is { } n) History.RecordFollowers(s.Login, n, today);
            }
            catch (Exception) { /* offline: try again next check */ }
        }
    }

    /// <summary>(Re)starts polling at the interval from settings; also polls right away.</summary>
    internal void StartWatching()
    {
        Watcher.Start(TimeSpan.FromMinutes(Math.Clamp(Settings.PollMinutes, 1, 15)));
    }

    /// <summary>Updates the tray tooltip, e.g. "Twitchphile — 3 favorites live".</summary>
    internal void SetTrayStatus(int favoritesLive) =>
        _tray?.SetTooltip(favoritesLive == 0 ? "Twitchphile" : $"Twitchphile — {favoritesLive} favorite{(favoritesLive == 1 ? "" : "s")} live");

    internal void Quit()
    {
        _tray?.Dispose();
        Pairing.Dispose();
        Watcher.Dispose();
        Notifier.Dispose();
        _window?.Destroy();
        Exit();
    }
}
