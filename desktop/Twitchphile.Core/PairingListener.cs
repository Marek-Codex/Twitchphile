using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace Twitchphile.Core;

/// <summary>
/// The local endpoint the Twitchphile browser extension talks to (same pattern as Stretto's handoff listener).
///
/// A raw TcpListener rather than HttpListener, because HttpListener needs an admin URL-ACL registration.
/// It's safe to leave running because:
///   - it binds to loopback only, so nothing off-machine can reach it;
///   - pairing needs your approval in the app, and every other request must carry the pairing token;
///   - only extension origins get CORS access, so ordinary web pages can't even read its answers.
///
/// Routes: GET /ping (who's there), POST /pair, GET|PUT /favorites, GET|PUT /hidden, GET|PUT /session, PUT /drops, PUT /kick-follows.
/// The two lists sync the same way: PUT your per-channel changes, get back the merged list.
///
/// Shared sign-in: both sides are the same Twitch app, so a sign-in from one works for the other. A paired extension
/// borrows the app's (GET /session — always a fresh token, since the app can refresh), or offers its own when the app
/// has none (PUT /session).
/// </summary>
public sealed class PairingListener(ChannelList favorites, TwitchAuth? auth = null, int port = PairingListener.DefaultPort, ChannelList? hidden = null) : IDisposable
{
    public const int DefaultPort = 9616; // Stretto is 9615
    public const string TokenHeader = "x-twitchphile-token";
    public const string SilentHeader = "x-twitchphile-silent";

    /// <summary>
    /// Twitchphile's own Chromium extension. Its manifest carries a fixed key, so it has this id in every Chromium
    /// browser wherever it's loaded from; it pairs without a prompt. Everything else (including the Firefox add-on,
    /// whose moz-extension:// origin is random per install) still needs a one-time Allow.
    /// </summary>
    public const string OwnExtensionOrigin = "chrome-extension://jdemjjgkcelbkaacdfdbnnnifhoomhop";
    private const int MaxBody = 64 * 1024;

    private TcpListener? _listener;
    private CancellationTokenSource? _stop;

    /// <summary>The token paired extensions must present. Null until the first pairing.</summary>
    public string? Token { get; set; }

    /// <summary>Asked when an extension wants to pair (receives its origin); return true to allow.</summary>
    public Func<string, Task<bool>>? PairRequested { get; set; }

    /// <summary>Raised (listener thread) when the extension sends fresh drop progress.</summary>
    public event Action<DropsState>? DropsUpdated;

    /// <summary>Raised (listener thread) when the extension sends the Kick channels you follow ("kick/name").</summary>
    public event Action<IReadOnlyList<string>>? KickFollowsUpdated;

    /// <summary>Raised (listener thread) whenever a paired extension talks to us, or one pairs — "it's connected".</summary>
    public event Action<string>? ExtensionSeen;

    /// <summary>Raised when a new token was issued, so the app can persist it.</summary>
    public event Action<string>? Paired;

    public string Version { get; init; } = "0";

    public void Start()
    {
        if (_listener is not null) return;
        _stop = new CancellationTokenSource();
        _listener = new TcpListener(IPAddress.Loopback, port);
        _listener.Start();
        _ = AcceptLoopAsync(_listener, _stop.Token);
    }

    public void Dispose()
    {
        _stop?.Cancel();
        _listener?.Stop();
        _listener = null;
    }

