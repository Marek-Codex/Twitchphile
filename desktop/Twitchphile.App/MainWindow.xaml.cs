using System.Collections.ObjectModel;
using System.Diagnostics;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Twitchphile.App.Services;
using Twitchphile.Core;

namespace Twitchphile.App;

public sealed partial class MainWindow : Window
{
    // Card content width is ~(window − padding); 16:9 of that. Fixed so the XAML can bind it.
    public static double PlayerHeight => 214;

    private readonly App _app;
    private readonly ObservableCollection<LiveItem> _live = [];
    private readonly ObservableCollection<object> _following = []; // FollowHeader | FollowItem
    private IReadOnlyList<Channel> _channels = [];
    private IReadOnlyList<LiveStream> _liveNow = [];
    private LiveItem? _expanded;
    private WebView2? _player;
    private string? _verificationUri;
    private CancellationTokenSource? _signIn;
    private bool _quitting;
    private bool _loadingSettings;
    private DateTime _checkedAt;
    private bool _footerIsLive;
    private bool _showHidden;
    private bool _windowVisible;
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _ticker;
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _searchTimer;

    public MainWindow(App app)
    {
        _app = app;
        InitializeComponent();

        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "twitchphile.ico"));
        AppWindow.Resize(new Windows.Graphics.SizeInt32(460, 780));
        if (AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.PreferredMinimumWidth = 380;
            presenter.PreferredMinimumHeight = 480;
        }
        AppWindow.Closing += (_, e) =>
        {
            if (_quitting || !_app.Settings.CloseToTray) return;
            e.Cancel = true; // keep watching from the tray
            Collapse();
            _windowVisible = false;
            AppWindow.Hide();
        };
        Closed += (_, _) => { if (!_quitting) _app.Quit(); };

        LiveList.ItemsSource = _live;
        FollowList.ItemsSource = _following;
        _app.favorites.Changed += _ => DispatcherQueue.TryEnqueue(() => { ShowLive(_liveNow, rebuildFollowing: false); UpdateStars(); });
        _app.Hidden.Changed += _ => DispatcherQueue.TryEnqueue(RefreshFollowing);
        LoadSettings();
        UpdatePairingText();
        _ticker = DispatcherQueue.CreateTimer();
        _ticker.Interval = TimeSpan.FromSeconds(30);
        _ticker.Tick += (_, _) => OnTick();
        _ticker.Start();
        _searchTimer = DispatcherQueue.CreateTimer();
        _searchTimer.Interval = TimeSpan.FromMilliseconds(180);
        _searchTimer.IsRepeating = false;
        _searchTimer.Tick += (_, _) => RefreshFollowing();
        _app.Pairing.Paired += _ => DispatcherQueue.TryEnqueue(UpdatePairingText);
    }

    // ---- Window

    public void ShowAndFocus()
    {
        _windowVisible = true;
        AppWindow.Show();
        Activate();
        SchedulePlayerWarmup();
    }

    public void Destroy()
    {
        _quitting = true;
        Close();
    }

    public void SetFooter(string text)
    {
        Footer.Text = text;
        _footerIsLive = false;
    }

    // ---- Views

    // The one place that decides which panel shows. The panels share a grid cell, so an invisible-but-visible
    // one on top would swallow clicks meant for the one below.
    private void UpdatePanels()
    {
        var signedIn = _app.Auth.IsSignedIn;
        var following = Views.SelectedItem == FollowingTab;
        // Drops come from the extension's twitch.tv session, so that tab works without the app's sign-in.
        var drops = Views.SelectedItem == DropsTab;
        SignInPanel.Visibility = signedIn || drops ? Visibility.Collapsed : Visibility.Visible;
        LivePanel.Visibility = signedIn && !following && !drops ? Visibility.Visible : Visibility.Collapsed;
        FollowingPanel.Visibility = signedIn && following ? Visibility.Visible : Visibility.Collapsed;
        DropsPanel.Visibility = drops ? Visibility.Visible : Visibility.Collapsed;
    }

    private void Views_SelectionChanged(SelectorBar sender, SelectorBarSelectionChangedEventArgs args)
    {
        UpdatePanels();
        if (LivePanel.Visibility != Visibility.Visible) Collapse(); // don't keep a stream playing out of sight
        else SchedulePlayerWarmup();
        if (FollowingPanel.Visibility == Visibility.Visible)
        {
            if (_channels.Count == 0) _ = LoadFollowingAsync();
            else RefreshFollowing();
        }
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e)
    {
        RefreshButton.IsEnabled = false;
        try
        {
            await _app.Watcher.PollAsync();
            if (FollowingPanel.Visibility == Visibility.Visible) await LoadFollowingAsync();
        }
        // async void: anything uncaught here takes the whole app down (a timeout is a TaskCanceledException).
        catch (Exception) { SetFooter("Couldn't reach Twitch. Check your connection."); }
        finally { RefreshButton.IsEnabled = true; }
    }

    // ---- Sign-in

    public void ShowSignedIn(TwitchSession? session)
    {
        var signedIn = session is not null;
        UpdatePanels();
        RefreshButton.IsEnabled = signedIn;
        AccountText.Text = !signedIn ? "Not signed in"
            : _app.Auth.IsBorrowed ? $"{session!.Login} (borrowed from the extension)"
            : $"Signed in as {session!.Login}";
        SignOutButton.Visibility = signedIn ? Visibility.Visible : Visibility.Collapsed;
        if (!signedIn)
        {
            _live.Clear();
            _following.Clear();
            _channels = [];
            CodePanel.Visibility = Visibility.Collapsed;
            ConnectButton.IsEnabled = true;
        }
    }

    private async void Connect_Click(object sender, RoutedEventArgs e)
    {
        ConnectButton.IsEnabled = false;
        _signIn = new CancellationTokenSource();
        try
        {
            await _app.Auth.SignInAsync(code =>
            {
                CodeText.Text = code.UserCode;
                _verificationUri = code.VerificationUri;
                SignInStatus.Text = "Waiting for you to approve…";
                CodePanel.Visibility = Visibility.Visible;
                SignInBadge.Text = "WAITING";
                Open(code.VerificationUri); // the code is pre-filled in this link
            }, _signIn.Token);
            SignInBadge.Text = "NOT CONNECTED";
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            SignInStatus.Text = ex.Message;
            SignInBadge.Text = "NOT CONNECTED";
            ConnectButton.IsEnabled = true;
        }
    }

    private void OpenActivate_Click(object sender, RoutedEventArgs e) => Open(_verificationUri ?? "https://www.twitch.tv/activate");

    private void SignOut_Click(object sender, RoutedEventArgs e) => _app.Auth.SignOut();

    // ---- Live

    /// <summary>Syncs the Live view to the latest poll, updating cards in place so an open player keeps playing.</summary>
    public void ShowLive(IReadOnlyList<LiveStream> live, bool rebuildFollowing = true)
    {
        if (!_app.Auth.IsSignedIn) return; // e.g. favorites synced from the extension before you've connected
        _liveNow = live;
        var favorites = live.Where(s => _app.favorites.Contains(s.Login)).OrderByDescending(s => s.Viewers).ToList();
        var wanted = favorites.Select(s => s.Login).ToHashSet();

        foreach (var gone in _live.Where(i => !wanted.Contains(i.Login)).ToList())
        {
            if (gone == _expanded) Collapse();
            _live.Remove(gone);
        }
        foreach (var s in favorites)
        {
            var item = _live.FirstOrDefault(i => i.Login == s.Login);
            if (item is null) _live.Add(item = new LiveItem(s.Login));
            item.Update(s);
        }

        LiveEmpty.Visibility = _live.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        LiveEmptyText.Text = _app.favorites.Current.Logins.Count == 0
            ? "No favorites yet. Star channels in Following and they'll show up here when they go live."
            : "None of your favorites are live right now.";
        _app.SetTrayStatus(_live.Count);
        SchedulePlayerWarmup();
        if (rebuildFollowing) _checkedAt = DateTime.Now; // a real poll, not a local favorites change
        ShowLiveFooter();
        if (rebuildFollowing && FollowingPanel.Visibility == Visibility.Visible) RefreshFollowing();
    }

    private void ShowLiveFooter()
    {
        var ago = (DateTime.Now - _checkedAt).TotalMinutes < 1 ? "just now" : $"{Format.Duration(DateTime.Now - _checkedAt)} ago";
        SetFooter($"{_live.Count} favorite{(_live.Count == 1 ? "" : "s")} live · checked {ago}");
        _footerIsLive = true;
    }

    // Uptimes and "checked … ago" keep moving between polls.
    private void OnTick()
    {
        foreach (var item in _live) item.Tick();
        if (_footerIsLive && _checkedAt != default) ShowLiveFooter();
    }

    private void LiveList_ItemClick(object sender, ItemClickEventArgs e)
    {
        var item = (LiveItem)e.ClickedItem;
        if (item == _expanded) Collapse();
        else _ = ExpandAsync(item);
    }

    /// <summary>Watch a channel from a notification: show the window, switch to Live and open its player.</summary>
    public void Watch(string login)
    {
        ShowAndFocus();
        Views.SelectedItem = LiveTab;
        var item = _live.FirstOrDefault(i => i.Login == login);
        if (item is not null) _ = ExpandAsync(item);
        else Open(Kick.Url(login)); // not a live favorite (yet) — fall back to the browser
    }

    // One player, kept alive. Starting WebView2 (a whole browser engine) and Twitch's player from scratch on every click
    // is what made opening a stream slow; instead it's warmed up once, waits invisibly in a 1×1 spot, moves into the
    // card you open, and switches channel in place (player.html: play/stop). Collapsing pauses it, so nothing plays
    // or downloads out of sight.
    private Task<bool>? _playerReady;
    private Border? _parking;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _warmupTimer;

    // Start only the browser shell and embed script while the user is looking at live cards.
    // The stream itself is still requested only after a click.
    private void SchedulePlayerWarmup()
    {
        if (!_windowVisible || LivePanel.Visibility != Visibility.Visible || _live.Count == 0 || _playerReady is not null) return;
        _warmupTimer ??= DispatcherQueue.CreateTimer();
        _warmupTimer.Interval = TimeSpan.FromMilliseconds(400);
        _warmupTimer.IsRepeating = false;
        _warmupTimer.Tick -= WarmupTimer_Tick;
        _warmupTimer.Tick += WarmupTimer_Tick;
        _warmupTimer.Start();
    }

    private void WarmupTimer_Tick(Microsoft.UI.Dispatching.DispatcherQueueTimer sender, object args)
    {
        if (_windowVisible && LivePanel.Visibility == Visibility.Visible && _live.Count > 0) _ = WarmPlayerAsync();
    }

    /// <summary>Starts the shared player (once). Safe to call early: done when a favorite is live, before any click.</summary>
    private Task<bool> WarmPlayerAsync() => _playerReady ??= StartPlayerAsync();

    private async Task<bool> StartPlayerAsync()
    {
        // WebView2 needs to be in the visual tree to start; park it in a 1×1 invisible spot.
        if (_parking is null)
        {
            _parking = new Border { Width = 1, Height = 1, Opacity = 0, IsHitTestVisible = false, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top };
            ((Panel)Content).Children.Add(_parking);
        }
        var player = _player = new WebView2();
        _parking.Child = player;
        try
        {
            await player.EnsureCoreWebView2Async();
            // Twitch's embed requires an https parent domain, so serve the host page from a virtual one.
            player.CoreWebView2.SetVirtualHostNameToFolderMapping("twitchphile.local", Path.Combine(AppContext.BaseDirectory, "Assets"), CoreWebView2HostResourceAccessKind.Allow);
            var loaded = new TaskCompletionSource<bool>();
            player.CoreWebView2.NavigationCompleted += (_, e) => loaded.TrySetResult(e.IsSuccess);
            player.Source = new Uri("https://twitchphile.local/player.html");
            return await loaded.Task;
        }
        catch (Exception)
        {
            if (player.Parent is Border b) b.Child = null;
            player.Close();
            _player = null;
            _playerReady = null; // let a later click try again
            SetFooter("Couldn't start the player (is the WebView2 runtime installed?).");
            return false;
        }
    }

    private async Task ExpandAsync(LiveItem item)
    {
        _warmupTimer?.Stop();
        _releaseTimer?.Stop();
        Collapse();
        _releaseTimer?.Stop(); // Collapse parks the previous player; this click takes ownership of it.
        _expanded = item;
        item.IsExpanded = true;
        LiveList.ScrollIntoView(item);
        await Task.Yield(); // let the expanded template realize
        if (LiveList.ContainerFromItem(item) is not ListViewItem { ContentTemplateRoot: FrameworkElement root } ||
            root.FindName("PlayerHost") is not Border host) return;

        if (!await WarmPlayerAsync() || _expanded != item || _player is null) return; // failed, or collapsed meanwhile
        MovePlayer(host);
        await _player.CoreWebView2.ExecuteScriptAsync($"play({System.Text.Json.JsonSerializer.Serialize(item.Login)})");
    }

    // Warm on hover: moving the mouse over the live cards starts the player (the second or so before you click is
    // usually enough), so it costs nothing until you look like you might watch.
    private void LiveList_PointerEntered(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e)
    {
        _releaseTimer?.Stop();
        if (_live.Count > 0 && _windowVisible) _ = WarmPlayerAsync();
    }

    // …and handed back a few minutes after you stop watching, so the memory really returns.
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _releaseTimer;
    private static readonly TimeSpan ReleaseAfter = TimeSpan.FromMinutes(3);

    private void ScheduleRelease()
    {
        _releaseTimer ??= DispatcherQueue.CreateTimer();
        _releaseTimer.Interval = ReleaseAfter;
        _releaseTimer.IsRepeating = false;
        _releaseTimer.Tick -= ReleasePlayer;
        _releaseTimer.Tick += ReleasePlayer;
        _releaseTimer.Start();
    }

    private void ReleasePlayer(Microsoft.UI.Dispatching.DispatcherQueueTimer sender, object args)
    {
        if (_expanded is not null || _player is null) return; // watching again: keep it
        if (_player.Parent is Border b) b.Child = null;
        _player.Close();
        _player = null;
        _playerReady = null;
    }

    private void MovePlayer(Border to)
    {
        if (_player is null || _player.Parent == to) return;
        if (_player.Parent is Border from) from.Child = null; // the old row may already be recycled
        to.Child = _player;
    }

    private void Collapse()
    {
        if (_player?.CoreWebView2 is not null)
        {
            _ = _player.CoreWebView2.ExecuteScriptAsync("stop()");
            if (_parking is not null) MovePlayer(_parking);
            ScheduleRelease();
        }
        if (_expanded is not null) _expanded.IsExpanded = false;
        _expanded = null;
    }

    private void OpenChannel_Click(object sender, RoutedEventArgs e) => Open(Kick.Url(Tag(sender)));
    private void OpenChat_Click(object sender, RoutedEventArgs e) => new ChatWindow(Tag(sender)).Activate();
    private void OpenVods_Click(object sender, RoutedEventArgs e) => Open(Kick.Url(Tag(sender), "/videos"));
    private void OpenClips_Click(object sender, RoutedEventArgs e) => Open(Kick.Url(Tag(sender), "/clips"));
    // Stats: the channel-stats window (Twitch's facts, recorded history, charts, and links to the big stats sites).
    private void OpenStats_Click(object sender, RoutedEventArgs e) => ChannelStatsWindow.Show(_app, Tag(sender));

    private static string Tag(object sender) => (string)((FrameworkElement)sender).Tag;

    // ---- Drops

    public void ShowDrops(DropsState state)
    {
        var campaigns = state.Campaigns.Where(c => c.Drops.Count > 0).Select(c => new DropCampaignItem(c)).ToList();
        DropsList.ItemsSource = campaigns;
        DropsEmpty.Visibility = campaigns.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        if (campaigns.Count == 0) DropsEmptyText.Text = "No drop campaigns in progress.";
        var ready = campaigns.Sum(c => c.Drops.Count(d => d.Ready));
        DropsTab.Text = ready > 0 ? $"Drops ({ready})" : "Drops";
    }

    // ---- Following

    private async Task LoadFollowingAsync()
    {
        try
        {
            SetFooter("Loading who you follow…");
            var twitch = await _app.Helix.FollowedChannelsAsync();
            // Kick follows (synced from the paired extension) join the same list — Twitch-first, but Kick channels
            // show up here too when you happen to be following someone over there.
            var kick = _app.KickFollows.Select(s => new Channel("", s, Kick.Slug(s))).ToList();
            _channels = [.. twitch, .. kick];
            RefreshFollowing();
            SetFooter($"You follow {_channels.Count} channels");
        }
        catch (Exception) { SetFooter("Couldn't load who you follow."); }
    }

    private void RefreshFollowing()
    {
        if (_channels.Count == 0) return;
        var live = _liveNow.ToDictionary(s => s.Login);
        var query = SearchBox.Text.Trim();
        IEnumerable<Channel> rows = _channels.Where(c => (_showHidden || !_app.Hidden.Contains(c.Login)) &&
                                                         (query.Length == 0 || c.Name.Contains(query, StringComparison.OrdinalIgnoreCase)));
        rows = _app.Settings.FollowSort switch
        {
            FollowSort.Name => rows.OrderBy(c => c.Name, StringComparer.OrdinalIgnoreCase),
            FollowSort.RecentlyFollowed => rows.OrderByDescending(c => c.FollowedAt),
            _ => rows.OrderByDescending(c => live.TryGetValue(c.Login, out var s) ? s.Viewers : -1).ThenBy(c => c.Name, StringComparer.OrdinalIgnoreCase),
        };

        var items = rows.Select(c =>
        {
            var item = new FollowItem(c) { Isfavorite = _app.favorites.Contains(c.Login), IsHidden = _app.Hidden.Contains(c.Login) };
            item.SetLive(live.GetValueOrDefault(c.Login));
            return item;
        }).ToList();

        _following.Clear();
        if (_app.Settings.FollowSort != FollowSort.LiveFirst)
        {
            items.ForEach(_following.Add);
            return;
        }
        // Live first, grouped like the extension popup: favorites lead each group.
        AddGroup("LIVE NOW", items.Where(i => i.IsLive).OrderByDescending(i => i.Isfavorite));
        AddGroup("OFFLINE", items.Where(i => !i.IsLive).OrderByDescending(i => i.Isfavorite));
    }

    private void AddGroup(string title, IEnumerable<FollowItem> group)
    {
        var list = group.ToList();
        if (list.Count == 0) return;
        _following.Add(new FollowHeader($"[ {title} · {list.Count} ]"));
        list.ForEach(_following.Add);
    }

    private void UpdateStars()
    {
        foreach (var item in _following.OfType<FollowItem>()) item.Isfavorite = _app.favorites.Contains(item.Login);
    }

    private void Star_Click(object sender, RoutedEventArgs e)
    {
        var item = (FollowItem)((FrameworkElement)sender).Tag;
        item.Isfavorite = _app.favorites.Toggle(item.Login); // favorites.Changed updates the Live view and stars
    }

    // Hidden channels drop out of Following (and sync to the extension's popup). "Show hidden channels" brings them back, dimmed.
    private void Hide_Click(object sender, RoutedEventArgs e) => _app.Hidden.Toggle(((FollowItem)((FrameworkElement)sender).Tag).Login);

    private void ShowHidden_Click(object sender, RoutedEventArgs e)
    {
        _showHidden = ShowHiddenItem.IsChecked;
        RefreshFollowing();
    }

    private void Search_TextChanged(AutoSuggestBox sender, AutoSuggestBoxTextChangedEventArgs args)
    {
        _searchTimer.Stop();
        if (FollowingPanel.Visibility == Visibility.Visible) _searchTimer.Start();
    }

    private void Sort_Click(object sender, RoutedEventArgs e)
    {
        _app.Settings.FollowSort = ReferenceEquals(sender, SortName) ? FollowSort.Name : ReferenceEquals(sender, SortRecent) ? FollowSort.RecentlyFollowed : FollowSort.LiveFirst;
        _app.Settings.Save();
        RefreshFollowing();
    }

    // ---- Settings

    private void LoadSettings()
    {
        _loadingSettings = true;
        NotifyToggle.IsOn = _app.Settings.Notifications;
        PriorityToggle.IsOn = _app.Settings.PriorityNotifications;
        TrayToggle.IsOn = _app.Settings.CloseToTray;
        PollBox.Value = _app.Settings.PollMinutes;
        StartupToggle.IsOn = Startup.Enabled;
        (_app.Settings.FollowSort switch { FollowSort.Name => SortName, FollowSort.RecentlyFollowed => SortRecent, _ => SortLive }).IsChecked = true;
        _loadingSettings = false;
    }

    /// <summary>Re-reads "start with Windows" — called once the packaged startup state has been fetched async.</summary>
    internal void RefreshStartupToggle()
    {
        _loadingSettings = true;
        StartupToggle.IsOn = Startup.Enabled;
        _loadingSettings = false;
    }

    private void Settings_Toggled(object sender, RoutedEventArgs e)
    {
        if (_loadingSettings) return;
        _app.Settings.Notifications = NotifyToggle.IsOn;
        _app.Settings.PriorityNotifications = PriorityToggle.IsOn;
        _app.Settings.CloseToTray = TrayToggle.IsOn;
        _app.Settings.Save();
        if (ReferenceEquals(sender, StartupToggle)) _ = Startup.SetAsync(StartupToggle.IsOn);
    }

    private void Poll_Changed(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (_loadingSettings || double.IsNaN(args.NewValue)) return;
        var minutes = (int)Math.Clamp(Math.Round(args.NewValue), 1, 15);
        if (minutes == _app.Settings.PollMinutes) return;
        _app.Settings.PollMinutes = minutes;
        _app.Settings.Save();
        _app.StartWatching();
    }

    private void OpenNotificationSettings_Click(object sender, RoutedEventArgs e) => Notifier.OpenWindowsSettings();

    private void SetUpExtension_Click(object sender, RoutedEventArgs e) => ExtensionSetup.Show(_app.Pairing);

    private void UpdatePairingText() =>
        PairingText.Text = _app.Pairing.Token is null
            ? "Not connected yet. \"Add to your browser\" walks you through it; it connects by itself."
            : "Paired — favorites and hidden channels sync with the extension.";

    // ---- Pairing prompt (called from the listener's thread)

    public Task<bool> ConfirmPairingAsync(string origin)
    {
        var answer = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!DispatcherQueue.TryEnqueue(async () =>
        {
            ShowAndFocus();
            var dialog = new ContentDialog
            {
                XamlRoot = Content.XamlRoot,
                Title = "Connect the browser extension?",
                Content = $"The Twitchphile extension wants to sync favorites and hidden channels with this app.\n\n{origin}",
                PrimaryButtonText = "Allow",
                CloseButtonText = "Not now",
                DefaultButton = ContentDialogButton.Primary,
            };
            // Only one ContentDialog may be open at a time; a second pair request while one is showing is a "no",
            // not a request left hanging until the listener's two-minute timeout.
            try { answer.TrySetResult(await dialog.ShowAsync() == ContentDialogResult.Primary); }
            catch (Exception) { answer.TrySetResult(false); }
        })) answer.TrySetResult(false); // UI thread shutting down
        return answer.Task;
    }

    private static void Open(string target) => Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
}
