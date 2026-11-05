import { useEffect, useState } from "react";

export const MOBILE_QUERY = "(max-width: 767px)";

function readMatch(query: string): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") return window.matchMedia(query).matches;
  if (query.includes("max-width")) return window.innerWidth <= 767;
  return false;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => readMatch(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setMatches(readMatch(query));
      return undefined;
    }
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}
