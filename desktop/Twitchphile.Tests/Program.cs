using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Twitchphile.Core;

// Plain console test runner (family convention): `dotnet run --project Twitchphile.Tests`. Exit code = failures.
var failures = 0;
var tests = new (string Name, Func<Task> Run)[]
{
    ("favorites: toggle adds, removes, lowercases and persists", favoritesToggle),
    ("favorites: legacy whole lists accept only newer changes", favoritesMerge),
    ("favorites: independent edits and removals merge per channel", favoritesPerChannelMerge),
    ("favorites: concurrent changes persist the final list", favoritesConcurrent),
    ("pairing: web pages are refused, extensions are allowed", PairingOrigins),
    ("pairing: pair needs approval, then the token unlocks favorites", PairingFlow),
    ("pairing: PUT /favorites accepts legacy sync over a real socket", PairingSocketSync),
    ("pairing: current protocol merges independent edits over a real socket", PairingSocketMerge),
    ("pairing: malformed sync requests get a 400 response", PairingBadJson),
    ("pairing: hidden channels sync like favorites, separately", PairingHidden),
    ("live watcher: first poll is a baseline, then reports who went live", LiveWatcherDiff),
    ("shared sign-in: a paired extension can borrow the app's session", SessionLend),
    ("shared sign-in: the app borrows an offered token only if it's ours", SessionBorrow),
    ("pairing: our own extension pairs silently; others must be allowed; web pages never", PairTrust),
    ("history: one session per stream with peak, average and time per game; daily followers", HistoryRecord),
    ("drops: PUT /drops needs pairing and delivers the extension's summary", DropsPut),
    ("kick: channel data becomes a live stream; offline and unknown channels don't", KickParse),
    ("kick: signed out of Twitch, the watcher still reports Kick channels going live", KickWatcher),
    ("kick: PUT /kick-follows needs pairing and passes only kick/ names", KickFollowsPut),
};

foreach (var (name, run) in tests)
{
    try
    {
        await run();
        Console.WriteLine($"  ok    {name}");
    }
    catch (Exception e)
    {
        failures++;
        Console.WriteLine($"  FAIL  {name}\n        {e.Message}");
    }
}
Console.WriteLine(failures == 0 ? $"\n{tests.Length} passed" : $"\n{failures} of {tests.Length} failed");
return failures;

// ---- tests

static Task favoritesToggle()
{
    var path = TempFile();
    var favs = new ChannelList(path);
    Assert(favs.Toggle("Foo"), "toggle on");
    Assert(favs.Contains("foo"), "stored lowercase");
    Assert(!favs.Toggle("FOO"), "toggle off, case-insensitive");
    favs.Toggle("bar");
    Assert(new ChannelList(path).Current.Logins.SequenceEqual(["bar"]), "reloads from disk");
    return Task.CompletedTask;
}

static Task favoritesMerge()
{
    var favs = new ChannelList(TempFile());
    favs.Toggle("mine");
    var now = favs.Current.UpdatedAt;
    Assert(!favs.Merge(new ChannelListState(["old"], now.AddMinutes(-1))), "older list is ignored");
    Assert(favs.Merge(new ChannelListState([" @New ", "new"], now.AddMinutes(1))), "newer list is taken");
    Assert(favs.Current.Logins.SequenceEqual(["new"]), "normalized + de-duplicated");
    return Task.CompletedTask;
}

static Task favoritesConcurrent()
{
    var path = TempFile();
    var favs = new ChannelList(path);
    Parallel.For(0, 40, i => favs.Toggle($"channel{i}"));
    Assert(new ChannelList(path).Current.Logins.ToHashSet().SetEquals(favs.Current.Logins), "saved list matches the final in-memory list");
    return Task.CompletedTask;
}

static Task favoritesPerChannelMerge()
{
    var path = TempFile();
    var favs = new ChannelList(path);
    favs.Toggle("base");
    var original = favs.Current;
    favs.Toggle("app");
    var remoteStamp = original.UpdatedAt.AddMinutes(1);
    var remote = new ChannelListState(["base", "extension"], remoteStamp, new()
    {
        ["base"] = original.Changes!["base"],
        ["extension"] = new ChannelChange(true, remoteStamp),
    });
    Assert(favs.Merge(remote), "remote channel added");
    Assert(favs.Current.Logins.ToHashSet().SetEquals(["base", "app", "extension"]), "independent additions kept");

    favs.Toggle("base");
    Assert(!favs.Current.Logins.Contains("base"), "base removed locally");
    Assert(!favs.Merge(remote) && !favs.Current.Logins.Contains("base"), "older remote presence cannot resurrect a removal");
    Assert(new ChannelList(path).Current.Logins.ToHashSet().SetEquals(["app", "extension"]), "merged changes and removal survive restart");
    return Task.CompletedTask;
}

