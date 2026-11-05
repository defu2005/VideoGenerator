import { useEffect, useState } from "react";

function readVisible(): boolean {
  return typeof document === "undefined" || !document.hidden;
}

/** True while the browser tab is in the foreground. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(readVisible);
  useEffect(() => {
    const update = () => setVisible(readVisible());
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export function documentHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}
