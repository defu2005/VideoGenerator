import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { AccountListRow } from "@vg/shared";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { useToast } from "../../components/ui/Toast";
import { getAllAccounts, moveAccount } from "../../services/connectionsApi";
import { deletePlatformAccount, getProfiles } from "../../services/profilesApi";
import { checkAccountConnection } from "../../services/publishApi";
import { AddAccountWizard } from "./AddAccountWizard";
import { CONNECTION_LABEL, PLATFORM_LABEL } from "./platforms";

const CONNECTION_TONE: Record<string, BadgeTone> = {
  CONNECTED: "success",
  NOT_CONNECTED: "neutral",
  EXPIRED: "warning",
  ERROR: "danger",
};

export function needsAttention(account: AccountListRow): boolean {
  return account.enabled && account.connection !== "CONNECTED";
}

export function filterAccounts(
  accounts: AccountListRow[],
  filter: { platform: string; profileId: string; status: string },
): AccountListRow[] {
  return accounts.filter((account) =>
    (!filter.platform || account.platform === filter.platform)
    && (!filter.profileId || account.profileId === filter.profileId)
    && (!filter.status
      || (filter.status === "attention" ? needsAttention(account) : account.connection === filter.status)));
}

export function summarizeAccountChecks(working: number, failed: number, unconnected: number) {
  const checked = working + failed;
  const message = checked
    ? `Đã kiểm tra ${checked} tài khoản: ${working} hoạt động, ${failed} cần kết nối lại.${unconnected ? ` ${unconnected} tài khoản chưa kết nối.` : ""}`
    : `Chưa có tài khoản nào đã kết nối để kiểm tra.${unconnected ? ` ${unconnected} tài khoản chưa kết nối — bấm Kết nối ở từng dòng.` : ""}`;
  return { message, success: checked > 0 && failed === 0 && unconnected === 0 };
}