static async Task PairingOrigins()
{
    var listener = new PairingListener(new ChannelList(TempFile())) { PairRequested = _ => Task.FromResult(true) };
    var web = await listener.RouteAsync(Req("GET", "/ping", origin: "https://evil.example"));
    Assert(web.Code == 403, $"web origin refused (got {web.Code})");
    var ext = await listener.RouteAsync(Req("GET", "/ping", origin: "chrome-extension://abc"));
    Assert(ext.Code == 200 && ext.Body.Contains("twitchphile"), "extension origin allowed");
}

static async Task PairingFlow()
{
    var approve = false;
    var listener = new PairingListener(new ChannelList(TempFile())) { PairRequested = _ => Task.FromResult(approve) };
    Assert((await listener.RouteAsync(Req("GET", "/favorites"))).Code == 401, "favorites need a token");
    Assert((await listener.RouteAsync(Req("POST", "/pair"))).Code == 403, "declined pairing is refused");

    approve = true;
    var paired = await listener.RouteAsync(Req("POST", "/pair"));
    Assert(paired.Code == 200 && listener.Token is { Length: > 20 }, "approved pairing issues a token");
    Assert((await listener.RouteAsync(Req("GET", "/favorites", token: "wrong"))).Code == 401, "wrong token refused");
    Assert((await listener.RouteAsync(Req("GET", "/favorites", token: listener.Token))).Code == 200, "right token accepted");
}

static async Task PairingSocketSync()
{
    var favs = new ChannelList(TempFile());
    favs.Toggle("app-side");
    var port = FreePort();
    using var listener = new PairingListener(favs, port: port) { Token = "secret" };
    listener.Start();

    var newer = $$"""{"logins":["Ext-Side"],"updatedAt":"{{DateTimeOffset.UtcNow.AddMinutes(1):O}}"}""";
    var (status, body) = await RawAsync(port, "PUT", "/favorites", newer, token: "secret");
    Assert(status == 200 && body.Contains("ext-side"), $"newer extension list wins (got {status} {body})");
    Assert(favs.Contains("ext-side") && !favs.Contains("app-side"), "store updated");

    var (unauth, _) = await RawAsync(port, "GET", "/favorites", null, token: null);
    Assert(unauth == 401, "no token over the socket → 401");
}

static async Task PairingBadJson()
{
    var port = FreePort();
    using var listener = new PairingListener(new ChannelList(TempFile()), port: port) { Token = "secret" };
    listener.Start();
    var (malformed, _) = await RawAsync(port, "PUT", "/favorites", "{broken", token: "secret");
    Assert(malformed == 400, "malformed JSON returns 400");
    var (missingList, _) = await RawAsync(port, "PUT", "/favorites", "{\"logins\":null,\"updatedAt\":\"2026-01-01T00:00:00Z\"}", token: "secret");
    Assert(missingList == 400, "null list returns 400");
    var (healthy, _) = await RawAsync(port, "GET", "/ping", null, token: "secret");
    Assert(healthy == 200, "listener still handles requests");
}

static async Task PairingSocketMerge()
{
    var favs = new ChannelList(TempFile());
    favs.Toggle("app-side");
    var port = FreePort();
    using var listener = new PairingListener(favs, port: port) { Token = "secret" };
    listener.Start();
    var stamp = DateTimeOffset.UtcNow.AddSeconds(1);
    var incoming = new ChannelListState(["ext-side"], stamp, new() { ["ext-side"] = new ChannelChange(true, stamp) });
    var (status, body) = await RawAsync(port, "PUT", "/favorites", JsonSerializer.Serialize(incoming, PairingListener.WebJson), token: "secret");
    var merged = JsonSerializer.Deserialize<ChannelListState>(body, PairingListener.WebJson);
    Assert(status == 200 && merged?.Logins.ToHashSet().SetEquals(["app-side", "ext-side"]) == true, "both sides' additions returned");
    Assert(merged?.Changes?.Count == 2 && favs.Current.Logins.Count == 2, "merged per-channel ledger persisted");
}

