using System.Runtime.InteropServices;

namespace Twitchphile.App.Interop;

/// <summary>
/// A notification area icon.
///
/// Hand rolled because WinUI 3 has no tray support of its own and the packages that add it
/// are heavier than the hundred lines of shell interop they wrap.
///
/// The icon needs a window to send its callbacks to, but it must not be the app's window:
/// the whole point is to keep working while that one is hidden. So this owns a message-only
/// window, which never draws anything and exists purely as an address.
/// </summary>
public sealed class TrayIcon : IDisposable
{
    private const int WmApp = 0x8000;
    private const int CallbackMessage = WmApp + 1;

    private const int WmLeftButtonUp = 0x0202;
    private const int WmLeftDoubleClick = 0x0203;
    private const int WmRightButtonUp = 0x0205;
    private const int WmCommand = 0x0111;
    private const int WmDestroy = 0x0002;

    private const int NimAdd = 0x0000;
    private const int NimModify = 0x0001;
    private const int NimDelete = 0x0002;

    private const int NifMessage = 0x0001;
    private const int NifIcon = 0x0002;
    private const int NifTip = 0x0004;

    private const int ImageIcon = 1;
    private const int LoadFromFile = 0x0010;
    private const int DefaultSize = 0x0040;

    private const int MfString = 0x0000;
    private const int MfSeparator = 0x0800;

    private const int TpmRightButton = 0x0002;
    private const int TpmReturnCmd = 0x0100;

    private const nint HwndMessage = -3;

    // Held as a field so the delegate is not collected while the OS still has the pointer.
    private readonly WndProc _wndProc;
    private readonly List<(string Text, Action Run)> _menu = [];

    private nint _window;
    private nint _icon;
    private bool _added;
    private string _tooltip;

    // Broadcast when Explorer (re)starts — at login, or after a crash. Every icon has to be added again then,
    // or a tray-only app becomes unreachable.
    private static readonly uint TaskbarCreated = RegisterWindowMessage("TaskbarCreated");

    /// <summary>Raised when the icon is clicked, which should bring the app back.</summary>
    public event Action? Activated;

    public TrayIcon(string iconPath, string tooltip)
    {
        _wndProc = HandleMessage;
        _tooltip = tooltip;

        var className = "TwitchphileTray_" + Guid.NewGuid().ToString("n");

        var windowClass = new WndClass
        {
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_wndProc),
            hInstance = GetModuleHandle(null),
            lpszClassName = className,
        };

        if (RegisterClass(ref windowClass) == 0)
            throw new InvalidOperationException("Could not register the tray window class.");

        _window = CreateWindowEx(0, className, string.Empty, 0, 0, 0, 0, 0,
            HwndMessage, nint.Zero, windowClass.hInstance, nint.Zero);

        if (_window == nint.Zero)
            throw new InvalidOperationException("Could not create the tray message window.");

        // LoadImage from the file on disk rather than an embedded resource, because an
        // unpackaged app already ships the .ico next to the executable.
        _icon = LoadImage(nint.Zero, iconPath, ImageIcon, 0, 0, LoadFromFile | DefaultSize);

