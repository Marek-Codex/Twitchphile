using System.Text.Json;

namespace Twitchphile.Core;

/// <summary>One stream, as seen by our live checks: when it started, how long it ran, viewers, time per game.</summary>
public sealed class StreamSession
{
    public DateTimeOffset Start { get; set; }
    public DateTimeOffset Last { get; set; }
    public int Samples { get; set; }
    public long Sum { get; set; }
    public int Peak { get; set; }
    public Dictionary<string, double> Games { get; set; } = [];
    public string Title { get; set; } = "";

    public double Minutes => Math.Max(0, (Last - Start).TotalMinutes);
    public int Average => Samples == 0 ? 0 : (int)(Sum / Samples);
}

/// <summary>
/// Channel history recorded from the app's own live checks (the same rules as the browser extension's
/// core/history.ts): one session per stream per channel, plus each channel's follower count once a day.
/// Thread-safe; persisted as JSON. Runs while the app sits in the tray, so it sees streams the browser doesn't.
/// </summary>
public sealed class ChannelHistory(string path)
{
    private const int KeepDays = 120;
    private const int MaxSessions = 150;
    private const double MaxGapMinutes = 15; // longer gaps between sightings aren't counted as time in a game

    private readonly Lock _gate = new();
    private Data _data = Load(path);

    private sealed class Data
    {
        public Dictionary<string, List<StreamSession>> Sessions { get; set; } = [];
        public Dictionary<string, SortedDictionary<string, int>> Followers { get; set; } = [];
    }

    public IReadOnlyList<StreamSession> SessionsOf(string login)
    {
        lock (_gate) return _data.Sessions.TryGetValue(login.ToLowerInvariant(), out var s) ? [.. s] : [];
    }

    public IReadOnlyList<(DateOnly Day, int Followers)> FollowersOf(string login)
    {
        lock (_gate)
            return _data.Followers.TryGetValue(login.ToLowerInvariant(), out var f)
                ? [.. f.Select(kv => (DateOnly.Parse(kv.Key), kv.Value))]
                : [];
    }

    /// <summary>True when this channel has no follower reading for today yet.</summary>
    public bool NeedsFollowers(string login, DateOnly today)
    {
        lock (_gate) return !(_data.Followers.TryGetValue(login.ToLowerInvariant(), out var f) && f.ContainsKey(today.ToString("yyyy-MM-dd")));
    }

    /// <summary>Folds one live check into the history.</summary>
    public void Record(IEnumerable<LiveStream> live, DateTimeOffset now)
    {
        lock (_gate)
        {
            var cutoff = now.AddDays(-KeepDays);
            foreach (var s in live)
            {
                var login = s.Login.ToLowerInvariant();
                if (!_data.Sessions.TryGetValue(login, out var sessions)) _data.Sessions[login] = sessions = [];
                var session = sessions.Find(x => x.Start == s.StartedAt);
                if (session is null)
                {
                    sessions.Add(session = new StreamSession { Start = s.StartedAt, Last = now, Title = s.Title });
                }
                else
                {
                    var gap = (now - session.Last).TotalMinutes;
                    if (gap is > 0 and <= MaxGapMinutes && s.Game.Length > 0)
                        session.Games[s.Game] = session.Games.GetValueOrDefault(s.Game) + gap;
                }
                session.Last = now;
                session.Samples++;
                session.Sum += s.Viewers;
                session.Peak = Math.Max(session.Peak, s.Viewers);
                if (s.Title.Length > 0) session.Title = s.Title;
                sessions.RemoveAll(x => x.Last < cutoff);
                if (sessions.Count > MaxSessions) sessions.RemoveRange(0, sessions.Count - MaxSessions);
            }
        }
        Save();
    }

    /// <summary>Notes a channel's follower count for a day (the latest reading of the day wins).</summary>
    public void RecordFollowers(string login, int followers, DateOnly day)
    {
        lock (_gate)
        {
            login = login.ToLowerInvariant();
            if (!_data.Followers.TryGetValue(login, out var f)) _data.Followers[login] = f = [];
            f[day.ToString("yyyy-MM-dd")] = followers;
            while (f.Count > KeepDays) f.Remove(f.Keys.First());
        }
        Save();
    }

    private void Save()
    {
        string json;
        lock (_gate) json = JsonSerializer.Serialize(_data);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path + ".tmp", json);
            File.Move(path + ".tmp", path, overwrite: true);
        }
        catch (IOException) { /* next check saves again */ }
    }

    private static Data Load(string path)
    {
        try { return JsonSerializer.Deserialize<Data>(File.ReadAllText(path)) ?? new(); }
        catch (Exception e) when (e is IOException or JsonException) { return new(); }
    }

    // ---- Derived, for the stats view

    /// <summary>Weekday (0 = Monday) × hour counts of stream starts, in local time.</summary>
    public static int[,] StartHeatmap(IEnumerable<DateTimeOffset> starts)
    {
        var grid = new int[7, 24];
        foreach (var s in starts)
        {
            var local = s.ToLocalTime();
            grid[((int)local.DayOfWeek + 6) % 7, local.Hour]++;
        }
        return grid;
    }
}
