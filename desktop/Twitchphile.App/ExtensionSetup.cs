using System.Diagnostics;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.Win32;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage;

namespace Twitchphile.App;

/// <summary>
/// "Add Twitchphile to your browser": a compact, one-screen take on Stretto's walkthrough, in its own small window
/// that stays above everything (so it's still there while you work in the browser) until you close it.
/// Pick the browser (installed ones are found for you), open its extensions page, drag the extension in straight from
/// this dialog, and watch it connect. Our own Chromium extension pairs silently, so step 3 just turns green.
/// </summary>
internal static class ExtensionSetup
{
    private sealed record Browser(string Name, string Exe, string Page, bool Firefox = false);

    // Every Chromium browser loads the same unpacked folder; Firefox takes the packed .xpi.
    private static readonly Browser[] Browsers =
    [
        new("Brave", "brave.exe", "brave://extensions"),
        new("Google Chrome", "chrome.exe", "chrome://extensions"),
        new("Microsoft Edge", "msedge.exe", "edge://extensions"),
        new("Opera / Opera GX", "opera.exe", "opera://extensions"),
        new("Vivaldi", "vivaldi.exe", "vivaldi://extensions"),
        new("Chromium", "chromium.exe", "chrome://extensions"),
        new("Firefox", "firefox.exe", "about:debugging#/runtime/this-firefox", Firefox: true),
    ];

    private static string ChromiumFolder => Path.Combine(AppContext.BaseDirectory, "extension");
    private static string FirefoxXpi => Path.Combine(AppContext.BaseDirectory, "twitchphile-firefox.xpi");

    private static Window? _open;

