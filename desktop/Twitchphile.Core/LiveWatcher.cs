namespace Twitchphile.Core;

/// <summary>
/// Polls who's live on a timer and reports changes. The first poll only sets a baseline, so starting the
/// app never announces everyone who happens to already be live.
/// </summary>
public sealed class LiveWatcher(Helix helix, Kick? kick = null) : IDisposable
{
    /// <summary>Kick channels to check each poll ("kick/name" favorites plus the Kick follows the extension sent).</summary>
    public Func<IEnumerable<string>>? KickChannels { get; set; }

    private PeriodicTimer? _timer;
    private CancellationTokenSource? _stop;
    private HashSet<string>? _previous;
    private readonly SemaphoreSlim _pollGate = new(1, 1); // timer and "Check now" must not diff against the same baseline

    public IReadOnlyList<LiveStream> Live { get; private set; } = [];

    /// <summary>The full live list after every poll (background thread).</summary>
    public event Action<IReadOnlyList<LiveStream>>? Updated;

    /// <summary>Each channel that went live since the previous poll (background thread).</summary>
    public event Action<LiveStream>? WentLive;

    public void Start(TimeSpan interval)
    {
        Dispose();
        _stop = new CancellationTokenSource();
        _timer = new PeriodicTimer(interval);
        _ = LoopAsync(_timer, _stop.Token);
    }

    public async Task PollAsync(CancellationToken ct = default)
    {
        await _pollGate.WaitAsync(ct);
        try
        {
            var twitch = helix.LiveFollowedAsync(ct);
            var kickNames = KickChannels?.Invoke().ToList() ?? [];
            IReadOnlyList<LiveStream> kickLive = [];
            if (kick is not null && kickNames.Count > 0)
            {
                // A failed Kick check keeps the Kick channels we last saw, so it can't hold up (or wipe) the Twitch part.
                try { kickLive = await kick.LiveAsync(kickNames, ct); }
                catch (HttpRequestException) { kickLive = [.. Live.Where(s => Kick.IsKick(s.Login))]; }
            }
            IReadOnlyList<LiveStream> live = [.. await twitch, .. kickLive];
            var now = live.Select(s => s.Login).ToHashSet();
            var previous = _previous;
            _previous = now;
            Live = live;
            Updated?.Invoke(live);
            if (previous is null) return;
            foreach (var s in live.Where(s => !previous.Contains(s.Login))) WentLive?.Invoke(s);
        }
        finally
        {
            _pollGate.Release();
        }
    }

    /// <summary>Forget the baseline (e.g. after switching accounts) so the next poll doesn't notify.</summary>
    public void ResetBaseline() => _previous = null;

    private async Task LoopAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            do
            {
                try { await PollAsync(ct); }
                // Offline, an HttpClient timeout (TaskCanceledException), a garbled response: try again next tick.
                // Anything escaping here would end the loop for good, silently.
                catch (Exception) when (!ct.IsCancellationRequested) { }
            } while (await timer.WaitForNextTickAsync(ct).ConfigureAwait(false));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { /* stopped */ }
    }

    public void Dispose()
    {
        _stop?.Cancel();
        _timer?.Dispose();
        _timer = null;
    }
}
