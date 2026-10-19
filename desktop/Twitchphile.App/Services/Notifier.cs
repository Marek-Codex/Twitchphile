using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;
using Twitchphile.Core;

namespace Twitchphile.App.Services;

/// <summary>
/// Windows go-live notifications with a Watch button.
///
/// Do Not Disturb: apps can't silently bypass it, by design. What they can do is mark a notification urgent;
/// Windows then lets it through DND only if you've allowed urgent notifications for Twitchphile in
/// Settings → System → Notifications. <see cref="OpenWindowsSettings"/> takes you there.
/// </summary>
public sealed class Notifier : IDisposable
{
    private readonly HttpClient _http;
    private bool _registered;

    /// <summary>Raised (on a background thread) when you click a notification or its Watch button.</summary>
    public event Action<string>? WatchRequested;

    public Notifier(HttpClient http)
    {
        _http = http;
        try
        {
            AppNotificationManager.Default.NotificationInvoked += (_, e) =>
            {
                if (e.Arguments.TryGetValue("login", out var login)) WatchRequested?.Invoke(login);
            };
            AppNotificationManager.Default.Register();
            _registered = true;
        }
        catch (Exception) { /* notifications unavailable (e.g. stripped-down Windows) — the app still works */ }
    }

    public async Task ShowWentLiveAsync(LiveStream s, bool priority)
    {
        if (!_registered) return;
        var builder = new AppNotificationBuilder()
            .AddArgument("login", s.Login)
            .AddText($"{s.Name} is live")
            .AddText(string.Join(" · ", new[] { s.Game, s.Title }.Where(t => !string.IsNullOrWhiteSpace(t))))
            .AddButton(new AppNotificationButton("Watch").AddArgument("login", s.Login));
        if (await ThumbnailAsync(s) is { } thumb) builder.SetHeroImage(thumb); // what's on screen right now
        if (priority && AppNotificationBuilder.IsUrgentScenarioSupported()) builder.SetScenario(AppNotificationScenario.Urgent);
        AppNotificationManager.Default.Show(builder.BuildNotification());
    }

    public static void OpenWindowsSettings() =>
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("ms-settings:notifications") { UseShellExecute = true });

    // Notification images must be local files for an unpackaged app, so cache the stream thumbnail.
    private async Task<Uri?> ThumbnailAsync(LiveStream s)
    {
        try
        {
            var dir = Path.Combine(Paths.Data, "cache");
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, $"{s.Login}.jpg");
            await File.WriteAllBytesAsync(file, await _http.GetByteArrayAsync(s.Thumbnail(640, 360)));
            return new Uri(file);
        }
        catch (Exception) { return null; }
    }

    public void Dispose()
    {
        if (_registered) AppNotificationManager.Default.Unregister();
    }
}
