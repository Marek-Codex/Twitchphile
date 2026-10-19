// What a stream's tags say about it. Twitch expresses both the language and Drops as tags, and streamers tag in
// their own language ("Español", "DropsActivados"), so both English and native forms are recognized.
const LANGUAGE_CODES = ["en", "es", "pt", "de", "fr", "it", "ru", "ja", "ko", "zh", "pl", "tr", "nl", "sv", "no", "da", "fi", "cs", "hu", "el", "ro", "uk", "ar", "th", "vi", "id", "ms", "tl", "hi", "he", "bg", "sk", "ca"];

const languageNames = (() => {
  const map = new Map<string, string>([["american sign language", "ASL"]]);
  const english = new Intl.DisplayNames(["en"], { type: "language" });
  for (const code of LANGUAGE_CODES) {
    try {
      // Both the English name ("Spanish") and the language's own ("español").
      for (const name of [english.of(code), new Intl.DisplayNames([code], { type: "language" }).of(code)])
        if (name) map.set(name.toLowerCase(), code.toUpperCase());
    } catch {}
  }
  return map;
})();

export const languageOf = (t: string[] | undefined) => t?.map((x) => languageNames.get(x.toLowerCase())).find(Boolean) ?? null;

const DROPS_TAG = /^drops[ _-]?(enabled|on|activ|aktiv|attiv|ativ|habilit|włącz|включ|有効)/i;
export const hasDrops = (t: string[] | undefined) => Boolean(t?.some((x) => DROPS_TAG.test(x)));
