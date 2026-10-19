using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Twitchphile.Core;

/// <summary>Persists the session somewhere safe. The app encrypts it with DPAPI; tests keep it in memory.</summary>
public interface ISessionStore
{
    TwitchSession? Load();
    void Save(TwitchSession? session);
}

/// <summary>
/// Twitch sign-in via the OAuth device-code flow: the app shows a short code, you enter it at
/// twitch.tv/activate, and the app polls until you approve. Made for desktop apps — no redirect URL,
/// no local web server, no browser extension involved. Public client, so no secret ships in the app.
/// </summary>
public sealed class TwitchAuth(HttpClient http, ISessionStore store)
{
    // The "Phile by MarekCodex" Twitch application (public client), shared with the browser extension.
    public const string ClientId = "svnythf3k59s8103amfg4m2p9381re";
    private const string Scopes = "user:read:follows";
    private const string IdBase = "https://id.twitch.tv/oauth2";

    private TwitchSession? _session = store.Load();

    // Refresh tokens are single-use: two overlapping refreshes (timer poll, manual refresh, the extension borrowing
    // the session) would have the loser rejected — and a rejected refresh signs you out. One at a time.
    private readonly SemaphoreSlim _refreshGate = new(1, 1);

    public TwitchSession? Session => _session;
    public bool IsSignedIn => _session is not null;
    public event Action? SessionChanged;

    /// <summary>
    /// Starts sign-in. <paramref name="showCode"/> receives the code to display; the task completes once the
    /// user approves (or throws if they deny it or the code expires).
    /// </summary>
    public async Task SignInAsync(Action<DeviceCode> showCode, CancellationToken ct = default)
    {
        var start = await PostFormAsync<DeviceStart>($"{IdBase}/device", new() { ["client_id"] = ClientId, ["scopes"] = Scopes }, ct);
        showCode(new DeviceCode(start.UserCode, start.VerificationUri, TimeSpan.FromSeconds(start.ExpiresIn)));

        var deadline = DateTimeOffset.UtcNow.AddSeconds(start.ExpiresIn);
        var interval = TimeSpan.FromSeconds(Math.Max(1, start.Interval));
        while (DateTimeOffset.UtcNow < deadline)
        {
            await Task.Delay(interval, ct);
            using var response = await http.PostAsync($"{IdBase}/token", new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = ClientId,
                ["scopes"] = Scopes,
                ["device_code"] = start.DeviceCode,
                ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code",
            }), ct);

            if (response.IsSuccessStatusCode)
            {
                var tokens = await response.Content.ReadFromJsonAsync<TokenResponse>(Json, ct) ?? throw new InvalidOperationException("Twitch returned no token.");
                await AdoptAsync(tokens, ct);
                return;
            }

