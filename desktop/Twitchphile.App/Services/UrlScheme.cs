using Microsoft.Win32;

namespace Twitchphile.App.Services;

/// <summary>
/// The twitchphile: link type, so the extension's "Start app" button can launch us (the browser asks first).
/// The link itself carries no instructions; opening it just starts or shows the app.
///
/// Two mechanisms, picked by how we're installed:
///   - Unpackaged: registered per user under HKCU\Software\Classes on every launch — no elevation, it follows
///     the exe if it moves, and removing it is one key.
///   - Packaged (MSIX): the protocol is declared in Package.appxmanifest instead, and Windows routes it to us
///     as a protocol activation. Writing the registry key here would be pointless (and fights the package), so
///     we skip it.
/// </summary>
internal static class UrlScheme
{
    private const string Scheme = "twitchphile";

    public static void Register()
    {
        if (PackageInfo.IsPackaged) return; // the manifest owns the protocol when installed from an MSIX
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{Scheme}");
            key.SetValue(null, "URL:Twitchphile");
            key.SetValue("URL Protocol", "");
            using var icon = key.CreateSubKey("DefaultIcon");
            icon.SetValue(null, $"\"{Environment.ProcessPath}\",0");
            using var command = key.CreateSubKey(@"shell\open\command");
            command.SetValue(null, $"\"{Environment.ProcessPath}\" \"%1\"");
        }
        catch (Exception) { /* registry locked down: the link just won't work, nothing else depends on it */ }
    }
}