    /// <summary>Opens the setup window, or brings the one already open to the front.</summary>
    public static void Show(Core.PairingListener pairing)
    {
        if (_open is not null)
        {
            _open.Activate();
            return;
        }
        var installed = Browsers.Where(b => InstalledPath(b) is not null).ToList();
        var choices = installed.Concat(Browsers.Except(installed)).ToList(); // installed first, Brave first among them

        var picker = new ComboBox { ItemsSource = choices.Select(b => b.Name + (installed.Contains(b) ? "" : " (not found)")).ToList(), SelectedIndex = 0, HorizontalAlignment = HorizontalAlignment.Stretch };
        var step1 = Hint();
        var step2 = Hint();
        var status = new TextBlock { Text = "Waiting for the extension…", Foreground = Secondary, TextWrapping = TextWrapping.Wrap };
        var ring = new ProgressRing { IsActive = true, Width = 16, Height = 16 };
        Browser chosen() => choices[Math.Max(0, picker.SelectedIndex)];

        // Browsers won't open their own internal pages (brave://, chrome://, about:) when another program asks — a
        // deliberate security rule; they just open a blank window. So, like Stretto: the address to copy and paste.
        var address = new TextBox { IsReadOnly = true, FontFamily = new FontFamily("Consolas") };
        var copied = new TextBlock { Foreground = Secondary, Visibility = Visibility.Collapsed };

        void describe()
        {
            var b = chosen();
            address.Text = b.Page;
            copied.Visibility = Visibility.Collapsed;
            step1.Text = $"Copy this address and paste it into {b.Name}'s address bar." + (b.Firefox ? "" : " Turn on Developer mode there.");
            step2.Text = b.Firefox
                ? "Drag this onto that page. Regular Firefox only keeps unsigned add-ons until it restarts (use \"Load Temporary Add-on\"); Developer Edition, Nightly and ESR can install it for good."
                : "Drag this onto the extensions page — or click \"Load unpacked\" and pick the folder.";
        }
        picker.SelectionChanged += (_, _) => describe();
        describe();

        var copy = new Button { Content = "Copy", Style = (Style)Application.Current.Resources["AccentButtonStyle"] };
        copy.Click += (_, _) =>
        {
            Copy(address.Text);
            copied.Text = $"Copied — paste it into {chosen().Name}'s address bar.";
            copied.Visibility = Visibility.Visible;
        };
        var addressRow = new Grid { ColumnSpacing = 8, ColumnDefinitions = { new() { Width = new GridLength(1, GridUnitType.Star) }, new() { Width = GridLength.Auto } } };
        Grid.SetColumn(copy, 1);
        addressRow.Children.Add(address);
        addressRow.Children.Add(copy);
        var open = new StackPanel { Spacing = 6, Children = { addressRow, copied } };

        var tileTitle = new TextBlock { Text = "Twitchphile extension", Style = (Style)Application.Current.Resources["BodyStrongTextBlockStyle"] };
        var tile = new Border
        {
            CanDrag = true,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(14),
            CornerRadius = new CornerRadius(8),
            BorderThickness = new Thickness(1),
            BorderBrush = (Brush)Application.Current.Resources["AccentFillColorDefaultBrush"],
            Background = (Brush)Application.Current.Resources["CardBackgroundFillColorDefaultBrush"],
            Child = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 12,
                Children = { new FontIcon { Glyph = "", FontSize = 24 }, new StackPanel { Children = { tileTitle, new TextBlock { Text = "Drag me into your browser", Foreground = Secondary } } } },
            },
        };
        // WinUI's own drag pipeline (it owns pointer capture and the OLE handoff); the file is supplied through a
        // deferral so nothing blocks the UI thread (Stretto learned both of these the hard way).
        tile.DragStarting += async (_, e) =>
        {
            var deferral = e.GetDeferral();
            try
            {
                IStorageItem item = chosen().Firefox
                    ? await StorageFile.GetFileFromPathAsync(FirefoxXpi)
                    : await StorageFolder.GetFolderFromPathAsync(ChromiumFolder);
                e.Data.SetStorageItems([item]);
                e.Data.Properties.Title = "Twitchphile extension";
                e.Data.RequestedOperation = DataPackageOperation.Copy;
            }
            catch (Exception)
            {
                e.Cancel = true; // extension not built next to the app
            }
            finally
            {
                deferral.Complete();
            }
        };
        var reveal = new HyperlinkButton { Content = "Show the file", Padding = new Thickness(0) };
        reveal.Click += (_, _) => Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{(chosen().Firefox ? FirefoxXpi : ChromiumFolder)}\""));

        var done = new Button { Content = "Done", HorizontalAlignment = HorizontalAlignment.Right, MinWidth = 96 };
        var content = new StackPanel
        {
            Spacing = 14,
            Padding = new Thickness(24, 16, 24, 20),
            Children =
            {
                picker,
                Step("1", "Open the extensions page", step1, open),
                Step("2", "Add Twitchphile", step2, new StackPanel { Spacing = 6, Children = { tile, reveal } }),
                Step("3", "Connect", new TextBlock { Text = "Happens by itself once the extension loads.", Foreground = Secondary, TextWrapping = TextWrapping.Wrap },
                    StatusRow(ring, status)),
                done,
            },
        };

        // Same title bar as the main window (WinUI's TitleBar, drawn by us), not the default white system one.
        var titleBar = new TitleBar
        {
            Title = "Twitchphile",
            Subtitle = "Add to your browser",
            IconSource = new ImageIconSource { ImageSource = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri("ms-appx:///Assets/twitchphile-icon.png")) },
        };
        var scroller = new ScrollViewer { Content = content };
        var layout = new Grid { RowDefinitions = { new() { Height = GridLength.Auto }, new() { Height = new GridLength(1, GridUnitType.Star) } } };
        Grid.SetRow(scroller, 1);
        layout.Children.Add(titleBar);
        layout.Children.Add(scroller);

        var window = _open = new Window
        {
            Title = "Add Twitchphile to your browser",
            Content = layout,
            SystemBackdrop = new MicaBackdrop(),
            ExtendsContentIntoTitleBar = true,
        };
        window.SetTitleBar(titleBar);
        window.AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "twitchphile.ico"));
        window.AppWindow.Resize(new Windows.Graphics.SizeInt32(Scale(window, 480), Scale(window, 660)));
        if (window.AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.IsAlwaysOnTop = true; // stays visible while you work in the browser
            presenter.IsMaximizable = false;
            presenter.PreferredMinimumWidth = Scale(window, 400);
            presenter.PreferredMinimumHeight = Scale(window, 480);
        }
        done.Click += (_, _) => window.Close();
        var ui = window.DispatcherQueue;
        void seen(string origin) => ui.TryEnqueue(() =>
        {
            ring.IsActive = false;
            ring.Visibility = Visibility.Collapsed;
            status.Text = "✓ Connected — favorites, hidden channels and drops now sync.";
            status.Foreground = (Brush)Application.Current.Resources["SystemFillColorSuccessBrush"];
        });
        pairing.ExtensionSeen += seen;
        window.Closed += (_, _) =>
        {
            pairing.ExtensionSeen -= seen;
            _open = null;
        };
        window.Activate();
    }

    // AppWindow sizes are physical pixels; scale design sizes by the monitor's DPI.
    private static int Scale(Window w, int px) => (int)Math.Round(px * GetDpiForWindow(WinRT.Interop.WindowNative.GetWindowHandle(w)) / 96.0);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(nint hwnd);

    // Spinner + message; a grid (not a horizontal stack) so a long message wraps instead of running off the edge.
    private static Grid StatusRow(ProgressRing ring, TextBlock status)
    {
        var row = new Grid { ColumnSpacing = 8, ColumnDefinitions = { new() { Width = GridLength.Auto }, new() { Width = new GridLength(1, GridUnitType.Star) } } };
        ring.VerticalAlignment = VerticalAlignment.Top;
        ring.Margin = new Thickness(0, 2, 0, 0);
        Grid.SetColumn(status, 1);
        row.Children.Add(ring);
        row.Children.Add(status);
        return row;
    }

    private static Brush Secondary => (Brush)Application.Current.Resources["TextFillColorSecondaryBrush"];

    private static TextBlock Hint() => new() { Foreground = Secondary, TextWrapping = TextWrapping.Wrap };

    private static Grid Step(string number, string title, UIElement body, UIElement action)
    {
        var grid = new Grid { ColumnSpacing = 12, ColumnDefinitions = { new() { Width = GridLength.Auto }, new() { Width = new GridLength(1, GridUnitType.Star) } } };
        var badge = new Border
        {
            Width = 24, Height = 24, CornerRadius = new CornerRadius(12), VerticalAlignment = VerticalAlignment.Top,
            Background = (Brush)Application.Current.Resources["AccentFillColorDefaultBrush"],
            Child = new TextBlock { Text = number, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Foreground = (Brush)Application.Current.Resources["TextOnAccentFillColorPrimaryBrush"] },
        };
        var stack = new StackPanel { Spacing = 6, Children = { new TextBlock { Text = title, Style = (Style)Application.Current.Resources["BodyStrongTextBlockStyle"] }, body, action } };
        Grid.SetColumn(stack, 1);
        grid.Children.Add(badge);
        grid.Children.Add(stack);
        return grid;
    }

    // Where Windows' App Paths registry says the browser lives, or null when it isn't installed.
    private static string? InstalledPath(Browser b)
    {
        foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            try
            {
                using var key = hive.OpenSubKey($@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{b.Exe}");
                if (key?.GetValue(null) is string path && File.Exists(path.Trim('"'))) return path.Trim('"');
            }
            catch (Exception) { /* unreadable = not found */ }
        }
        return null;
    }

    private static void Copy(string text)
    {
        var package = new DataPackage();
        package.SetText(text);
        Clipboard.SetContent(package);
    }
}
