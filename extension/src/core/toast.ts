// Small confirmation chip near the cursor (e.g. "Copied"). One element, reused.
let el: HTMLDivElement | null = null;
let timer = 0;

export function toast(text: string, x: number, y: number) {
  if (!el) {
    el = document.createElement("div");
    Object.assign(el.style, {
      position: "fixed", zIndex: "10001", pointerEvents: "none", padding: "4px 8px", borderRadius: "4px",
      background: "var(--color-background-tooltip, #0A0D12)", color: "var(--color-text-tooltip, #F2F7FF)",
      borderLeft: "2px solid #3CA0FF", font: "600 12px var(--font-base, sans-serif)",
      boxShadow: "0 2px 8px rgba(0,0,0,.4)", transition: "opacity .15s ease, transform .15s ease",
    });
    document.body.append(el);
  }
  el.textContent = text;
  el.style.left = `${x + 12}px`;
  el.style.top = `${y - 28}px`;
  el.style.opacity = "1";
  el.style.transform = "translateY(0)";
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    el!.style.opacity = "0";
    el!.style.transform = "translateY(-4px)";
  }, 900);
}
