// Prime sub reminder. A Prime Gaming sub lasts 30 days and never renews itself, so the free sub quietly lapses
// unless you remember to use it again. We note when (and on whom) you used it, and remind you when it's free again.
export const PRIME_KEY = "primeUsed";
export const PRIME_DAYS = 30;

export interface PrimeUse {
  login: string; // channel it went to ("" if unknown)
  at: number; // when (ms)
}

export const primeReadyAt = (use: PrimeUse) => use.at + PRIME_DAYS * 86_400_000;

// Twitch's subscribe dialog labels the Prime option in several ways ("Subscribe free with Prime", "Use Prime Sub"…).
// A button inside the subscribe flow that mentions Prime counts; the Prime *offers* crown in the top bar doesn't.
export const PRIME_BUTTON = /\b(prime)\b/i;