    private async Task AcceptLoopAsync(TcpListener listener, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await listener.AcceptTcpClientAsync(ct); }
            catch (Exception) when (ct.IsCancellationRequested) { return; }
            catch (SocketException) { continue; }
            _ = ServeAsync(client, ct); // one slow client mustn't block the next
        }
    }

    // One request per connection (we answer with Connection: close), which keeps the parser trivial.
    private async Task ServeAsync(TcpClient client, CancellationToken ct)
    {
        using (client)
        {
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromMinutes(2)); // /pair waits on a person
                var stream = client.GetStream();
                var request = await HttpRequest.ReadAsync(stream, MaxBody, timeout.Token);
                if (request is null) return;
                HttpResponse response;
                try { response = await RouteAsync(request); }
                catch (JsonException) { response = HttpResponse.Status(400); }
                await response.WriteAsync(stream, request.Origin, timeout.Token);
            }
            catch (Exception e) when (e is IOException or OperationCanceledException or SocketException) { }
        }
    }

    internal async Task<HttpResponse> RouteAsync(HttpRequest r)
    {
        // Web pages must never talk to us; extensions (and originless loopback calls from Brave's extension pages) may.
        if (r.Origin is not null && !IsExtensionOrigin(r.Origin))
            return HttpResponse.Status(403);
        var trusted = r.Origin == OwnExtensionOrigin;
        if (r.Method == "OPTIONS") return HttpResponse.Status(204);

        switch (r.Method, r.Path)
        {
            case ("GET", "/ping"):
                if (Authorized(r)) ExtensionSeen?.Invoke(r.Origin ?? "");
                return HttpResponse.Json(new { app = "twitchphile", version = Version, paired = Authorized(r), signedIn = auth?.IsSignedIn ?? false });

            case ("POST", "/pair"):
                // "Silent" asks (the extension's automatic attempt) never prompt: yes for our own extension, else no.
                var silent = r.Headers.ContainsKey(SilentHeader);
                if (!trusted && (silent || PairRequested is null || !await PairRequested(r.Origin ?? "unknown"))) return HttpResponse.Status(403);
                Token ??= Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
                Paired?.Invoke(Token);
                ExtensionSeen?.Invoke(r.Origin ?? "");
                return HttpResponse.Json(new { token = Token });
        }

        if (!Authorized(r)) return HttpResponse.Status(401);

        var list = r.Path switch { "/favorites" => favorites, "/hidden" => hidden, _ => null };
        switch (r.Method, r.Path)
        {
            case ("GET", "/favorites" or "/hidden") when list is not null:
                return HttpResponse.Json(list.Current);

            case ("PUT", "/favorites" or "/hidden") when list is not null:
                var incoming = JsonSerializer.Deserialize<ChannelListState>(r.Body, WebJson);
                if (incoming?.Logins is null) return HttpResponse.Status(400);
                list.Merge(incoming);
                return HttpResponse.Json(list.Current); // the winner, so the extension can adopt it

            case ("PUT", "/drops"):
                var drops = JsonSerializer.Deserialize<DropsState>(r.Body, WebJson);
                if (drops?.Campaigns is null) return HttpResponse.Status(400);
                DropsUpdated?.Invoke(drops);
                return HttpResponse.Json(new { ok = true });

            case ("PUT", "/kick-follows"):
                var follows = JsonSerializer.Deserialize<KickFollows>(r.Body, WebJson);
                if (follows?.Channels is null) return HttpResponse.Status(400);
                KickFollowsUpdated?.Invoke([.. follows.Channels.Where(Kick.IsKick).Select(c => c.Trim().ToLowerInvariant()).Distinct().Take(500)]);
                return HttpResponse.Json(new { ok = true });

            case ("GET", "/session"):
                var session = auth is null ? null : await auth.FreshSessionAsync();
                return session is null
                    ? HttpResponse.Json(new { signedIn = false })
                    : HttpResponse.Json(new { signedIn = true, session.Login, session.UserId, session.AccessToken, session.ExpiresAt });

            case ("PUT", "/session"):
                var offered = JsonSerializer.Deserialize<SessionOffer>(r.Body, WebJson);
                if (auth is null || string.IsNullOrEmpty(offered?.AccessToken)) return HttpResponse.Status(400);
                await auth.BorrowAsync(offered.AccessToken);
                return HttpResponse.Json(new { signedIn = auth.IsSignedIn });
        }
        return HttpResponse.Status(404);
    }

    private static bool IsExtensionOrigin(string origin) =>
        origin.StartsWith("chrome-extension://", StringComparison.Ordinal) || origin.StartsWith("moz-extension://", StringComparison.Ordinal);

    private bool Authorized(HttpRequest r) =>
        Token is not null && r.Headers.TryGetValue(TokenHeader, out var t) &&
        System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(t), Encoding.UTF8.GetBytes(Token));

    internal static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    private sealed record SessionOffer(string AccessToken);
}

