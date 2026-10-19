// Toolbar popup. ★ favorites: all your favorites, live ones first (plus upcoming + recently ended).
// Following: everyone you follow, searchable, live first — star anyone from here.
import { channelLabel, channelName, channelUrl, isKick, KICK_PREFIX } from "../../core/channels";
import { KICK_FOLLOWS_KEY, type KickFollow } from "../../core/kick-live";
import { render, type ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { platform } from "@platform";
import { ENDED_KEY, type EndedStream } from "../../core/alerts";
import { AUTO_OPEN_KEY, type State as AutoOpenState } from "../../core/auto-open";
import { WATCH_KEY, type Counts } from "../../core/channel-data";
import { FOLLOWS_KEY, type Followed } from "../../core/follows";
import { fmtCompact, fmtDuration } from "../../core/format";
import { LIVE_AT_KEY, LIVE_KEY, type LiveChannel } from "../../core/live";
import { SCHEDULE_KEY, type Upcoming } from "../../core/schedule";
import { settings, type Settings } from "../../core/settings";
import { lowerSet, toggleIn } from "../../core/util";
import { Icon } from "../Icon";
import { hide, hourglass, refresh as refreshIcon, settings as settingsIcon, star, users } from "../icons";

const weekdayTime = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const openTab = (url: string) => (e: MouseEvent) => (e.preventDefault(), platform.tabs.open(url, { active: true }));

function useLocal<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    platform.local.get<T>(key).then((v) => setValue(v ?? fallback));
    return platform.local.onChange(key, (v) => setValue((v as T) ?? fallback));
  }, []);
  return value;
}

// Re-render on a steady beat so uptimes and "checked … ago" keep moving while the popup is open.
function useTick(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, []);
}

const ago = (at: number) => (Date.now() - at < 60_000 ? "JUST NOW" : `${fmtDuration(Date.now() - at).toUpperCase()} AGO`);

// ---- Rows

