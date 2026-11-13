import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildJoinCommands, isLoopbackControlUrl } from "@vg/shared";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { createJoinToken, listNodes, type JoinToken } from "./nodesApi";

const WAIT_MS = 2 * 60_000;
const POLL_MS = 3_000;

/** The join token lives only in this component's state: never logged, never stored, gone when the dialog closes. */
export function JoinDialog({ open, onClose, version, knownIds, onJoined }: {
  open: boolean;
  onClose: () => void;
  version: string;
  knownIds: string[];
  onJoined: () => void;
}) {
  const toast = useToast();
  const [token, setToken] = useState<JoinToken | null>(null);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [joinedName, setJoinedName] = useState<string | null>(null);
  const known = useRef(new Set<string>());
  const controlUrl = typeof window === "undefined" ? "" : window.location.origin;

  useEffect(() => {
    if (!open) { setToken(null); setStartedAt(null); setJoinedName(null); }
  }, [open]);
  useEffect(() => {
    if (!token) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [token]);

  const waiting = Boolean(token) && startedAt !== null && !joinedName && now - startedAt < WAIT_MS;
  const watch = useQuery({
    queryKey: ["nodes-join-watch"],
    queryFn: listNodes,
    enabled: open && waiting,
    refetchInterval: POLL_MS,
    gcTime: 0,
  });
  useEffect(() => {
    const fresh = watch.data?.nodes.find((node) => !known.current.has(node.id));
    if (fresh) { setJoinedName(fresh.name); onJoined(); }
  }, [watch.data, onJoined]);

  const commands = useMemo(
    () => (token ? buildJoinCommands({ controlUrl, token: token.token, image: "vg", version }) : null),
    [token, controlUrl, version],
  );
  const secondsLeft = token ? Math.max(0, Math.floor((new Date(token.expiresAt).getTime() - now) / 1000)) : 0;

  async function create() {
    setCreating(true);
    try {
      known.current = new Set(knownIds);
      const value = await createJoinToken();
      setToken(value);
      setNow(Date.now());
      setStartedAt(Date.now());
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Không tạo được mã");
    } finally {
      setCreating(false);
    }
  }

  const copy = (text: string) => { void navigator.clipboard?.writeText(text).then(() => toast.success("Đã sao chép")); };

  return (
    <Modal open={open} title="Thêm máy worker" onClose={onClose}>
      <p>Máy mới sẽ dựng video thay cho máy chính. Cần Docker (hoặc Node và ffmpeg) trên máy đó.</p>
      {isLoopbackControlUrl(controlUrl) && (
        <p role="alert" className="form-error">
          Bạn đang mở app bằng địa chỉ localhost ({controlUrl}). Máy khác sẽ không kết nối được: hãy mở app bằng địa chỉ LAN, Tailscale hoặc tên miền rồi tạo mã lại.
        </p>
      )}
      {!token && <Button loading={creating} onClick={() => void create()}>Tạo mã tham gia</Button>}
      {token && commands && (
        <div>
          <p role="status">
            {secondsLeft > 0
              ? `Mã hết hạn sau ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}. Chỉ hiện một lần, đóng hộp này là mất.`
              : "Mã đã hết hạn. Đóng và tạo mã mới."}
          </p>
          <h3>Docker</h3>
          <pre className="code-block">{commands.docker}</pre>
          <Button variant="secondary" size="sm" onClick={() => copy(commands.docker)}>Sao chép lệnh Docker</Button>
          <h3>Chạy từ mã nguồn</h3>
          <pre className="code-block">{commands.source}</pre>
          <Button variant="secondary" size="sm" onClick={() => copy(commands.source)}>Sao chép lệnh nguồn</Button>
          <p role="status" aria-live="polite">
            {joinedName
              ? `Máy "${joinedName}" đã tham gia.`
              : waiting ? "Đang chờ máy tham gia (tối đa 2 phút)…" : "Chưa thấy máy nào tham gia. Kiểm tra lệnh và địa chỉ, rồi thử lại."}
          </p>
        </div>
      )}
      <div><Button variant="ghost" onClick={onClose}>Đóng</Button></div>
    </Modal>
  );
}
