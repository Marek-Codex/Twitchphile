// The only surface core/features/ui may use to touch browser APIs. Listener registrations return an unsubscribe.
type Unsubscribe = () => void;

export interface Platform {
  // False once the extension was reloaded/removed under an already-running content script.
  alive(): boolean;
  version: string;
  url(path: string): string;

  // Synced settings.
  storage: {
    get<T extends object>(defaults: T): Promise<T>;
    set(values: Record<string, unknown>): Promise<void>;
    remove(keys: string[]): Promise<void>;
    onChange(cb: (changes: Record<string, unknown>) => void): Unsubscribe;
  };
  // Device-local, unsynced (token, counters, caches).
  local: {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
    onChange(key: string, cb: (value: unknown) => void): Unsubscribe;
  };

  send<R = unknown>(message: { type: string; [k: string]: unknown }): Promise<R>;
  onMessage(cb: (message: { type: string; [k: string]: unknown }, tabId?: number) => Promise<unknown> | unknown): void;

  // ---- Background-only
  auth: {
    redirectUrl(path: string): string;
    launch(url: string): Promise<string>;
  };
  tabs: {
    open(url: string, opts?: { active?: boolean }): Promise<number | undefined>;
    close(id: number): Promise<void>;
    exists(id: number): Promise<boolean>;
    isActive(id: number): Promise<boolean>;
    anyMatching(urlPattern: string | string[]): Promise<boolean>;
    /** `windowClosing`: the whole window (or browser) is closing, not the user closing this one tab. */
    onRemoved(cb: (id: number, windowClosing: boolean) => void): void;
    navigate(id: number, url: string): Promise<void>;
    onUrlChanged(cb: (id: number, url: string) => void): void;
  };
  download(url: string, filename: string): Promise<void>;
  badge(text: string): void;
  notify(id: string, title: string, message: string): void;
  onNotificationClick(cb: (id: string) => void): void;
  alarm(name: string, cb: () => void): void;
  /** True while the computer is locked (nobody to notify, so background polling can rest). */
  isLocked(): Promise<boolean>;
  /** A one-off alarm at `when` (ms); null clears it. Fires through alarm(name, cb). */
  scheduleAt(name: string, when: number | null): Promise<void>;
  schedule(name: string, periodMinutes: number): Promise<void>;
  onInstalled(cb: () => void): void;
}
