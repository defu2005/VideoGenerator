import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "../../services/apiClient";

type ToolProposal = {
  id: string;
  kind: "internal" | "external_mcp";
  name: string;
  operation: string;
  reproduction: string;
  impact: string;
  inputSchema: object;
  outputSchema: object;
  permissions: string[];
  dataSent: string;
  requiresConfirmation: boolean;
  acceptance: string[];
  sourceUrl?: string;
};

const queryKey = ["operator", "tool-proposals"];
const path = "/operator/tool-proposals";

export function ToolProposals() {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const proposals = useQuery({
    queryKey,
    enabled: open,
    queryFn: () => apiRequest<{ items: ToolProposal[] }>(path),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => apiRequest(`${path}/${id}/dismiss`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  return (
    <section className="panel">
      <h2>Đề xuất công cụ</h2>
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>Xem đề xuất chờ xử lý</summary>
        {open && proposals.isPending ? <p>Đang tải đề xuất…</p> : null}
        {proposals.error || dismiss.error ? <p role="alert">{(proposals.error ?? dismiss.error)?.message}</p> : null}
        {proposals.data?.items.length === 0 ? <p>Chưa có đề xuất.</p> : null}
        {proposals.data?.items.map((item) => (
          <details key={item.id}>
            <summary>{item.name} · {item.kind === "internal" ? "Tool nội bộ" : "MCP bên ngoài"}</summary>
            <p>{item.operation}</p>
            <dl>
              <dt>Ca tái hiện</dt><dd>{item.reproduction}</dd>
              <dt>Tác động</dt><dd>{item.impact}</dd>
              <dt>Quyền</dt><dd>{item.permissions.join(", ")}</dd>
              <dt>Dữ liệu gửi đi</dt><dd>{item.dataSent}</dd>
              <dt>Xác nhận</dt><dd>{item.requiresConfirmation ? "Cần xác nhận" : "Đề xuất không yêu cầu"}</dd>
              {item.sourceUrl ? <><dt>Nguồn</dt><dd>{item.sourceUrl}</dd></> : null}
              <dt>Schema vào</dt><dd><pre>{JSON.stringify(item.inputSchema, null, 2)}</pre></dd>
              <dt>Schema ra</dt><dd><pre>{JSON.stringify(item.outputSchema, null, 2)}</pre></dd>
              <dt>Tiêu chí kiểm thử</dt><dd><ul>{item.acceptance.map((test, index) => <li key={index}>{test}</li>)}</ul></dd>
            </dl>
            <button type="button" className="button button-secondary" disabled={dismiss.isPending}
              onClick={() => dismiss.mutate(item.id)}>Bỏ qua đề xuất</button>
          </details>
        ))}
      </details>
    </section>
  );
}
