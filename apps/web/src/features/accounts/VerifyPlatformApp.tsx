import { useMutation } from "@tanstack/react-query";
import { Button } from "../../components/ui/Button";
import { verifyPlatformApp } from "../../services/connectionsApi";

export function VerifyPlatformApp({ profileId, accountId }: { profileId?: string; accountId?: string }) {
  const check = useMutation({ mutationFn: () => verifyPlatformApp("youtube", profileId, accountId) });
  return (
    <div>
      <Button variant="secondary" loading={check.isPending} onClick={() => check.mutate()}>Kiểm tra ứng dụng</Button>
      {check.data ? <p role="status" className={check.data.ok === false ? "ui-field-error" : undefined}>
        {check.data.ok ? <strong style={{ color: "var(--success, #16803c)" }}>Ứng dụng hợp lệ</strong> : check.data.reason ?? "Chưa hỗ trợ"}
      </p> : null}
      {check.error ? <p role="alert" className="ui-field-error">{check.error.message}</p> : null}
    </div>
  );
}
