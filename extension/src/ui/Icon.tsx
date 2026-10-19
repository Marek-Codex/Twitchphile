// Phosphor icon as a Preact component.
import { svg } from "./icons";

// `icon` is one of the exports from icons.ts, e.g. <Icon icon={star} />.
export const Icon = ({ icon, size = 16 }: { icon: string; size?: number }) => (
  <span class="ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg(icon, size) }} />
);
