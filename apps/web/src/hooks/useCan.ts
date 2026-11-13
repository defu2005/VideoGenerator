import { useEffect, useState } from "react";
import { fetchMe, type MeResponse } from "../services/meApi";

let cached: Promise<MeResponse | null> | null = null;

function loadMe(): Promise<MeResponse | null> {
  cached ??= fetchMe().catch(() => { cached = null; return null; });
  return cached;
}

/** True when the server lists the action for this user. Unknown (loading or no answer) counts as allowed; the server decides anyway. */
export function useCan(action: string): boolean {
  const [allowed, setAllowed] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadMe().then((me) => { if (live && me) setAllowed(me.allowed); });
    return () => { live = false; };
  }, []);
  return allowed ? allowed.includes(action) : true;
}
