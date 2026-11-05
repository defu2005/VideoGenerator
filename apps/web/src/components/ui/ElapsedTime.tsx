import { useEffect, useState } from "react";

export function ElapsedTime({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const started = new Date(since).getTime();
  if (Number.isNaN(started)) return null;
  const total = Math.max(0, Math.floor((now - started) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return <span className="elapsed-time">Đã chạy {minutes}:{String(seconds).padStart(2, "0")}</span>;
}
