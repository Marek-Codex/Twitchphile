using Windows.ApplicationModel;

namespace Twitchphile.App.Services;

/// <summary>
/// Whether we're running with package identity (installed from an MSIX) or loose (the unpackaged exe).
/// The two behave differently for a few OS integrations — protocol handling, "start with Windows" — so the
/// app checks this and picks the right mechanism. Everything else (data in %LocalAppData%, the loopback
/// pairing listener, the tray icon) works the same either way, which is what lets the extension and the app
/// each stand alone yet still sync.
/// </summary>
public static class PackageInfo
{
    private static readonly bool _isPackaged = CheckPackaged();

    public static bool IsPackaged => _isPackaged;

    // Package.Current throws when there's no package identity (unpackaged exe); that's the signal.
    private static bool CheckPackaged()
    {
        try { return Package.Current is not null && Package.Current.Id is not null; }
        catch { return false; }
    }
}