            var error = await response.Content.ReadFromJsonAsync<TwitchError>(Json, ct);
            switch (error?.Message)
            {
                case "authorization_pending": continue;
                case "slow_down": interval += TimeSpan.FromSeconds(5); continue;
                default: throw new InvalidOperationException(error?.Message == "access_denied" ? "Sign-in was declined." : $"Sign-in failed: {error?.Message}");
            }
        }
        throw new TimeoutException("The sign-in code expired. Try again.");
    }

    public void SignOut() => Set(null);

    /// <summary>
    /// A sign-in borrowed from the paired browser extension. It has no refresh token, so it lasts until it expires
    /// (the extension's sign-in style can't be refreshed); after that you're asked to Connect.
    /// </summary>
    public bool IsBorrowed => _session is { RefreshToken: "" };

    /// <summary>A valid access token, refreshing it first if it's about to expire. Null when signed out.</summary>
    public async Task<string?> AccessTokenAsync(CancellationToken ct = default)
    {
        if (_session is null) return null;
        if (_session.ExpiresAt - DateTimeOffset.UtcNow > TimeSpan.FromMinutes(5)) return _session.AccessToken;
        if (IsBorrowed)
        {
            if (_session.ExpiresAt > DateTimeOffset.UtcNow) return _session.AccessToken;
            SignOut();
            return null;
        }
        return await RefreshAsync(ct) ? _session?.AccessToken : null;
    }

    /// <summary>The current session with a token that's good for a while — what a paired extension borrows.</summary>
    public async Task<TwitchSession?> FreshSessionAsync(CancellationToken ct = default) =>
        await AccessTokenAsync(ct) is null ? null : _session;

    /// <summary>Signs in with a token the paired extension offers (only when not signed in already).</summary>
    public async Task<bool> BorrowAsync(string accessToken, CancellationToken ct = default)
    {
        if (_session is not null) return false;
        try
        {
            await AdoptAsync(new TokenResponse(accessToken, "", 0), ct, useValidatedExpiry: true);
            return true;
        }
        catch (HttpRequestException) { return false; } // token rejected by Twitch
    }

    /// <summary>
    /// Uses the refresh token (single-use for public clients). Signs out only if Twitch rejects it outright.
    /// <paramref name="staleToken"/>: the access token the caller found wanting — if another caller already
    /// replaced it while we waited, that fresh one is used instead of refreshing again.
    /// </summary>
    public async Task<bool> RefreshAsync(CancellationToken ct = default, string? staleToken = null)
    {
        await _refreshGate.WaitAsync(ct);
        try
        {
            if (_session is null || IsBorrowed) return false;
            if (staleToken is not null && _session.AccessToken != staleToken) return true; // someone else just refreshed
            if (staleToken is null && _session.ExpiresAt - DateTimeOffset.UtcNow > TimeSpan.FromMinutes(5)) return true;
            using var response = await http.PostAsync($"{IdBase}/token", new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = ClientId,
                ["grant_type"] = "refresh_token",
                ["refresh_token"] = _session.RefreshToken,
            }), ct);
            if (!response.IsSuccessStatusCode)
            {
                // 400/401 = the refresh token is dead; anything else (5xx, 429) is Twitch having a moment — keep the session.
                if ((int)response.StatusCode is 400 or 401) SignOut();
                return false;
            }
            var tokens = await response.Content.ReadFromJsonAsync<TokenResponse>(Json, ct);
            if (tokens is null) return false;
            await AdoptAsync(tokens, ct);
            return true;
        }
        finally
        {
            _refreshGate.Release();
        }
    }

    // Validates the token to learn who it belongs to (and, for borrowed tokens, how long it lasts), then stores it.
    private async Task AdoptAsync(TokenResponse tokens, CancellationToken ct, bool useValidatedExpiry = false)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{IdBase}/validate");
        request.Headers.TryAddWithoutValidation("Authorization", $"OAuth {tokens.AccessToken}");
        using var response = await http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        var who = await response.Content.ReadFromJsonAsync<Validation>(Json, ct) ?? throw new InvalidOperationException("Twitch could not validate the token.");
        if (who.ClientId != ClientId) throw new HttpRequestException("That token belongs to a different Twitch app.");
        var lifetime = useValidatedExpiry ? who.ExpiresIn : tokens.ExpiresIn;
        Set(new TwitchSession(who.UserId, who.Login, tokens.AccessToken, tokens.RefreshToken, DateTimeOffset.UtcNow.AddSeconds(lifetime)));
    }

    private void Set(TwitchSession? session)
    {
        _session = session;
        store.Save(session);
        SessionChanged?.Invoke();
    }

    private async Task<T> PostFormAsync<T>(string url, Dictionary<string, string> form, CancellationToken ct)
    {
        using var response = await http.PostAsync(url, new FormUrlEncodedContent(form), ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<T>(Json, ct) ?? throw new InvalidOperationException($"Empty response from {url}");
    }

    internal static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    private sealed record DeviceStart(string DeviceCode, string UserCode, string VerificationUri, int ExpiresIn, int Interval);
    private sealed record TokenResponse(string AccessToken, string RefreshToken, int ExpiresIn);
    private sealed record Validation(string Login, string UserId, string ClientId, int ExpiresIn);
    private sealed record TwitchError([property: JsonPropertyName("message")] string? Message);
}
