using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;

namespace Twitchphile.App;

internal static class Program
{
    // Single instance matters beyond tidiness: the extension pairs with one listener on one port,
    // and a second process would fight it for 9616.
    private const string InstanceKey = "Marek.Twitchphile.Singleton.v1";

    [STAThread]
    private static int Main(string[] args)
    {
        WinRT.ComWrappersSupport.InitializeComWrappers();

        var primary = AppInstance.FindOrRegisterForKey(InstanceKey);
        if (!primary.IsCurrent)
        {
            // Hand the launch (or a notification click) to the running instance, which shows its window.
            primary.RedirectActivationToAsync(AppInstance.GetCurrent().GetActivatedEventArgs()).AsTask().Wait();
            return 0;
        }

        Application.Start(initialization =>
        {
            DispatcherQueueSynchronizationContext context = new(DispatcherQueue.GetForCurrentThread());
            SynchronizationContext.SetSynchronizationContext(context);
            _ = new App(startHidden: args.Contains("--tray"));
            GC.KeepAlive(initialization);
        });

        return Environment.ExitCode;
    }
}
