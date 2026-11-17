
import type { Entry } from "@/lib/types";
import { useNow } from "@/lib/app-context";
import { duration, elapsed } from "@/lib/time";
export function LiveDuration({ entry }: { entry: Entry }) {
  const now = useNow(1000, entry.end === null);
  return <>{duration(elapsed(entry, now), entry.end === null)}</>;
}
