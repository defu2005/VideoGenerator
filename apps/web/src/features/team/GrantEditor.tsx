import { effectiveRole, ROLE_LABEL, type Grant, type GrantRole, type TeamChannel, type TeamRole } from "../../services/teamApi";

const GRANT_ROLES: GrantRole[] = ["editor", "reviewer", "publisher", "viewer"];

/**
 * Channel grants for one person. No grant row = no access to the channel. A grant may lower the workspace
 * role for that channel but never raise it; the line under each row shows the role that will really apply.
 */
export function GrantEditor({
  channels,
  workspaceRole,
  value,
  onChange,
}: {
  channels: TeamChannel[];
  workspaceRole: TeamRole;
  value: Grant[];
  onChange: (next: Grant[]) => void;
}) {
  if (workspaceRole === "owner" || workspaceRole === "admin") {
    return <p className="muted">Chủ sở hữu và quản trị viên luôn thấy mọi kênh.</p>;
  }
  if (channels.length === 0) return <p className="muted">Chưa có kênh nào để giao.</p>;
  const byId = new Map(value.map((grant) => [grant.profileId, grant]));
  const toggle = (id: string, on: boolean) => onChange(on ? [...value, { profileId: id }] : value.filter((grant) => grant.profileId !== id));
  const setRole = (id: string, role: string) =>
    onChange(value.map((grant) => (grant.profileId === id ? { profileId: id, ...(role ? { role: role as GrantRole } : {}) } : grant)));
  return (
    <div className="grant-editor" role="group" aria-label="Kênh được giao">
      {channels.map((channel) => {
        const grant = byId.get(channel.id);
        const effective = grant ? effectiveRole(workspaceRole, grant.role) : null;
        return (
          <div key={channel.id} className="grant-row">
            <label>
              <input type="checkbox" checked={Boolean(grant)} onChange={(event) => toggle(channel.id, event.target.checked)} />
              {" "}{channel.name}
            </label>
            {grant ? (
              <select
                aria-label={`Vai trò ở kênh ${channel.name}`}
                value={grant.role ?? ""}
                onChange={(event) => setRole(channel.id, event.target.value)}
              >
                <option value="">Theo vai trò chung</option>
                {GRANT_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
              </select>
            ) : null}
            <span className="muted grant-effective">
              {effective ? `Vai trò áp dụng: ${ROLE_LABEL[effective]}` : "Không truy cập"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
