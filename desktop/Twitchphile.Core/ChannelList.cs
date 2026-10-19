using System.Text.Json;

namespace Twitchphile.Core;

/// <summary>
/// A list of channels plus per-channel additions and removals. Legacy clients can still send a
/// whole-list timestamp; current clients merge unrelated edits without overwriting one another.
/// </summary>
public sealed record ChannelChange(bool Present, DateTimeOffset UpdatedAt);

public sealed record ChannelListState(IReadOnlyList<string> Logins, DateTimeOffset UpdatedAt, Dictionary<string, ChannelChange>? Changes = null)
{
    public static readonly ChannelListState Empty = new([], DateTimeOffset.MinValue, []);
}

/// <summary>A synced channel list (favorites, hidden channels) persisted as JSON. Thread-safe; raises <see cref="Changed"/> after every change.</summary>
public sealed class ChannelList(string path)
{
    private readonly Lock _gate = new();
    private ChannelListState _list = Load(path);

    public event Action<ChannelListState>? Changed;

    public ChannelListState Current
    {
        get { lock (_gate) return _list; }
    }

    public bool Contains(string login) => Current.Logins.Contains(login.ToLowerInvariant());

    /// <summary>Adds or removes a channel. Returns whether it is now a favorite.</summary>
    public bool Toggle(string login)
    {
        login = login.ToLowerInvariant();
        ChannelListState next;
        lock (_gate)
        {
            var changes = new Dictionary<string, ChannelChange>(_list.Changes!);
            var stamp = DateTimeOffset.UtcNow;
            if (stamp <= _list.UpdatedAt) stamp = _list.UpdatedAt.AddTicks(1);
            var present = !changes.GetValueOrDefault(login)?.Present ?? true;
            changes[login] = new ChannelChange(present, stamp);
            next = _list = FromChanges(changes);
            Persist(next);
        }
        Changed?.Invoke(next);
        return next.Logins.Contains(login);
    }

    /// <summary>Takes the incoming list if it's newer than ours (sync from the extension). Returns whether it was taken.</summary>
    public bool Merge(ChannelListState incoming)
    {
        ChannelListState next;
        lock (_gate)
        {
            if (incoming.Changes is null && incoming.UpdatedAt <= _list.UpdatedAt) return false;
            var normalized = Normalize(incoming, _list);
            var changes = new Dictionary<string, ChannelChange>(_list.Changes!);
            var changed = false;
            foreach (var (login, entry) in normalized.Changes!)
            {
                if (changes.TryGetValue(login, out var old) &&
                    (old.UpdatedAt > entry.UpdatedAt || (old.UpdatedAt == entry.UpdatedAt && (!old.Present || entry.Present)))) continue;
                changes[login] = entry;
                changed = true;
            }
            if (!changed) return false;
            next = _list = FromChanges(changes);
            Persist(next);
        }
        Changed?.Invoke(next);
        return true;
    }

    private void Persist(ChannelListState list)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(list));
        File.Move(temp, path, overwrite: true); // atomic replace: a crash never leaves a half-written file
    }

    private static ChannelListState Load(string path)
    {
        try
        {
            var list = JsonSerializer.Deserialize<ChannelListState>(File.ReadAllText(path));
            return list?.Logins is null ? ChannelListState.Empty : Normalize(list);
        }
        catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException or JsonException)
        {
            return ChannelListState.Empty;
        }
    }

    private static ChannelListState Normalize(ChannelListState state, ChannelListState? current = null)
    {
        var changes = new Dictionary<string, ChannelChange>();
        foreach (var (raw, entry) in state.Changes ?? [])
        {
            var login = Clean(raw);
            if (login.Length > 0) changes[login] = entry;
        }
        foreach (var raw in state.Logins)
        {
            var login = Clean(raw);
            if (login.Length > 0 && !changes.ContainsKey(login)) changes[login] = new ChannelChange(true, state.UpdatedAt);
        }
        // Older extension builds send whole lists without per-channel changes. A newer legacy list's
        // missing members are removals, so translate them into tombstones while migrating.
        if (state.Changes is null && current is not null && state.UpdatedAt > current.UpdatedAt)
            foreach (var login in current.Logins.Except(state.Logins.Select(Clean)))
                changes[login] = new ChannelChange(false, state.UpdatedAt);
        return FromChanges(changes);
    }

    private static ChannelListState FromChanges(Dictionary<string, ChannelChange> changes) => new(
        changes.Where(kv => kv.Value.Present).OrderBy(kv => kv.Value.UpdatedAt).ThenBy(kv => kv.Key).Select(kv => kv.Key).ToList(),
        changes.Count == 0 ? DateTimeOffset.MinValue : changes.Values.Max(v => v.UpdatedAt), changes);

    private static string Clean(string login) => login.Trim().TrimStart('@').ToLowerInvariant();
}
