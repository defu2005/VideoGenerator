import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AgentAssignmentInputSchema, PROTECTED_PROJECT_ID, type AgentAssignment } from "@vg/shared";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { apiRequest } from "../../services/apiClient";
import { getProfiles } from "../../services/profilesApi";
import { getProjects } from "../../services/projectsApi";

const assignmentKey = ["settings", "agent-assignments"];
const empty = AgentAssignmentInputSchema.parse({ instance: "*", role: "visual_scout", stage: "VISUAL_SEARCH" });
type Draft = typeof empty;

export function AgentAssignmentsPanel({ instances }: { instances: string[] }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState<Draft>(empty);
  const [search, setSearch] = useState("");
  const [validation, setValidation] = useState("");
  const [requiredScope, setRequiredScope] = useState<"profile" | "project">();
  const assignments = useQuery({ queryKey: assignmentKey, queryFn: () => apiRequest<{ assignments: AgentAssignment[] }>("/settings/agent-assignments") });
  const profiles = useQuery({ queryKey: ["profiles", "list"], queryFn: () => getProfiles() });
  const projects = useQuery({
    queryKey: ["projects", "agent-assignment", draft.profileId, search],
    queryFn: () => getProjects({ profileId: draft.profileId ?? undefined, q: search || undefined, includeArchived: false,
      archivedOnly: false, sort: "updatedAt", order: "desc", page: 1, pageSize: 30 }),
  });
  const profileItems = profiles.data?.items ?? [];
  const projectItems = (projects.data?.items ?? []).filter((project) => project.id !== PROTECTED_PROJECT_ID);
  const save = useMutation({
    mutationFn: (value: Draft) => apiRequest(editing ? `/settings/agent-assignments/${editing}` : "/settings/agent-assignments", {
      method: editing ? "PUT" : "POST", body: JSON.stringify(value),
    }),
    onSuccess: async () => {
      setEditing(undefined);
      setRequiredScope(undefined);
      setDraft(empty);
      setSearch("");
      await Promise.all([client.invalidateQueries({ queryKey: assignmentKey }), client.invalidateQueries({ queryKey: ["operator", "fleet"] })]);
    },
  });

  function open(value: Draft, id?: string, scope?: "profile" | "project") {
    save.reset();
    setValidation("");
    setSearch("");
    setDraft(value);
    setEditing(id);
    setRequiredScope(scope);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if ((requiredScope === "profile" && !draft.profileId) || (requiredScope === "project" && !draft.projectId)) {
      setValidation(requiredScope === "profile" ? "Chọn hồ sơ cần quản lý." : "Chọn video cần tìm ảnh.");
      return;
    }
    const result = AgentAssignmentInputSchema.safeParse(draft);
    if (!result.success) {
      setValidation("Kiểm tra tên instance, vai trò và số việc tối đa.");
      return;
    }
    setValidation("");
    save.mutate(result.data);
  }

  return <Card title="Phân công agent">
    {assignments.isError ? <p role="alert">{assignments.error.message}</p> : null}
    {assignments.isPending ? <p role="status">Đang tải phân công</p> : null}
    <ul className="plain-list agent-assignment-list">{assignments.data?.assignments?.map(({ id, createdBy: _createdBy, ...value }) => <li key={id}>
      <strong>{value.instance === "*" ? "Nhóm trong workspace" : value.instance} · {value.role}</strong>
      <p>{value.projectId ? projectItems.find((p) => p.id === value.projectId)?.title ?? value.projectId
        : value.profileId ? profileItems.find((p) => p.id === value.profileId)?.name ?? value.profileId : "Mọi video"}
        {value.stage ? ` · ${value.stage}` : ""} · tối đa {value.maxConcurrent} việc · {value.active ? "Đang bật" : "Đã tắt"}</p>
      <Button variant="secondary" onClick={() => open(value, id)}>Sửa phân công</Button>
    </li>)}</ul>
    <div className="form-stack">
      <div className="agent-assignment-actions">
        <Button variant="secondary" onClick={() => open({ ...empty, instance: "", role: "channel_manager", stage: null }, undefined, "profile")}>Quản lý một kênh</Button>
        <Button variant="secondary" onClick={() => open({ ...empty, maxConcurrent: 2 })}>Nhóm tìm ảnh</Button>
        <Button variant="secondary" onClick={() => open({ ...empty, instance: "" }, undefined, "project")}>Tìm ảnh một video</Button>
      </div>
      <form className="form-stack" onSubmit={submit}>
        <Field label="Instance" hint="Dùng tên đã gắn với khóa máy, ví dụ hermes/Hermes-2. Dùng * cho nhóm trong workspace.">{(field) => <input {...field} required list="agent-assignment-instances" value={draft.instance} onChange={(event) => setDraft({ ...draft, instance: event.target.value })} />}</Field>
        <datalist id="agent-assignment-instances">{instances.map((instance) => <option key={instance} value={instance} />)}</datalist>
        <Field label="Vai trò" hint="Vai trò dùng để nhận việc và ưu tiên skill. Quyền thao tác vẫn theo khóa máy.">{(field) => <input {...field} required maxLength={80} list="agent-assignment-roles" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} />}</Field>
        <datalist id="agent-assignment-roles"><option value="visual_scout" /><option value="channel_manager" /></datalist>
        <Field label="Hồ sơ áp dụng">{(field) => <select {...field} value={draft.profileId ?? ""} onChange={(event) => setDraft({ ...draft, profileId: event.target.value || null, projectId: null })}>
          <option value="">Mọi hồ sơ</option>
          {draft.profileId && !profileItems.some((profile) => profile.id === draft.profileId) ? <option value={draft.profileId}>{draft.profileId}</option> : null}
          {profileItems.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>}</Field>
        <Field label="Tìm video">{(field) => <input {...field} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />}</Field>
        <Field label="Video áp dụng">{(field) => <select {...field} value={draft.projectId ?? ""} onChange={(event) => setDraft({ ...draft, projectId: event.target.value || null })}>
          <option value="">Mọi video trong phạm vi</option>
          {draft.projectId && !projectItems.some((project) => project.id === draft.projectId) ? <option value={draft.projectId}>{draft.projectId}</option> : null}
          {projectItems.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select>}</Field>
        {profiles.isError || projects.isError ? <p role="alert">Không tải được danh sách hồ sơ hoặc video.</p> : null}
        <Field label="Bước áp dụng">{(field) => <select {...field} value={draft.stage ?? ""} onChange={(event) => setDraft({ ...draft, stage: event.target.value === "VISUAL_SEARCH" ? "VISUAL_SEARCH" : null })}>
          <option value="">Mọi bước được hỗ trợ</option><option value="VISUAL_SEARCH">Tìm ảnh</option>
        </select>}</Field>
        <Field label="Số việc tối đa mỗi instance">{(field) => <input {...field} type="number" min={1} max={100} value={draft.maxConcurrent} onChange={(event) => setDraft({ ...draft, maxConcurrent: Number(event.target.value) })} />}</Field>
        <label className="checkbox-field"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Bật phân công</label>
        {validation || save.error ? <p role="alert">{validation || save.error?.message}</p> : null}
        {save.isSuccess ? <p role="status">Đã lưu phân công.</p> : null}
        <div className="agent-assignment-actions">
          <Button type="submit" loading={save.isPending}>{editing ? "Lưu thay đổi phân công" : "Thêm phân công"}</Button>
          {editing ? <Button variant="secondary" onClick={() => open(empty)}>Hủy chỉnh sửa</Button> : null}
        </div>
      </form>
    </div>
  </Card>;
}