function Avatar({ src, name, live }: { src?: string; name: string; live?: boolean }) {
  return (
    <span class={`av${live ? " live" : ""}`}>
      {src ? <img src={src} alt="" loading="lazy" /> : <span class="initial">{name.slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}

function StarButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button class={`star${on ? " on" : ""}`} title={on ? "Remove from favorites" : "Add to favorites"} aria-label="favorite" onClick={onClick}>
      <Icon icon={star} size={14} />
    </button>
  );
}

function LiveRow({ c, avatar, watched, fav, onStar, extra }: { c: LiveChannel; avatar?: string; watched?: number; fav: boolean; onStar: () => void; extra?: ComponentChildren }) {
  return (
    <li class="live-row">
      <a href={channelUrl(c.login)} onClick={openTab(channelUrl(c.login))}>
        <Avatar src={avatar} name={c.name} live />
        <div class="meta">
          <div class="line">
            <span class="name">
              {c.name}
              {isKick(c.login) && <span class="tag kick">KICK</span>}
              {!c.followed && <span class="tag">WATCHING</span>}
            </span>
            <span class="viewers">{fmtCompact(c.viewers)}</span>
          </div>
          <div class="game">{c.game || "Streaming"}</div>
          <div class="title" title={c.title}>
            {c.title}
          </div>
          <div class="sub">
            {fmtDuration(Date.now() - Date.parse(c.startedAt))}
            {watched != null && watched >= 60 && (
              <span class="wt">
                {" · "}
                <Icon icon={hourglass} size={10} /> {fmtDuration(watched * 1000)}
              </span>
            )}
          </div>
        </div>
      </a>
      {extra}
      <StarButton on={fav} onClick={onStar} />
    </li>
  );
}

function OfflineRow({ login, name, avatar, fav, onStar, extra }: { login: string; name: string; avatar?: string; fav: boolean; onStar: () => void; extra?: ComponentChildren }) {
  return (
    <li class="off-row">
      <a href={channelUrl(login)} onClick={openTab(channelUrl(login))}>
        <Avatar src={avatar} name={name} />
        <span class="name">{name}</span>
      </a>
      <StarButton on={fav} onClick={onStar} />
    </li>
  );
}

function ListRow({ href, title, name, detail, nums }: { href: string; title?: string; name: string; detail: string; nums: ComponentChildren }) {
  return (
    <li>
      <a href={href} title={title} onClick={openTab(href)}>
        <div class="meta">
          <div class="name">{name}</div>
          <div class="title">{detail}</div>
        </div>
        <div class="nums">{nums}</div>
      </a>
    </li>
  );
}

const Section = ({ title, children }: { title: string; children: ComponentChildren }) => (
  <>
    <h2 class="sec">[ {title} ]</h2>
    <ul>{children}</ul>
  </>
);

// ---- App

function App() {
  const [account, setAccount] = useState<{ login: string } | null | undefined>(undefined);
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"favorites" | "following">("favorites");
  const [query, setQuery] = useState("");
  const live = useLocal<LiveChannel[]>(LIVE_KEY, []);
  const watch = useLocal<Counts>(WATCH_KEY, {});
  const ended = useLocal<EndedStream[]>(ENDED_KEY, []);
  const schedule = useLocal<{ items: Upcoming[] }>(SCHEDULE_KEY, { items: [] });
  const follows = useLocal<{ list: Followed[] }>(FOLLOWS_KEY, { list: [] }).list;
  const checkedAt = useLocal<number>(LIVE_AT_KEY, 0);
  const dismissed = useLocal<Partial<AutoOpenState>>(AUTO_OPEN_KEY, {}).dismissed ?? [];
  useTick(30_000);

  useEffect(() => {
    settings.load().then((v) => setS({ ...v }));
    const off = settings.onChange(() => setS({ ...settings.get() }));
    platform.send<{ login: string } | null>({ type: "auth:status" }).then((a) => {
      setAccount(a);
      if (a) refresh(false);
    });
    return off;
  }, []);

  // Refresh = check now. `fresh` is the separate "Reopen closed" chip: streams you closed get their tabs back.
  async function refresh(fresh = false) {
    setBusy(true);
    await Promise.all([platform.send({ type: "live:refresh", fresh }), platform.send({ type: "follows:refresh" })]);
    setBusy(false);
  }

  async function connect() {
    setBusy(true);
    const a = await platform.send<{ login: string } | { error: string } | null>({ type: "auth:connect" });
    if (a && "login" in a) setAccount(a);
    setBusy(false);
  }

  const kickFollows = useLocal<KickFollow[]>(KICK_FOLLOWS_KEY, []);
  const byLogin = useMemo(
    () => new Map([...follows.map((f) => [f.login, f] as const), ...kickFollows.map((k) => [KICK_PREFIX + k.slug, { login: KICK_PREFIX + k.slug, name: k.name, avatar: k.avatar }] as const)]),
    [follows, kickFollows],
  );
  if (!s || account === undefined) return null;

  const favs = lowerSet(s.favorites);
  const hidden = lowerSet(s.hiddenChannels);
  const liveByLogin = new Map(live.map((c) => [c.login, c]));
  const dir = s.liveSort === "fewest" ? 1 : -1;
  const byViewers = (a: LiveChannel, b: LiveChannel) => dir * (a.viewers - b.viewers);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const toggleFav = (login: string) => () => settings.set({ favorites: toggleIn(s.favorites, login) });
  const hideButton = (login: string) => (
    <button class="star hide" title="Hide from lists (undo in settings → favorites)" aria-label="Hide" onClick={() => settings.set({ hiddenChannels: [...s.hiddenChannels, login] })}>
      <Icon icon={hide} size={14} />
    </button>
  );
  const liveFavCount = live.filter((c) => favs.has(c.login)).length;

  // ★ favorites: every favorite, live first.
  const favLive = live.filter((c) => favs.has(c.login)).sort(byViewers);
  const favOffline = [...favs]
    .filter((login) => !liveByLogin.has(login))
    .map((login) => ({ login, name: byLogin.get(login)?.name ?? channelLabel(login), avatar: byLogin.get(login)?.avatar }))
    .sort(byName);
  const upcoming = schedule.items.filter((u) => Date.parse(u.start) > Date.now());

  // Following: search, live first; favorites lead each group.
  const q = query.trim().toLowerCase();
  const pasted = /(kick\.com|twitch\.tv)\/|^kick\//i.test(q) && !favs.has(channelName(q)) ? channelName(q) : "";
  const match = (login: string, name: string) => !q || login.includes(q) || name.toLowerCase().includes(q);
  const favFirst = (a: { login: string }, b: { login: string }) => Number(favs.has(b.login)) - Number(favs.has(a.login));
  const folLive = live.filter((c) => c.followed && !hidden.has(c.login) && match(c.login, c.name)).sort((a, b) => favFirst(a, b) || byViewers(a, b));

  // Offline followed channels (Twitch + Kick), merged into one list.
  const offlineRows = [
    ...follows.map((f) => ({ login: f.login, name: f.name, avatar: f.avatar } as const)),
    ...kickFollows.map((k) => ({ login: KICK_PREFIX + k.slug, name: k.name, avatar: k.avatar } as const)),
  ];
  const folOffline = offlineRows
    .filter((r) => !liveByLogin.has(r.login) && !hidden.has(r.login) && match(r.login, r.name))
    .sort((a, b) => favFirst(a, b) || byName(a, b));

  return (
    <>
      <header>
        <span class="mark">
          Twitch<b>phile</b>
        </span>
        <span class="status">
          <i class={liveFavCount ? "on" : ""} /> {account ? `${liveFavCount} ★ LIVE` : "SIGNED OUT"}
        </span>
        {account && (
          <button class={`icon${busy ? " spin" : ""}`} title="Check now" aria-label="Check now" onClick={() => refresh()}>
            <Icon icon={refreshIcon} size={14} />
          </button>
        )}
        <button class="icon" title="Settings" aria-label="Settings" onClick={() => { void platform.tabs.open(platform.url("options.html"), { active: true }); window.close(); }}>
          <Icon icon={settingsIcon} size={14} />
        </button>
      </header>

      {account && (
        <nav class="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "favorites"} onClick={() => setTab("favorites")}>
            <Icon icon={star} size={12} /> favorites <span class="n">{favs.size}</span>
          </button>
          <button role="tab" aria-selected={tab === "following"} onClick={() => setTab("following")}>
            <Icon icon={users} size={12} /> Following <span class="n">{follows.length || ""}</span>
          </button>
          {checkedAt > 0 && (
            <span class="checked" title={`Checks every ${s.pollMinutes} min`}>
              {busy ? "CHECKING…" : `CHECKED ${ago(checkedAt)}`}
            </span>
          )}
        </nav>
      )}

      <main>
        {!account ? (
          <div class="empty">
            <p>Connect your Twitch account to see who you follow is live — and auto-open their streams.</p>
            <button class="primary" disabled={busy} onClick={connect}>
              {busy ? "Waiting for Twitch…" : "Connect Twitch"}
            </button>
          </div>
        ) : tab === "favorites" ? (
          <>
            {favs.size === 0 && (
              <div class="empty">
                <p>No favorites yet. Star channels in Following — they'll live here, live ones on top.</p>
                <button class="primary" onClick={() => setTab("following")}>
                  Browse who you follow
                </button>
              </div>
            )}
            {favLive.length > 0 && (
              <Section title={`LIVE NOW · ${favLive.length}`}>
                {favLive.map((c) => (
                  <LiveRow key={c.login} c={c} avatar={byLogin.get(c.login)?.avatar ?? c.avatar} watched={watch[c.login]} fav onStar={toggleFav(c.login)} />
                ))}
              </Section>
            )}
            {favOffline.length > 0 && (
              <Section title={`OFFLINE · ${favOffline.length}`}>
                {favOffline.map((f) => (
                  <OfflineRow key={f.login} {...f} fav onStar={toggleFav(f.login)} />
                ))}
              </Section>
            )}
            {upcoming.length > 0 && (
              <details class="ended">
                <summary>[ UPCOMING · {upcoming.length} ]</summary>
                <ul>
                  {upcoming.slice(0, 10).map((u) => (
                    <ListRow key={u.login + u.start} href={channelUrl(u.login, "/schedule")} title={u.title} name={u.name} detail={u.category || u.title}
                      nums={<span>{weekdayTime.format(new Date(u.start))}</span>} />
                  ))}
                </ul>
              </details>
            )}
            {ended.length > 0 && (
              <details class="ended">
                <summary>[ RECENTLY ENDED · {ended.length} ]</summary>
                <ul>
                  {ended.map((e) => (
                    <ListRow key={e.login} href={channelUrl(e.login, "/videos")} title="Open their past broadcasts" name={e.name} detail={e.game || e.title}
                      nums={
                        <>
                          <span>{fmtDuration(Date.now() - e.endedAt)} ago</span>
                          <span>ran {fmtDuration(e.endedAt - Date.parse(e.startedAt))}</span>
                        </>
                      } />
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : (
          <>
            <div class="search">
              <input placeholder="Search who you follow" value={query} onInput={(e) => setQuery(e.currentTarget.value)} autoFocus />
            </div>
            {/* A pasted channel link (Kick or Twitch): offer to star it, since search only filters. */}
            {pasted && (
              <button class="add-fav" onClick={() => (settings.set({ favorites: [...s.favorites, pasted] }), setQuery(""))}>
                ★ Add <b>{channelLabel(pasted)}</b> to favorites
              </button>
            )}
            {folLive.length > 0 && (
              <Section title={`LIVE NOW · ${folLive.length}`}>
                {folLive.map((c) => (
                  <LiveRow key={c.login} c={c} avatar={byLogin.get(c.login)?.avatar ?? c.avatar} fav={favs.has(c.login)} onStar={toggleFav(c.login)} extra={hideButton(c.login)} />
                ))}
              </Section>
            )}
            {folOffline.length > 0 && (
              <Section title={`OFFLINE · ${folOffline.length}`}>
                {folOffline.map((f) => (
                  <OfflineRow key={f.login} login={f.login} name={f.name} avatar={f.avatar} fav={favs.has(f.login)} onStar={toggleFav(f.login)} extra={hideButton(f.login)} />
                ))}
              </Section>
            )}
            {!follows.length && <div class="empty"><p>{busy ? "Loading who you follow…" : "No follows found."}</p></div>}
          </>
        )}
      </main>

      <footer>
        <button class={`chip${s.autoOpen ? " on" : ""}`} onClick={() => settings.set({ autoOpen: !s.autoOpen })}>
          <i /> AUTO-OPEN {s.autoOpen ? "ON" : "OFF"}
        </button>
        {s.autoOpen && dismissed.length > 0 && (
          <button class="chip" title={`Streams you closed stay closed until they go offline. Reopen: ${dismissed.join(", ")}`} onClick={() => refresh(true)}>
            REOPEN CLOSED · {dismissed.length}
          </button>
        )}
        <button class="chip" title="Order of live channels" onClick={() => settings.set({ liveSort: s.liveSort === "fewest" ? "viewers" : "fewest" })}>
          {s.liveSort === "fewest" ? "FEWEST FIRST" : "MOST FIRST"}
        </button>
      </footer>
    </>
  );
}

render(<App />, document.getElementById("app")!);
