// WCAG contrast helpers (pure). Used to keep chat username colors readable.
export function luminance([r, g, b]: number[]) {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const BG_DARK = luminance([24, 24, 27]); // Twitch #18181b
const BG_LIGHT = 1;

// Nudges an rgb() color toward white (dark theme) or black (light) until it meets 4.5:1.
export function readable(color: string, dark: boolean): string {
  let rgb = color.match(/\d+/g)?.slice(0, 3).map(Number);
  if (!rgb || rgb.length < 3) return color;
  const bg = dark ? BG_DARK : BG_LIGHT;
  for (let i = 0; i < 20 && contrast(luminance(rgb), bg) < 4.5; i++) {
    rgb = rgb.map((c) => (dark ? c + (255 - c) * 0.15 : c * 0.85));
  }
  return `rgb(${rgb.map(Math.round).join(",")})`;
}