static async Task PairingHidden()
{
    var favs = new ChannelList(TempFile());
    var hidden = new ChannelList(TempFile());
    var listener = new PairingListener(favs, hidden: hidden) { Token = "secret" };
    var body = $$"""{"logins":["Spammy"],"updatedAt":"{{DateTimeOffset.UtcNow:O}}"}""";
    var res = await listener.RouteAsync(Req("PUT", "/hidden", token: "secret", body: body));
    Assert(res.Code == 200 && hidden.Contains("spammy"), $"hidden list taken (got {res.Code} {res.Body})");
    Assert(!favs.Contains("spammy"), "favorites untouched");
    var bare = new PairingListener(favs) { Token = "secret" };
    Assert((await bare.RouteAsync(Req("GET", "/hidden", token: "secret"))).Code == 404, "no hidden list → 404");
}

static async Task LiveWatcherDiff()
{
    var live = new List<string> { "a" };
    var http = new HttpClient(new FakeTwitch(() => live));
    var auth = new TwitchAuth(http, new MemorySessions(new TwitchSession("1", "me", "tok", "ref", DateTimeOffset.UtcNow.AddHours(1))));
    var watcher = new LiveWatcher(new Helix(http, auth));
    var wentLive = new List<string>();
    watcher.WentLive += s => wentLive.Add(s.Login);

    await watcher.PollAsync();
    Assert(wentLive.Count == 0, "baseline poll notifies nobody");
    live.AddRange(["b", "c"]);
    await watcher.PollAsync();
    Assert(wentLive.SequenceEqual(["b", "c"]), $"b and c went live (got {string.Join(",", wentLive)})");
    live.Remove("b");
    await watcher.PollAsync();
    Assert(wentLive.Count == 2 && watcher.Live.Count == 2, "going offline is not an event");
}

static async Task SessionLend()
{
    var auth = new TwitchAuth(new HttpClient(), new MemorySessions(new TwitchSession("1", "me", "app-token", "refresh", DateTimeOffset.UtcNow.AddHours(3))));
    var listener = new PairingListener(new ChannelList(TempFile()), auth) { Token = "secret" };
    Assert((await listener.RouteAsync(Req("GET", "/session"))).Code == 401, "unpaired callers get nothing");
    var lent = await listener.RouteAsync(Req("GET", "/session", token: "secret"));
    Assert(lent.Code == 200 && lent.Body.Contains("app-token") && lent.Body.Contains("\"login\":\"me\""), $"paired caller gets the session (got {lent.Body})");
    var ping = await listener.RouteAsync(Req("GET", "/ping"));
    Assert(ping.Body.Contains("\"signedIn\":true"), "ping reports the app is signed in");
}

static async Task PairTrust()
{
    var asked = 0;
    var listener = new PairingListener(new ChannelList(TempFile())) { PairRequested = _ => { asked++; return Task.FromResult(false); } };
    Assert((await listener.RouteAsync(Req("POST", "/pair", origin: PairingListener.OwnExtensionOrigin))).Code == 200 && asked == 0, "own extension: no prompt");
    Assert((await listener.RouteAsync(Req("POST", "/pair", origin: "chrome-extension://someoneelseabcdefghijklmnopabcd"))).Code == 403 && asked == 1, "other extension: asked, declined");
    Assert((await listener.RouteAsync(Req("POST", "/pair", origin: "moz-extension://1234-abcd"))).Code == 403 && asked == 2, "Firefox add-on: asked too");
    Assert((await listener.RouteAsync(Req("GET", "/ping", origin: "https://evil.example"))).Code == 403, "web pages refused");
    var silent = Req("POST", "/pair", origin: "chrome-extension://someoneelseabcdefghijklmnopabcd");
    silent.Headers[PairingListener.SilentHeader] = "1";
    Assert((await listener.RouteAsync(silent)).Code == 403 && asked == 2, "a silent ask from anyone else is refused without prompting");
    var ours = Req("POST", "/pair", origin: PairingListener.OwnExtensionOrigin);
    ours.Headers[PairingListener.SilentHeader] = "1";
    Assert((await listener.RouteAsync(ours)).Code == 200, "a silent ask from our own extension pairs");
}

