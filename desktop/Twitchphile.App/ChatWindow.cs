using Twitchphile.Core;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace Twitchphile.App;

/// <summary>A compact Twitch pop-out chat window opened from the channel list.</summary>
internal sealed class ChatWindow : Window
{
    private readonly WebView2 _web = new();

    public ChatWindow(string login)
    {
        Title = $"{login} chat — Twitchphile";
        Content = _web;
        _ = LoadAsync(login);
        AppWindow.Resize(new Windows.Graphics.SizeInt32(380, 640));
        if (AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.PreferredMinimumWidth = 300;
            presenter.PreferredMinimumHeight = 360;
        }
    }

    private async Task LoadAsync(string login)
    {
        try
        {
            await _web.EnsureCoreWebView2Async();
            _web.Source = new Uri(Kick.IsKick(login)
                ? $"https://kick.com/popout/{Uri.EscapeDataString(Kick.Slug(login))}/chat"
                : $"https://www.twitch.tv/popout/{Uri.EscapeDataString(login)}/chat?popout=");
        }
        catch (Exception)
        {
            Content = new TextBlock
            {
                Text = "Couldn't open Twitch chat. Please try again.",
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
        }
    }
}