/// <summary>Just enough HTTP/1.1 to parse one small request.</summary>
internal sealed record KickFollows(IReadOnlyList<string>? Channels);

internal sealed record HttpRequest(string Method, string Path, Dictionary<string, string> Headers, string Body)
{
    public string? Origin => Headers.GetValueOrDefault("origin");

    public static async Task<HttpRequest?> ReadAsync(Stream stream, int maxBody, CancellationToken ct)
    {
        var buffer = new MemoryStream();
        var chunk = new byte[4096];
        int headEnd;
        while ((headEnd = IndexOfHeaderEnd(buffer)) < 0)
        {
            var n = await stream.ReadAsync(chunk, ct);
            if (n == 0 || buffer.Length > 16 * 1024) return null;
            buffer.Write(chunk, 0, n);
        }

        var bytes = buffer.ToArray();
        var lines = Encoding.ASCII.GetString(bytes, 0, headEnd).Split("\r\n");
        var start = lines[0].Split(' ');
        if (start.Length < 2) return null;
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines.Skip(1))
        {
            var colon = line.IndexOf(':');
            if (colon > 0) headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
        }

        var length = int.TryParse(headers.GetValueOrDefault("content-length"), out var l) ? l : 0;
        if (length < 0 || length > maxBody) return null;
        var body = new MemoryStream();
        body.Write(bytes, headEnd + 4, bytes.Length - headEnd - 4);
        while (body.Length < length)
        {
            var n = await stream.ReadAsync(chunk, ct);
            if (n == 0) return null;
            body.Write(chunk, 0, n);
        }
        return new HttpRequest(start[0].ToUpperInvariant(), start[1].Split('?')[0], headers, Encoding.UTF8.GetString(body.ToArray(), 0, length));
    }

    private static int IndexOfHeaderEnd(MemoryStream s)
    {
        var b = s.GetBuffer();
        for (var i = 0; i + 3 < s.Length; i++)
            if (b[i] == '\r' && b[i + 1] == '\n' && b[i + 2] == '\r' && b[i + 3] == '\n') return i;
        return -1;
    }
}

internal sealed record HttpResponse(int Code, string Body = "")
{
    public static HttpResponse Status(int code) => new(code);
    public static HttpResponse Json(object value) => new(200, JsonSerializer.Serialize(value, PairingListener.WebJson));

    public async Task WriteAsync(Stream stream, string? origin, CancellationToken ct)
    {
        var body = Encoding.UTF8.GetBytes(Body);
        var head = new StringBuilder()
            .Append($"HTTP/1.1 {Code} {(Code < 300 ? "OK" : "Error")}\r\n")
            .Append("Content-Type: application/json\r\n")
            .Append($"Content-Length: {body.Length}\r\n")
            .Append("Connection: close\r\n");
        if (origin is not null)
        {
            head.Append($"Access-Control-Allow-Origin: {origin}\r\n")
                .Append("Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS\r\n")
                .Append($"Access-Control-Allow-Headers: content-type, {PairingListener.TokenHeader}, {PairingListener.SilentHeader}\r\n")
                .Append("Access-Control-Allow-Private-Network: true\r\n");
        }
        await stream.WriteAsync(Encoding.ASCII.GetBytes(head.Append("\r\n").ToString()), ct);
        await stream.WriteAsync(body, ct);
    }
}