static Task HistoryRecord()
{
    var path = TempFile();
    var h = new ChannelHistory(path);
    var start = new DateTimeOffset(2026, 10, 1, 18, 0, 0, TimeSpan.Zero);
    LiveStream S(int viewers, string game) => new("1", "A", "A", game, "t", viewers, start, "");
    h.Record([S(100, "Rust")], start.AddMinutes(5));
    h.Record([S(300, "Rust")], start.AddMinutes(7));
    h.Record([S(200, "Chess")], start.AddMinutes(9));
    h.Record([S(200, "Chess")], start.AddMinutes(60)); // 51-minute gap: not game time
    var s = h.SessionsOf("a").Single();
    Assert(s.Peak == 300 && s.Average == 200 && Math.Round(s.Minutes) == 60, $"peak/avg/length (got {s.Peak}/{s.Average}/{s.Minutes})");
    Assert(s.Games["Rust"] == 2 && s.Games["Chess"] == 2, "time per game");
    h.RecordFollowers("A", 100, new DateOnly(2026, 10, 1));
    h.RecordFollowers("a", 110, new DateOnly(2026, 10, 1));
    Assert(h.FollowersOf("a").Single().Followers == 110 && !h.NeedsFollowers("a", new DateOnly(2026, 10, 1)), "one reading per day, latest wins");
    Assert(new ChannelHistory(path).SessionsOf("a").Count == 1, "survives a restart");
    return Task.CompletedTask;
}

static async Task DropsPut()
{
    var listener = new PairingListener(new ChannelList(TempFile())) { Token = "secret" };
    DropsState? got = null;
    listener.DropsUpdated += d => got = d;
    const string body = """
        {"at":1,"campaigns":[{"id":"c1","name":"Event","game":"Rust","gameArt":"","endsAt":"2026-10-01T00:00:00Z",
        "drops":[{"id":"d1","name":"Skin","image":"","minutes":120,"required":120,"claimed":false,"claimable":true}]}]}
        """;
    Assert((await listener.RouteAsync(Req("PUT", "/drops", body: body))).Code == 401, "unpaired callers can't push");
    Assert(got is null, "nothing delivered without the token");
    Assert((await listener.RouteAsync(Req("PUT", "/drops", token: "secret", body: body))).Code == 200, "paired push accepted");
    Assert(got is { Campaigns: [{ Game: "Rust", Drops: [{ Claimable: true, Minutes: 120 }] }] }, "summary parsed");
}

static async Task SessionBorrow()
{
    var clientId = TwitchAuth.ClientId;
    var http = new HttpClient(new FakeValidate(() => clientId));
    var auth = new TwitchAuth(http, new MemorySessions(null));
    var listener = new PairingListener(new ChannelList(TempFile()), auth) { Token = "secret" };

    clientId = "someone-elses-app";
    await listener.RouteAsync(Req("PUT", "/session", token: "secret", body: """{"accessToken":"stolen"}"""));
    Assert(!auth.IsSignedIn, "a token from a different Twitch app is refused");

    clientId = TwitchAuth.ClientId;
    var res = await listener.RouteAsync(Req("PUT", "/session", token: "secret", body: """{"accessToken":"ext-token"}"""));
    Assert(res.Body.Contains("\"signedIn\":true") && auth.IsBorrowed && auth.Session!.Login == "viewer", $"our own app's token is borrowed (got {res.Body})");
    Assert(!await auth.RefreshAsync(), "a borrowed session can't be refreshed");
}

// ---- helpers

static void Assert(bool condition, string what)
{
    if (!condition) throw new Exception(what);
}

static async Task KickParse()
{
    var kick = new Kick(new HttpClient(new FakeKick(() => ["xqc"])));
    var live = await kick.LiveAsync(["kick/xqc", "kick/OffLine", "kick/missing"]);
    Assert(live.Count == 1, $"only the live one (got {live.Count})");
    var s = live[0];
    Assert(s.Login == "kick/xqc" && s.Name == "xQc" && s.Game == "Just Chatting" && s.Viewers == 1234, $"fields read (got {s})");
    Assert(s.StartedAt == new DateTimeOffset(2026, 10, 13, 17, 30, 0, TimeSpan.Zero), $"Kick's zone-less time is UTC (got {s.StartedAt})");
    Assert(s.AvatarUrl == "https://pic/xqc" && s.ThumbnailUrl == "https://thumb/xqc", "avatar and thumbnail");
    Assert(Kick.Url("kick/XQC", "/videos") == "https://kick.com/xqc/videos" && Kick.Url("xqc") == "https://www.twitch.tv/xqc", "links per site");
}

static async Task KickWatcher()
{
    var live = new List<string>();
    var http = new HttpClient(new FakeKick(() => live));
    var watcher = new LiveWatcher(new Helix(http, new TwitchAuth(http, new MemorySessions(null))), new Kick(http))
    {
        KickChannels = () => ["kick/a", "kick/b"],
    };
    var wentLive = new List<string>();
    watcher.WentLive += s => wentLive.Add(s.Login);
    await watcher.PollAsync();
    live.Add("b");
    await watcher.PollAsync();
    Assert(wentLive.SequenceEqual(["kick/b"]), $"kick/b went live (got {string.Join(",", wentLive)})");
}

