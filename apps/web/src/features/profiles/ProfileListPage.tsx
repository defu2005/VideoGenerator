import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { ProfileListItem } from "@vg/shared";
import { ApiRequestError } from "../../services/apiClient";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { useCreateProfile, useProfiles } from "../../hooks/useProfiles";

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  facebook_reels: "FB Reels",
  instagram_reels: "IG Reels",
};

function ProfileCard({ profile }: { profile: ProfileListItem }) {
  return (
    <Link className="profile-card" to={`/profiles/${profile.id}/direction`}>
      <span className="profile-color-dot" style={{ background: profile.color }} aria-hidden="true" />
      <div className="profile-card-body">
        <h2>{profile.name}</h2>
        {profile.description && <p className="profile-card-desc">{profile.description}</p>}
        <div className="profile-card-meta">
          <span>{profile.projectCount} dự án</span>
          <span>{profile.accountCount} tài khoản</span>
        </div>
        {profile.accounts && profile.accounts.length > 0 && (
          <div className="profile-platform-tags">
            {profile.accounts.map((account) => (
              <span key={account.id} className="profile-platform-tag">
                {PLATFORM_LABELS[account.platform] ?? account.platform}
                {account.format === "vertical" ? " · 9:16" : " · 16:9"}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

export function ProfileListPage() {
  const profiles = useProfiles({ includeArchived: false });
  const create = useCreateProfile();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const profile = await create.mutateAsync({ name: name.trim() });
      setCreateOpen(false);
      setName("");
      window.location.assign(`/profiles/${profile.id}/direction`);
    } catch (err) {
      setError(err instanceof ApiRequestError || err instanceof Error ? err.message : "Không tạo được hồ sơ");
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>Hồ sơ</h1>
          <p className="page-subtitle">Mỗi hồ sơ mang định hướng kênh, brief mặc định và tài khoản nền tảng riêng.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}>＋ Hồ sơ mới</button>
      </div>

      <section className="panel list-panel">
        {profiles.isPending ? (
          <Spinner label="Đang tải hồ sơ" />
        ) : profiles.isError ? (
          <ErrorState
            message={profiles.error instanceof Error ? profiles.error.message : "Lỗi tải hồ sơ"}
            onRetry={() => void profiles.refetch()}
          />
        ) : profiles.data.items.length === 0 ? (
          <EmptyState
            title="Chưa có hồ sơ"
            description="Tạo hồ sơ để gắn định hướng kênh và tài khoản nền tảng cho dự án mới."
            onCreate={() => setCreateOpen(true)}
            createLabel="Tạo hồ sơ"
          />
        ) : (
          <div className="profile-grid" aria-label="Hồ sơ">
            {profiles.data.items.map((profile) => (
              <ProfileCard key={profile.id} profile={profile} />
            ))}
          </div>
        )}
      </section>

      {createOpen && (
        <dialog
          ref={(node) => { if (node && !node.open) node.showModal(); }}
          className="dialog form-dialog"
          aria-labelledby="create-profile-title"
          onCancel={() => setCreateOpen(false)}
        >
          <form onSubmit={submit}>
            <div className="dialog-heading">
              <div><p className="eyebrow">HỒ SƠ</p><h2 id="create-profile-title">Tạo hồ sơ</h2></div>
              <button className="icon-button" type="button" aria-label="Đóng" onClick={() => setCreateOpen(false)}>×</button>
            </div>
            <div className="dialog-form-body">
              {error && <p className="request-error" role="alert">{error}</p>}
              <label className="form-field">
                <span>Tên hồ sơ</span>
                <input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} required />
              </label>
            </div>
            <div className="dialog-actions">
              <button className="button button-secondary" type="button" onClick={() => setCreateOpen(false)}>Hủy</button>
              <button className="button button-primary" type="submit" disabled={create.isPending || !name.trim()}>
                {create.isPending ? "Đang tạo…" : "Tạo"}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
