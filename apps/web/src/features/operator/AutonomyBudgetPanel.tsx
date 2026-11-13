import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AutonomyBudgetSchema, type AutonomyBudget } from "@vg/shared";
import { apiRequest } from "../../services/apiClient";

type BudgetResponse = { overrides: Partial<AutonomyBudget>; app: AutonomyBudget; effective: AutonomyBudget };
const fields = [
  { key: "dailyUsd", label: "Chi mỗi ngày (USD)", step: "any" },
  { key: "monthlyUsd", label: "Chi mỗi tháng (USD)", step: "any" },
  { key: "maxRendersPerDay", label: "Số lượt render mỗi ngày", step: "1" },
  { key: "maxPublishesPerDayPerAccount", label: "Số lượt đăng mỗi tài khoản mỗi ngày", step: "1" },
  { key: "maxOperatorRunsPerDay", label: "Số lượt operator mỗi ngày", step: "1" },
  { key: "maxQuestionsPerDay", label: "Số câu hỏi mỗi ngày", step: "1" },
] as const;
type Draft = Partial<Record<keyof AutonomyBudget, string>>;

export function AutonomyBudgetPanel({ profileId }: { profileId?: string }) {
  const client = useQueryClient();
  const scope = profileId ?? "app";
  const path = `/autonomy/${scope}/budget`;
  const query = useQuery({ queryKey: ["autonomy-budget", scope], queryFn: () => apiRequest<BudgetResponse>(path) });
  const [draft, setDraft] = useState<Draft>({});
  const save = useMutation({
    mutationFn: (budget: Partial<AutonomyBudget>) => apiRequest<BudgetResponse>(path, { method: "POST", body: JSON.stringify(budget) }),
    onSuccess: (result) => {
      client.setQueryData(["autonomy-budget", scope], result);
      setDraft({});
      void client.invalidateQueries({ queryKey: ["autonomy-budget"] });
    },
  });
  const data = query.data;
  const values = Object.fromEntries(fields.flatMap(({ key }) => {
    const value = draft[key] === undefined ? data?.overrides[key] : draft[key] === "" ? undefined : Number(draft[key]);
    return value === undefined ? [] : [[key, value]];
  }));
  const parsed = AutonomyBudgetSchema.partial().safeParse(values);
  return <details className="panel">
    <summary>Ngân sách tự vận hành</summary>
    <p>{profileId ? "Để trống để dùng cấu hình toàn app." : "Để trống để dùng giá trị mặc định."}</p>
    <p>Hạn mức chi áp dụng trong worker. Khi hết lượt render hoặc đăng, job chờ ngày tiếp theo. Giới hạn lượt operator áp dụng toàn app.</p>
    {query.isError && <p role="alert">{query.error.message}</p>}
    {data && <form onSubmit={(event) => {
      event.preventDefault();
      if (parsed.success) save.mutate(parsed.data);
    }}>
      <fieldset disabled={save.isPending}>
        <legend>Giới hạn</legend>
        {fields.map(({ key, label, step }) => <label key={key}>
          {label} <input type="number" min={0} step={step}
            placeholder={String((profileId ? data.app : data.effective)[key] ?? "—")}
            value={draft[key] ?? (data.overrides[key] == null ? "" : String(data.overrides[key]))}
            onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
        </label>)}
      </fieldset>
      <button type="submit" className="button" disabled={!Object.keys(draft).length || !parsed.success || save.isPending}>Lưu hạn mức</button>
      {save.isSuccess && <p role="status">Đã lưu hạn mức.</p>}
      {save.isError && <p role="alert">{save.error.message}</p>}
    </form>}
  </details>;
}