static async Task KickFollowsPut()
{
    var listener = new PairingListener(new ChannelList(TempFile())) { Token = "secret" };
    IReadOnlyList<string>? got = null;
    listener.KickFollowsUpdated += f => got = f;
    var body = """{"channels":["kick/A","xqc","kick/b"]}""";
    Assert((await listener.RouteAsync(Req("PUT", "/kick-follows", body: body))).Code == 401 && got is null, "unpaired callers are refused");
    Assert((await listener.RouteAsync(Req("PUT", "/kick-follows", token: "secret", body: body))).Code == 200, "paired caller accepted");
    Assert(got is not null && got.SequenceEqual(["kick/a", "kick/b"]), $"only kick/ names, lowercased (got {string.Join(",", got ?? [])})");
}


static string TempFile() => Path.Combine(Path.GetTempPath(), "twitchphile-tests", Guid.NewGuid() + ".json");

static int FreePort()
{
    var l = new TcpListener(IPAddress.Loopback, 0);
    l.Start();
    var port = ((IPEndPoint)l.LocalEndpoint).Port;
    l.Stop();
    return port;
}

static HttpRequest Req(string method, string path, string? origin = null, string? token = null, string body = "")
{
    var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    if (origin is not null) headers["origin"] = origin;
    if (token is not null) headers[PairingListener.TokenHeader] = token;
    return new HttpRequest(method, path, headers, body);
}

static async Task<(int Status, string Body)> RawAsync(int port, string method, string path, string? body, string? token)
{
    using var client = new TcpClient();
    await client.ConnectAsync(IPAddress.Loopback, port);
    var stream = client.GetStream();
    var payload = Encoding.UTF8.GetBytes(body ?? "");
    var head = $"{method} {path} HTTP/1.1\r\nHost: localhost\r\nOrigin: chrome-extension://test\r\n" +
               (token is null ? "" : $"{PairingListener.TokenHeader}: {token}\r\n") +
               $"Content-Length: {payload.Length}\r\n\r\n";
    await stream.WriteAsync(Encoding.ASCII.GetBytes(head));
    await stream.WriteAsync(payload);
    var text = await new StreamReader(stream).ReadToEndAsync();
    var status = int.Parse(text.Split(' ')[1]);
    return (status, text[(text.IndexOf("\r\n\r\n", StringComparison.Ordinal) + 4)..]);
}

sealed class MemorySessions(TwitchSession? session) : ISessionStore
{
    public TwitchSession? Load() => session;
    public void Save(TwitchSession? s) => session = s;
}

// Answers streams/followed with whoever is in the list.
sealed class FakeTwitch(Func<List<string>> live) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        if (request.RequestUri!.AbsolutePath.EndsWith("/users"))
        {
            var users = "{\"data\":[" + string.Join(",", live().Select(l => $$"""{"id":"{{l}}","profile_image_url":"https://img/{{l}}"}""")) + "]}";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(users, Encoding.UTF8, "application/json") });
        }
        var rows = live().Select(l =>
            $$"""{"user_id":"{{l}}","user_login":"{{l}}","user_name":"{{l}}","game_name":"g","title":"t","viewer_count":1,"started_at":"2026-01-01T00:00:00Z","thumbnail_url":""}""");
        var json = "{\"data\":[" + string.Join(",", rows) + "],\"pagination\":{}}";
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") });
    }
}

// Answers id.twitch.tv/oauth2/validate as if the token belonged to the given client.
sealed class FakeValidate(Func<string> clientId) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var json = $$"""{"client_id":"{{clientId()}}","login":"viewer","user_id":"42","expires_in":3600}""";
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") });
    }
}

/// <summary>Kick's channel endpoint: channels in <c>live()</c> are live, "missing" is a 404, the rest are offline.</summary>
sealed class FakeKick(Func<List<string>> live) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var slug = request.RequestUri!.AbsolutePath.Split('/').Last();
        if (request.RequestUri.Host != "kick.com" || slug == "missing") return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        var stream = live().Contains(slug)
            ? $$"""{"is_live":true,"session_title":"hi","viewer_count":1234,"start_time":"2026-10-13 17:30:00","categories":[{"name":"Just Chatting"}],"thumbnail":{"url":"https://thumb/{{slug}}"}""" + "}"
            : "null";
        var name = slug == "xqc" ? "xQc" : slug;
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent($$"""{"slug":"{{slug}}","user":{"username":"{{name}}","profile_pic":"https://pic/{{slug}}"},"livestream":""" + stream + "}"),
        });
    }
}
