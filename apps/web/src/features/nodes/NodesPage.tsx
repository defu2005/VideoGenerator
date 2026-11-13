import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildUpdateCommands, REMOTE_RENDER_MODES, TTS_CATALOG, type NodeDetail, type NodeSecretGrant, type RemoteRenderSettings, type VideoNode } from "@vg/shared";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { RelativeTime } from "../../components/ui/RelativeTime";
import { useToast } from "../../components/ui/Toast";
import { usePageVisible } from "../../hooks/usePageVisible";
import { fetchMe } from "../../services/meApi";
import { JoinDialog } from "./JoinDialog";
import { getNodeDetail, listNodes, listSecretGrants, patchNode, revokeNode, saveNodeSettings } from "./nodesApi";

const MODE_LABEL: Record<RemoteRenderSettings["mode"], string> = {
  off: "Tắt (luôn dựng trên máy chính)",
  prefer: "Ưu tiên máy worker",
  only: "Chỉ máy worker",
};
const STAGE_LABEL = { VOICE: "Tạo giọng đọc (TTS)", MEDIA_FETCH: "Tải clip stock" } as const;
const KEYED_TTS = TTS_CATALOG.filter((entry) => entry.kind === "http");
const STATUS: Record<VideoNode["status"], { label: string; tone: BadgeTone }> = {
  online: { label: "Đang chạy", tone: "success" },
  offline: { label: "Mất kết nối", tone: "danger" },
  draining: { label: "Đang rút việc", tone: "warning" },
  revoked: { label: "Đã thu hồi", tone: "neutral" },
  version_mismatch: { label: "Cần cập nhật", tone: "warning" },
};