        // The shell can refuse (typically while Explorer is still starting at login, exactly when "Start with
        // Windows" launches us). Not fatal: TaskbarCreated arrives once it's ready and we add the icon then.
        Add();
    }

    private void Add()
    {
        var data = NewData();
        data.uFlags = NifMessage | NifIcon | NifTip;
        data.uCallbackMessage = CallbackMessage;
        data.hIcon = _icon;
        data.szTip = _tooltip;
        _added = Shell_NotifyIcon(NimAdd, ref data);
    }

    /// <summary>Adds a right-click menu entry. Order of calls is the order shown.</summary>
    public void AddMenuItem(string text, Action run) => _menu.Add((text, run));

    /// <summary>A separator in the right-click menu.</summary>
    public void AddSeparator() => _menu.Add(("", null!));

    /// <summary>Changes the hover text, e.g. to say how many favorites are live.</summary>
    public void SetTooltip(string tooltip)
    {
        _tooltip = tooltip;
        if (!_added) return;

        var data = NewData();
        data.uFlags = NifTip;
        data.szTip = tooltip;

        Shell_NotifyIcon(NimModify, ref data);
    }

    private nint HandleMessage(nint window, uint message, nint wParam, nint lParam)
    {
        if (message == TaskbarCreated && TaskbarCreated != 0)
        {
            Add();
            return nint.Zero;
        }
        switch (message)
        {
            case CallbackMessage:
                switch ((int)lParam)
                {
                    case WmLeftButtonUp:
                    case WmLeftDoubleClick:
                        Activated?.Invoke();
                        break;

                    case WmRightButtonUp:
                        ShowMenu();
                        break;
                }

                return nint.Zero;

            case WmDestroy:
                return nint.Zero;
        }

        return DefWindowProc(window, message, wParam, lParam);
    }

    private void ShowMenu()
    {
        if (_menu.Count == 0)
            return;

        var menu = CreatePopupMenu();
        if (menu == nint.Zero)
            return;

        try
        {
            for (var i = 0; i < _menu.Count; i++)
            {
                var (text, run) = _menu[i];

                if (run is null)
                    AppendMenu(menu, MfSeparator, 0, null);
                else
                    AppendMenu(menu, MfString, i + 1, text);
            }

            GetCursorPos(out var point);

            // Without this the menu does not close when you click elsewhere: the shell
            // expects the owner to be foreground while a tray menu is up.
            SetForegroundWindow(_window);

            var chosen = TrackPopupMenuEx(menu, TpmReturnCmd | TpmRightButton,
                point.X, point.Y, _window, nint.Zero);

            if (chosen > 0 && chosen <= _menu.Count)
                _menu[chosen - 1].Run?.Invoke();
        }
        finally
        {
            DestroyMenu(menu);
        }
    }

    private NotifyIconData NewData() => new()
    {
        cbSize = Marshal.SizeOf<NotifyIconData>(),
        hWnd = _window,
        uID = 1,
        szTip = "",
        szInfo = "",
        szInfoTitle = "",
    };

    public void Dispose()
    {
        if (_added)
        {
            var data = NewData();
            Shell_NotifyIcon(NimDelete, ref data);
            _added = false;
        }

        if (_icon != nint.Zero)
        {
            DestroyIcon(_icon);
            _icon = nint.Zero;
        }

        if (_window != nint.Zero)
        {
            DestroyWindow(_window);
            _window = nint.Zero;
        }
    }

    // ═══ Native ═══

    private delegate nint WndProc(nint window, uint message, nint wParam, nint lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WndClass
    {
        public uint style;
        public nint lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public nint hInstance;
        public nint hIcon;
        public nint hCursor;
        public nint hbrBackground;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpszMenuName;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszClassName;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyIconData
    {
        public int cbSize;
        public nint hWnd;
        public int uID;
        public int uFlags;
        public int uCallbackMessage;
        public nint hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip;
        public int dwState;
        public int dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo;
        public int uVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle;
        public int dwInfoFlags;
        public Guid guidItem;
        public nint hBalloonIcon;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessage(string message);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Shell_NotifyIcon(int message, ref NotifyIconData data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern ushort RegisterClass(ref WndClass windowClass);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint CreateWindowEx(int exStyle, string className, string windowName,
        int style, int x, int y, int width, int height, nint parent, nint menu, nint instance, nint param);

    [DllImport("user32.dll")]
    private static extern nint DefWindowProc(nint window, uint message, nint wParam, nint lParam);

    [DllImport("user32.dll")]
    private static extern bool DestroyWindow(nint window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern nint LoadImage(nint instance, string name, int type, int cx, int cy, int load);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(nint icon);

    [DllImport("user32.dll")]
    private static extern nint CreatePopupMenu();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool AppendMenu(nint menu, int flags, int id, string? item);

    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(nint menu);

    [DllImport("user32.dll")]
    private static extern int TrackPopupMenuEx(nint menu, int flags, int x, int y, nint window, nint parameters);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(nint window);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern nint GetModuleHandle(string? name);
}
