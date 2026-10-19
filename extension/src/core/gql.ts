// Background-only: Twitch's public GQL endpoint with a short per-key cache.
import { TWITCH_WEB_CLIENT_ID } from "./constants";

const TTL = 45_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

async function query<T>(q: string, variables: Record<string, unknown>): Promise<T | null> {
  const res = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: { "Client-ID": TWITCH_WEB_CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, variables }),
  });
  return res.ok ? ((await res.json()).data as T) : null;
}

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>;
  const value = load().catch(() => {
    cache.delete(key);
    return null as T;
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}

export const getVideoStart = (id: string) =>
  cached(`video:${id}`, async () => {
    const data = await query<{ video: { recordedAt: string } | null }>("query($id:ID!){video(id:$id){recordedAt}}", { id });
    return data?.video?.recordedAt ?? null;
  });

// Highest-quality MP4 for a clip, signed with its playback token.
export async function getClipDownload(slug: string) {
  const data = await query<{
    clip: {
      broadcaster: { login: string } | null;
      videoQualities: { quality: string; sourceURL: string }[];
      playbackAccessToken: { signature: string; value: string };
    } | null;
  }>(
    'query($s:ID!){clip(slug:$s){broadcaster{login} videoQualities{quality sourceURL} playbackAccessToken(params:{platform:"web",playerType:"site",playerBackend:"mediaplayer"}){signature value}}}',
    { s: slug },
  );
  const clip = data?.clip;
  const best = clip?.videoQualities.slice().sort((a, b) => Number(b.quality) - Number(a.quality))[0];
  if (!clip || !best) return null;
  const { signature, value } = clip.playbackAccessToken;
  return {
    url: `${best.sourceURL}?sig=${signature}&token=${encodeURIComponent(value)}`,
    filename: `${clip.broadcaster?.login ?? "clip"}-${slug}.mp4`,
  };
}

export interface StreamInfo {
  live: boolean;
  startedAt: string | null;
  viewers: number | null;
}

export const getStream = (login: string) =>
  cached(`stream:${login}`, async (): Promise<StreamInfo> => {
    const data = await query<{ user: { stream: { createdAt: string; viewersCount: number } | null } | null }>(
      "query($login:String!){user(login:$login){stream{createdAt viewersCount}}}",
      { login },
    );
    const s = data?.user?.stream;
    return { live: Boolean(s), startedAt: s?.createdAt ?? null, viewers: s?.viewersCount ?? null };
  });
