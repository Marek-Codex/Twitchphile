// Background-only: Twitch OAuth (implicit flow) + Helix. Token lives in local (unsynced) storage.
// With the desktop app paired, a sign-in on either side works for both (see core/desktop.ts).
import { platform } from "@platform";
import { borrowSession, forgetBorrowed } from "./desktop";

export const CLIENT_ID = "svnythf3k59s8103amfg4m2p9381re"; // "Phile by MarekCodex" Twitch app
const SCOPES = ["user:read:follows"];
const KEY = "twitchAuth";

export interface Auth {
  token: string;
  userId: string;
  login: string;
  expiresAt: number;
}

export async function connect(): Promise<Auth> {
  const state = crypto.randomUUID();
  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "token",
    client_id: CLIENT_ID,
    redirect_uri: platform.auth.redirectUrl("twitch-oauth"),
    scope: SCOPES.join(" "),
    state,
  }).toString();

  const back = new URL(await platform.auth.launch(url.toString()));
  const params = new URLSearchParams(back.hash.slice(1));
  const err = params.get("error") ?? back.searchParams.get("error");
  if (err) throw new Error(params.get("error_description") ?? back.searchParams.get("error_description") ?? err);
  if (params.get("state") !== state) throw new Error("Authorization state mismatch — please try again.");
  const token = params.get("access_token");
  if (!token) throw new Error("Twitch returned no access token.");

  const v = await fetch("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${token}` } });
  if (!v.ok) throw new Error("Twitch could not validate the token.");
  const info = await v.json();
  if (info.client_id !== CLIENT_ID) throw new Error("Token belongs to a different app.");

  const auth: Auth = { token, userId: info.user_id, login: info.login, expiresAt: Date.now() + info.expires_in * 1000 };
  await platform.local.set(KEY, auth);
  return auth;
}

// This extension's own sign-in, if it has a live one.
export async function ownAuth(): Promise<Auth | null> {
  const auth = await platform.local.get<Auth>(KEY);
  return auth && auth.expiresAt > Date.now() ? auth : null;
}

// Our own sign-in, or else the paired desktop app's.
export async function getAuth(): Promise<(Auth & { borrowed?: boolean }) | null> {
  const own = await ownAuth();
  if (own) return own;
  const lent = await borrowSession();
  return lent ? { ...lent, borrowed: true } : null;
}

export const disconnect = () => platform.local.remove(KEY);

export async function helix<T>(path: string): Promise<T | null> {
  const auth = await getAuth();
  if (!auth) return null;
  const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
    headers: { "Client-ID": CLIENT_ID, Authorization: `Bearer ${auth.token}` },
  });
  if (res.status === 401) {
    // Revoked or expired: drop it so the next call re-borrows or shows signed out.
    if (auth.borrowed) forgetBorrowed();
    else await disconnect();
    return null;
  }
  return res.ok ? res.json() : null;
}