export function NodesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const visible = usePageVisible();
  const [joinOpen, setJoinOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [updateShown, setUpdateShown] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false });
  const allowed = me.isError || Boolean(me.data?.allowed.includes("nodes.manage"));
  const deciding = !me.data && !me.isError;
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: listNodes, enabled: allowed, refetchInterval: visible ? 15_000 : false });
  const detail = useQuery({
    queryKey: ["nodes", selected],
    queryFn: () => getNodeDetail(selected as string),
    enabled: Boolean(selected) && allowed,
    refetchInterval: visible ? 15_000 : false,
  });
  const secrets = useQuery({ queryKey: ["nodes", "secrets"], queryFn: listSecretGrants, enabled: allowed, refetchInterval: visible ? 15_000 : false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["nodes"] });
  const fail = (reason: unknown) => toast.error(reason instanceof Error ? reason.message : "Không thực hiện được");

  const settings = useMutation({ mutationFn: saveNodeSettings, onSuccess: () => { toast.success("Đã lưu"); void refresh(); }, onError: fail });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => patchNode(id, body), onSuccess: () => void refresh(), onError: fail });
  const revoke = useMutation({ mutationFn: revokeNode, onSuccess: () => { toast.success("Đã thu hồi máy"); setSelected(null); void refresh(); }, onError: fail });

  if (deciding) return <PageHeader title="Máy worker" />;
  if (!allowed) {
    return (
      <>
        <PageHeader title="Máy worker" />
        <p role="alert">Bạn không có quyền quản lý máy worker.</p>
      </>
    );
  }

  const list = Array.isArray(nodes.data?.nodes) ? nodes.data.nodes : [];
  const target = nodes.data?.targetVersion ?? "";
  const mismatched = list.filter((node) => node.status === "version_mismatch");
  const commands = buildUpdateCommands({ image: "vg", version: target || "latest" });
  const cfg = nodes.data?.settings;

  function updateAll() {
    for (const node of mismatched) {
      if (!node.desiredConfig.drain) patch.mutate({ id: node.id, body: { drain: true } });
    }
    setUpdateShown(true);
  }
  function confirmRevoke(node: VideoNode) {
    if (window.confirm(`Thu hồi máy "${node.name}"? Máy sẽ không nhận việc nữa và phải tham gia lại bằng mã mới.`)) revoke.mutate(node.id);
  }

  return (
    <>
      <PageHeader
        title="Máy worker"
        description="Dựng video trên máy khác. Khi tắt, mọi việc vẫn chạy trên máy chính."
        helpHref="/help/may-worker"
        actions={<Button onClick={() => setJoinOpen(true)}>Thêm máy</Button>}
      />
      {nodes.isError && <p role="alert">{nodes.error.message}</p>}
      {cfg?.mode && (
        <Card title="Chế độ">
          <label>
            <span>Dựng video trên máy worker</span>{" "}
            <select
              value={cfg.mode}
              aria-label="Chế độ máy worker"
              onChange={(event) => settings.mutate({ mode: event.target.value as RemoteRenderSettings["mode"] })}
            >
              {REMOTE_RENDER_MODES.map((mode) => <option key={mode} value={mode}>{MODE_LABEL[mode]}</option>)}
            </select>
          </label>
          <p className="muted">
            Phiên bản mục tiêu: {target ? `${target} (theo máy chính)` : "theo máy chính"}. Máy worker phải cùng phiên bản với máy chính vì gói dựng gắn với phiên bản đó.
          </p>
        </Card>
      )}
      {cfg?.stages && (
        <Card title="Các bước khác chạy trên máy worker">
          <p className="muted">Mặc định chỉ dựng video chạy trên máy worker. Bước nào được bật chỉ giao cho máy khai báo đủ khả năng (ví dụ tts:piper, media_fetch). Khoá TTS chỉ được cho mượn trong thời gian ngắn của một việc, rồi bị thu hồi.</p>
          {(Object.keys(STAGE_LABEL) as Array<keyof typeof STAGE_LABEL>).map((stage) => (
            <p key={stage}>
              <label>
                <span>{STAGE_LABEL[stage]}</span>{" "}
                <select
                  value={cfg.stages[stage]}
                  aria-label={`Chế độ ${STAGE_LABEL[stage]}`}
                  onChange={(event) => settings.mutate({ stages: { [stage]: event.target.value as RemoteRenderSettings["mode"] } })}
                >
                  {REMOTE_RENDER_MODES.map((mode) => <option key={mode} value={mode}>{MODE_LABEL[mode]}</option>)}
                </select>
              </label>
            </p>
          ))}
          <h3>Khoá không gửi ra node</h3>
          <ul className="command-list">
            {KEYED_TTS.map((entry) => {
              const key = `tts.${entry.id}.apiKey`;
              const kept = cfg.localOnlyKeys.includes(key);
              return (
                <li key={key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={kept}
                      onChange={() => settings.mutate({ localOnlyKeys: kept ? cfg.localOnlyKeys.filter((name) => name !== key) : [...cfg.localOnlyKeys, key] })}
                    /> Không gửi khoá {entry.label} ra node (bước này sẽ chạy trên máy chính)
                  </label>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Card
        title="Danh sách máy"
        actions={mismatched.length > 0 ? <Button variant="secondary" onClick={updateAll}>{`Cập nhật tất cả (${mismatched.length})`}</Button> : undefined}
      >
        {updateShown && mismatched.length > 0 && (
          <div role="status">
            <p>Đã cho {mismatched.length} máy ngừng nhận việc mới. Chạy lệnh sau trên từng máy:</p>
            <pre className="code-block">{commands.docker}</pre>
            <pre className="code-block">{commands.source}</pre>
          </div>
        )}
        {nodes.data && list.length === 0 && <p>Chưa có máy worker nào. Bấm “Thêm máy” để bắt đầu.</p>}
        <ul className="command-list">
          {list.map((node) => {
            const status = STATUS[node.status];
            return (
              <li key={node.id}>
                <button type="button" className="link-button" onClick={() => setSelected(node.id)}><strong>{node.name}</strong></button>{" "}
                <Badge tone={status.tone}>{status.label}</Badge>
                {node.probe && !node.probe.render.ok && <> <Badge tone="danger">{`Dựng thử lỗi: ${node.probe.render.reason ?? "không rõ"}`}</Badge></>}
                {" "}· {node.runningJobs}/{node.desiredConfig.concurrency} việc
                {node.resources && <> · {node.resources.cpus} CPU · {Math.round(node.resources.ramMb / 1024)} GB RAM · {Math.round(node.resources.freeDiskMb / 1024)} GB trống</>}
                {node.lastSeenAt && <> · thấy <RelativeTime value={node.lastSeenAt} /></>}
                {node.status === "version_mismatch" && <p className="muted">Máy chạy {node.version ?? "?"}, máy chính chạy {target}. Cần cập nhật.</p>}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="Khoá đã cho node mượn">
        <SecretGrantList grants={secrets.data?.grants ?? []} />
      </Card>
      {selected && (
        <NodeDetailPanel
          node={list.find((node) => node.id === selected)}
          detail={detail.data}
          onClose={() => setSelected(null)}
          onPatch={(body) => patch.mutate({ id: selected, body })}
          onRevoke={confirmRevoke}
        />
      )}
      <JoinDialog open={joinOpen} onClose={() => setJoinOpen(false)} version={target || "latest"} knownIds={list.map((node) => node.id)} onJoined={() => void refresh()} />
    </>
  );
}

function NodeDetailPanel({ node, detail, onClose, onPatch, onRevoke }: {
  node: VideoNode | undefined;
  detail: NodeDetail | undefined;
  onClose: () => void;
  onPatch: (body: Record<string, unknown>) => void;
  onRevoke: (node: VideoNode) => void;
}) {
  const [name, setName] = useState<string | null>(null);
  if (!node) return null;
  const revoked = node.status === "revoked";
  return (
    <Card title={`Máy: ${node.name}`} actions={<Button variant="ghost" size="sm" onClick={onClose}>Đóng</Button>}>
      <p>Phiên bản {node.version ?? "?"}</p>
      <p>Khả năng: {node.capabilities.length ? node.capabilities.map((name) => (node.capabilityInfo?.[name] ? `${name} (${node.capabilityInfo[name]})` : name)).join(", ") : "không có khả năng nào"}</p>
      {node.probe && <p>Dựng thử: {node.probe.render.ok ? "đạt" : `lỗi (${node.probe.render.reason ?? "không rõ"})`}</p>}
      {detail && <p>Lỗi 24 giờ qua: {detail.failures24h}</p>}
      {!revoked && (
        <div>
          <label>Tên máy <input value={name ?? node.name} onChange={(event) => setName(event.target.value)} /></label>{" "}
          <Button size="sm" variant="secondary" disabled={name === null || !name.trim()} onClick={() => { onPatch({ name: (name ?? "").trim() }); setName(null); }}>Đổi tên</Button>{" "}
          <label>Số việc cùng lúc{" "}
            <select aria-label="Số việc cùng lúc" value={node.desiredConfig.concurrency} onChange={(event) => onPatch({ concurrency: Number(event.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>{" "}
          {node.capabilities.map((name) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={node.desiredConfig.capabilities.includes(name)}
                onChange={(event) => onPatch({
                  capabilities: event.target.checked
                    ? [...new Set([...node.desiredConfig.capabilities, name])]
                    : node.desiredConfig.capabilities.filter((item) => item !== name),
                })}
              /> {name === "render" ? "Dựng video" : name}{" "}
            </label>
          ))}
          <Button size="sm" variant="secondary" onClick={() => onPatch({ drain: !node.desiredConfig.drain })}>
            {node.desiredConfig.drain ? "Nhận việc lại" : "Rút việc"}
          </Button>{" "}
          <Button size="sm" variant="danger" onClick={() => onRevoke(node)}>Thu hồi</Button>
        </div>
      )}
      <h3>Đang chạy</h3>
      <JobList jobs={detail?.running ?? []} empty="Không có việc đang chạy." />
      <h3>Gần đây</h3>
      <JobList jobs={detail?.recent ?? []} empty="Chưa có việc nào." />
    </Card>
  );
}

function SecretGrantList({ grants }: { grants: NodeSecretGrant[] }) {
  if (grants.length === 0) return <p className="muted">Chưa có khoá nào được cho node mượn.</p>;
  return (
    <ul className="command-list">
      {grants.map((grant) => (
        <li key={grant.id}>
          {grant.summary}{" "}
          {grant.revokedAt ? <Badge tone="neutral">Đã thu hồi</Badge> : <Badge tone="warning">Còn hiệu lực</Badge>}
        </li>
      ))}
    </ul>
  );
}

function JobList({ jobs, empty }: { jobs: NodeDetail["running"]; empty: string }) {
  if (jobs.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className="command-list">
      {jobs.map((job) => (
        <li key={job.jobId}>
          {job.stage} · {job.status}{job.status === "RUNNING" ? ` ${Math.round(job.progress)}%` : ""}
          {job.errorCode ? ` · ${job.errorCode}` : ""}
          {job.durationMs !== null ? ` · ${Math.round(job.durationMs / 1000)}s` : ""}
        </li>
      ))}
    </ul>
  );
}