export function AccountsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const accounts = useQuery({ queryKey: ["accounts", "all"], queryFn: getAllAccounts });
  const profiles = useQuery({ queryKey: ["profiles", "list"], queryFn: () => getProfiles() });
  const [platform, setPlatform] = useState("");
  const [profileId, setProfileId] = useState("");
  const [status, setStatus] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState<string>();
  const [deleting, setDeleting] = useState<AccountListRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [moving, setMoving] = useState<AccountListRow | null>(null);
  const [moveTarget, setMoveTarget] = useState("");

  const rows = useMemo(
    () => filterAccounts(accounts.data?.accounts ?? [], { platform, profileId, status }),
    [accounts.data, platform, profileId, status],
  );

  if (accounts.isPending) return <Spinner label="Đang tải tài khoản" />;
  if (accounts.isError) return <ErrorState message={accounts.error.message} onRetry={() => void accounts.refetch()} />;

  const all = accounts.data.accounts;
  const editAppAccount = all.find(({ id }) => id === searchParams.get("editApp"));
  const attention = all.filter(needsAttention);
  const checkable = all.filter((item) => item.connection !== "NOT_CONNECTED");
  const unconnected = all.length - checkable.length;
  const attentionUnconnected = attention.filter((item) => item.connection === "NOT_CONNECTED").length;
  const profileOptions = (profiles.data?.items ?? []).map((profile) => ({ value: profile.id, label: profile.name }));

  async function checkAll() {
    setChecking(true);
    let failed = 0;
    for (const account of checkable) {
      try {
        const detail = await checkAccountConnection(account.profileId, account.id);
        if (detail.connection !== "CONNECTED") failed += 1;
      } catch {
        failed += 1;
      }
    }
    setChecking(false);
    await queryClient.invalidateQueries({ queryKey: ["accounts"] });
    const result = summarizeAccountChecks(checkable.length - failed, failed, unconnected);
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deletePlatformAccount(deleting.profileId, deleting.id);
      setDeleting(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["profiles"] }),
      ]);
      toast.success("Đã xoá tài khoản.");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Không xoá được tài khoản."); }
    finally { setDeleteBusy(false); }
  }

  async function confirmMove() {
    if (!moving || !moveTarget) return;
    try {
      await moveAccount(moving.id, moveTarget);
      toast.success(`Đã chuyển ${moving.displayName}.`);
      setMoving(null);
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Không chuyển được");
    }
  }

  return (
    <div className="settings-page">
      <PageHeader
        eyebrow="NỘI DUNG"
        title="Tài khoản nền tảng"
        description="Mọi kênh YouTube, TikTok, Facebook và Instagram của mọi hồ sơ ở một chỗ."
        actions={(
          <>
            <Button variant="secondary" loading={checking} disabled={checkable.length === 0} onClick={() => void checkAll()}>Kiểm tra tất cả</Button>
            <Button onClick={() => setWizardOpen(true)}>Thêm tài khoản</Button>
          </>
        )}
      />
      {checkable.length === 0 ? <p>{summarizeAccountChecks(0, 0, unconnected).message}</p> : null}

      {attention.length > 0 ? (
        <div className="panel" role="alert">
          <strong>{attentionUnconnected} tài khoản chưa kết nối · {attention.length - attentionUnconnected} tài khoản cần kết nối lại.</strong>{" "}
          Tài khoản hết hạn hoặc lỗi sẽ không đăng được video.{" "}
          <button type="button" className="link-button" onClick={() => setStatus("attention")}>Chỉ xem các tài khoản này</button>
        </div>
      ) : null}

      <Card>
        <div className="accounts-filters">
          <Select
            label="Nền tảng"
            value={platform}
            onChange={setPlatform}
            options={[{ value: "", label: "Tất cả" }, ...Object.entries(PLATFORM_LABEL).map(([value, label]) => ({ value, label }))]}
          />
          <Select label="Hồ sơ" value={profileId} onChange={setProfileId} options={[{ value: "", label: "Tất cả" }, ...profileOptions]} />
          <Select
            label="Trạng thái"
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: "Tất cả" },
              { value: "attention", label: "Cần xử lý" },
              ...Object.entries(CONNECTION_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>

        {all.length === 0 ? (
          <p>Chưa có tài khoản nào. Bấm Thêm tài khoản để kết nối kênh đầu tiên.</p>
        ) : rows.length === 0 ? (
          <p>Không có tài khoản khớp bộ lọc.</p>
        ) : (
          <div className="accounts-table-wrap">
            <table className="accounts-table">
              <thead>
                <tr>
                  <th>Tài khoản</th>
                  <th>Nền tảng</th>
                  <th>Hồ sơ</th>
                  <th>Trạng thái</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((account) => (
                  <tr key={account.id} data-testid="account-row">
                    <td>
                      {account.displayName}
                      {account.handle ? <small> · {account.handle}</small> : null}
                      {!account.enabled ? <small> · đang tắt</small> : null}
                    </td>
                    <td>{PLATFORM_LABEL[account.platform] ?? account.platform}</td>
                    <td><Link to={`/profiles/${account.profileId}/accounts`}>{account.profileName}</Link></td>
                    <td>
                      <Badge tone={CONNECTION_TONE[account.connection] ?? "neutral"}>
                        {CONNECTION_LABEL[account.connection] ?? account.connection}
                      </Badge>
                      {account.connectionError ? <small className="ui-field-error"> {account.connectionError}</small> : null}
                      {account.platform === "youtube" && account.connection === "EXPIRED" ? <small> Testing có thể làm quyền hết hạn sau 7 ngày. Kiểm tra trạng thái Publish app trên Google Cloud.</small> : null}
                    </td>
                    <td>
                      {account.connection !== "CONNECTED" ? (
                        <Button size="sm" variant="secondary" onClick={() => { setReconnecting(account.id); setWizardOpen(true); }}>
                          {account.connection === "NOT_CONNECTED" ? "Kết nối" : "Kết nối lại"}
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(account)}>Xoá</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setMoving(account); setMoveTarget(""); }}>
                        Chuyển hồ sơ
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {moving ? (
        <Card title={`Chuyển ${moving.displayName} sang hồ sơ khác`}>
          <Select
            label="Hồ sơ đích"
            value={moveTarget}
            onChange={setMoveTarget}
            options={[
              { value: "", label: "Chọn hồ sơ" },
              ...profileOptions.filter((option) => option.value !== moving.profileId),
            ]}
          />
          <p className="ui-field-hint">Lịch đăng đã tạo vẫn giữ nguyên tài khoản này.</p>
          <div className="key-row-actions">
            <Button disabled={!moveTarget} onClick={() => void confirmMove()}>Chuyển</Button>
            <Button variant="ghost" onClick={() => setMoving(null)}>Huỷ</Button>
          </div>
        </Card>
      ) : null}

      <ConfirmDialog open={deleting !== null} title={`Xoá ${deleting?.displayName ?? "tài khoản"}?`}
        message="Các bài đăng đã lên lịch cho tài khoản này sẽ dừng." confirmLabel="Xoá" cancelLabel="Huỷ"
        busy={deleteBusy} onCancel={() => setDeleting(null)} onConfirm={() => void confirmDelete()} />
      <AddAccountWizard open={wizardOpen || Boolean(editAppAccount)} accountId={editAppAccount?.id ?? reconnecting}
        editApp={Boolean(editAppAccount)} defaultProfileId={profileId || undefined}
        onClose={() => {
          setWizardOpen(false);
          setReconnecting(undefined);
          if (editAppAccount) setSearchParams((params) => {
            const next = new URLSearchParams(params);
            next.delete("editApp");
            return next;
          }, { replace: true });
        }} />
    </div>
  );
}
