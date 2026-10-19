using System.Threading.Tasks;
using Microsoft.Win32;
using Windows.ApplicationModel;

namespace Twitchphile.App.Services;

/// <summary>
/// "Start with Windows". Two mechanisms, chosen by how we're installed:
///   - Unpackaged: the HKCU Run key — no elevation, follows the exe, and it's kept out of settings.json so the
///     toggle and the real state can't drift apart.
///   - Packaged (MSIX): a <c>StartupTask</c> declared in Package.appxmanifest. The Run-key path doesn't work
///     here (the exe lives in a versioned, protected package folder), and Windows can revoke the task on its
///     own, so we always read the live state back rather than trusting a saved flag.
/// </summary>
public static class Startup
{
    private const string TaskId = "TwitchphileStartup";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunName = "PlexusTwitchphile";

    // The packaged state is only known after an async query, so it's cached once at launch.
    private static bool? _packagedEnabled;

    public static bool Enabled
    {
        get
        {
            if (!PackageInfo.IsPackaged)
            {
                using var key = Registry.CurrentUser.OpenSubKey(RunKey);
                return key?.GetValue(RunName) is string;
            }
            return _packagedEnabled ?? false;
        }
    }

    /// <summary>Learn the packaged startup state without blocking the UI thread. Called once at launch.</summary>
    public static async Task RefreshAsync()
    {
        if (!PackageInfo.IsPackaged) return;
        try
        {
            var task = await StartupTask.GetAsync(TaskId);
            _packagedEnabled = task.State == StartupTaskState.Enabled;
        }
        catch { _packagedEnabled = false; }
    }

    /// <summary>Enable or disable. Must be called from the UI thread — StartupTask.RequestEnableAsync requires it.</summary>
    public static async Task SetAsync(bool enabled)
    {
        if (!PackageInfo.IsPackaged)
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey);
            if (enabled) key.SetValue(RunName, $"\"{Environment.ProcessPath}\" --tray");
            else key.DeleteValue(RunName, throwOnMissingValue: false);
            return;
        }
        try
        {
            var task = await StartupTask.GetAsync(TaskId);
            if (enabled) await task.RequestEnableAsync();
            else task.Disable();
            _packagedEnabled = task.State == StartupTaskState.Enabled;
        }
        catch { /* leave the cache as-is; the UI will re-read on next launch */ }
    }
}
