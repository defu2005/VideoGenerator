import type {
  FinanceSummaryResponse,
  PlatformId,
  RevenueKind,
} from "@vg/shared";
import { PLATFORM_REVENUE_HELP_VI } from "@vg/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { KpiCard } from "../../components/ui/KpiCard";
import { formatMoney } from "../../lib/format";
import {
  commitRevenueCsv,
  createCost,
  createRevenue,
  financeKeys,
  getFinanceCurrency,
  getFinanceSummary,
  getMonthlyReport,
  listMonthlyReports,
  listPayoutThresholds,
  listYoutubeRevenueAccounts,
  previewRevenueCsv,
  regenerateMonthlyReport,
  enableYoutubeRevenue,
  upsertFinanceRate,
  upsertPayoutThreshold,
} from "../../services/financeApi";
import { getProfiles } from "../../services/profilesApi";
import { oauthStartUrl } from "../../services/publishApi";
import { StackedBarChart } from "../analytics/charts";

const RANGE_PRESETS = [
  { days: 30, label: "30 ngày" },
  { days: 90, label: "90 ngày" },
  { days: 365, label: "12 tháng" },
] as const;

const REVENUE_KINDS: RevenueKind[] = [
  "ads", "creator_fund", "sponsorship", "affiliate", "gift", "other", "payout",
];

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeFromDays(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));
  return { from: toDateInput(from), to: toDateInput(to) };
}

function downloadCsv(filename: string, rows: string[][]): void {
  const body = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function FinancePage() {
  const queryClient = useQueryClient();
  const initial = rangeFromDays(30);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [profileId, setProfileId] = useState("");
  const [reportMonth, setReportMonth] = useState("");

  const [revForm, setRevForm] = useState({
    kind: "ads" as RevenueKind,
    periodStart: initial.to,
    periodEnd: initial.to,
    amount: "",
    currency: "VND",
    note: "",
    accountId: "",
  });
  const [costForm, setCostForm] = useState({
    kind: "other" as "llm" | "tts" | "stock_media" | "tool_subscription" | "ads_spend" | "other",
    date: initial.to,
    amount: "",
    currency: "VND",
    note: "",
  });
  const [csvText, setCsvText] = useState("");
  const [csvErrors, setCsvErrors] = useState<string | null>(null);
  const [rateForm, setRateForm] = useState({ currency: "USD", rate: "" });
  const [payoutForm, setPayoutForm] = useState({
    accountId: "",
    threshold: "",
    balance: "",
    currency: "VND",
  });

  const summaryQuery = useQuery({
    queryKey: financeKeys.summary({ from, to, profileId: profileId || undefined }),
    queryFn: () => getFinanceSummary({ from, to, profileId: profileId || undefined }),
  });
  const currencyQuery = useQuery({ queryKey: financeKeys.currency, queryFn: getFinanceCurrency });
  const profilesQuery = useQuery({ queryKey: ["profiles"], queryFn: () => getProfiles() });
  const reportsQuery = useQuery({ queryKey: financeKeys.reports, queryFn: listMonthlyReports });
  const reportDetailQuery = useQuery({
    queryKey: financeKeys.report(reportMonth),
    queryFn: () => getMonthlyReport(reportMonth),
    enabled: Boolean(reportMonth),
  });
  const youtubeQuery = useQuery({ queryKey: financeKeys.youtube, queryFn: listYoutubeRevenueAccounts });
  const payoutQuery = useQuery({ queryKey: financeKeys.payouts, queryFn: listPayoutThresholds });

  const createRevMut = useMutation({
    mutationFn: createRevenue,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
      setRevForm((f) => ({ ...f, amount: "", note: "" }));
    },
  });
  const createCostMut = useMutation({
    mutationFn: createCost,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
      setCostForm((f) => ({ ...f, amount: "", note: "" }));
    },
  });
  const csvMut = useMutation({
    mutationFn: async () => {
      const body = {
        csv: csvText,
        mapping: {
          periodStart: "period_start",
          periodEnd: "period_end",
          amount: "amount",
          currency: "currency",
          kind: "kind",
          note: "note",
        },
        defaults: {
          currency: "VND",
          kind: "other" as const,
          profileId: profileId || null,
        },
      };
      const preview = await previewRevenueCsv(body);
      if (preview.errors.length > 0) {
        throw new Error(`Lỗi dòng: ${preview.errors.map((e) => `${e.rowNumber}: ${e.message}`).join("; ")}`);
      }
      return commitRevenueCsv(body);
    },
    onSuccess: () => {
      setCsvErrors(null);
      setCsvText("");
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
    onError: (err: Error) => setCsvErrors(err.message),
  });
  const rateMut = useMutation({
    mutationFn: () => upsertFinanceRate({
      currency: rateForm.currency,
      rateToAppCurrency: Number(rateForm.rate),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.currency });
      setRateForm((f) => ({ ...f, rate: "" }));
    },
  });
  const payoutMut = useMutation({
    mutationFn: () => upsertPayoutThreshold(payoutForm.accountId, {
      thresholdAmount: Number(payoutForm.threshold),
      currency: payoutForm.currency,
      currentBalance: payoutForm.balance === "" ? null : Number(payoutForm.balance),
    }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: financeKeys.payouts }),
  });
  const regenMut = useMutation({
    mutationFn: (month: string) => regenerateMonthlyReport(month),
    onSuccess: (data) => {
      setReportMonth(data.month);
      void queryClient.invalidateQueries({ queryKey: financeKeys.reports });
      void queryClient.invalidateQueries({ queryKey: financeKeys.report(data.month) });
    },
  });
  const ytEnableMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => enableYoutubeRevenue(id, enabled),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: financeKeys.youtube }),
  });

  const summary = summaryQuery.data;
  const stacked = useMemo(() => {
    if (!summary) return [];
    return summary.byMonth.map((m) => ({
      id: m.month,
      label: m.month.slice(5),
      segments: [
        { id: "revenue", value: m.revenue, color: "#16a34a" },
        { id: "cost", value: m.cost, color: "#dc2626" },
      ],
    }));
  }, [summary]);

  const revAmountValid = revForm.amount !== "" && Number.isFinite(Number(revForm.amount));
  const costAmountValid = costForm.amount !== "" && Number.isFinite(Number(costForm.amount));

  return (
    <section className="page finance-page">
      <header className="page-header">
        <h1>Doanh thu</h1>
        <p>Theo dõi doanh thu, chi phí LLM/TTS và lợi nhuận theo video / kênh / hồ sơ.</p>
      </header>

      <div className="filters-row" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <label>
          Từ
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Từ ngày" />
        </label>
        <label>
          Đến
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Đến ngày" />
        </label>
        <label>
          Hồ sơ
          <select
            aria-label="Lọc hồ sơ"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
          >
            <option value="">Tất cả</option>
            {(profilesQuery.data?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.days}
            type="button"
            onClick={() => {
              const r = rangeFromDays(p.days);
              setFrom(r.from);
              setTo(r.to);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {summaryQuery.isLoading && <Spinner label="Đang tải doanh thu…" />}
      {summaryQuery.isError && (
        <ErrorState
          message={summaryQuery.error instanceof Error ? summaryQuery.error.message : "Không tải được doanh thu"}
          onRetry={() => void summaryQuery.refetch()}
        />
      )}

      {summary && <SummarySection summary={summary} stacked={stacked} />}

      <section className="card" style={{ marginTop: 24 }}>
        <h2>Thêm doanh thu</h2>
        <p className="field-hint">
          TikTok / Facebook / Instagram không có API doanh thu chung — nhập tay hoặc CSV.
          {Object.entries(PLATFORM_REVENUE_HELP_VI).map(([k, v]) => (
            <span key={k} style={{ display: "block" }}><strong>{k}</strong>: {v}</span>
          ))}
        </p>
        <form
          aria-label="Form doanh thu"
          onSubmit={(e) => {
            e.preventDefault();
            if (!revAmountValid) return;
            createRevMut.mutate({
              kind: revForm.kind,
              periodStart: revForm.periodStart,
              periodEnd: revForm.periodEnd,
              amount: Number(revForm.amount),
              currency: revForm.currency,
              note: revForm.note || null,
              accountId: revForm.accountId || null,
              profileId: profileId || null,
            });
          }}
          style={{ display: "grid", gap: 8, maxWidth: 480 }}
        >
          <label>
            Loại
            <select
              aria-label="Loại doanh thu"
              value={revForm.kind}
              onChange={(e) => setRevForm({ ...revForm, kind: e.target.value as RevenueKind })}
            >
              {REVENUE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label>
            Từ ngày
            <input
              type="date"
              aria-label="Period start"
              value={revForm.periodStart}
              onChange={(e) => setRevForm({ ...revForm, periodStart: e.target.value })}
            />
          </label>
          <label>
            Đến ngày
            <input
              type="date"
              aria-label="Period end"
              value={revForm.periodEnd}
              onChange={(e) => setRevForm({ ...revForm, periodEnd: e.target.value })}
            />
          </label>
          <label>
            Số tiền
            <input
              aria-label="Số tiền doanh thu"
              value={revForm.amount}
              onChange={(e) => setRevForm({ ...revForm, amount: e.target.value })}
              required
            />
          </label>
          {!revAmountValid && revForm.amount !== "" && (
            <p role="alert">Số tiền không hợp lệ</p>
          )}
          <label>
            Tiền tệ
            <select
              aria-label="Tiền tệ doanh thu"
              value={revForm.currency}
              onChange={(e) => setRevForm({ ...revForm, currency: e.target.value })}
            >
              <option value="VND">VND</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label>
            Ghi chú
            <input
              aria-label="Ghi chú doanh thu"
              value={revForm.note}
              onChange={(e) => setRevForm({ ...revForm, note: e.target.value })}
            />
          </label>
          <button type="submit" disabled={!revAmountValid || createRevMut.isPending}>
            Lưu doanh thu
          </button>
        </form>
      </section>

      <section className="card" style={{ marginTop: 24 }}>
        <h2>Thêm chi phí thủ công</h2>
        <form
          aria-label="Form chi phí"
          onSubmit={(e) => {
            e.preventDefault();
            if (!costAmountValid) return;
            createCostMut.mutate({
              kind: costForm.kind,
              date: costForm.date,
              amount: Number(costForm.amount),
              currency: costForm.currency,
              note: costForm.note || null,
              profileId: profileId || null,
            });
          }}
          style={{ display: "grid", gap: 8, maxWidth: 480 }}
        >
          <label>
            Loại
            <select
              aria-label="Loại chi phí"
              value={costForm.kind}
              onChange={(e) => setCostForm({ ...costForm, kind: e.target.value as typeof costForm.kind })}
            >
              {["llm", "tts", "stock_media", "tool_subscription", "ads_spend", "other"].map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Ngày
            <input
              type="date"
              aria-label="Ngày chi phí"
              value={costForm.date}
              onChange={(e) => setCostForm({ ...costForm, date: e.target.value })}
            />
          </label>
          <label>
            Số tiền
            <input
              aria-label="Số tiền chi phí"
              value={costForm.amount}
              onChange={(e) => setCostForm({ ...costForm, amount: e.target.value })}
              required
            />
          </label>
          <button type="submit" disabled={!costAmountValid || createCostMut.isPending}>
            Lưu chi phí
          </button>
        </form>
      </section>

      <section className="card" style={{ marginTop: 24 }}>
        <h2>Nhập CSV</h2>
        <p className="field-hint">Cột: period_start, period_end, amount, currency, kind, note. Một dòng lỗi → từ chối cả file.</p>
        <textarea
          aria-label="CSV doanh thu"
          rows={6}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={"period_start,period_end,amount,currency,kind,note\n2026-10-01,2026-10-31,1000000,VND,ads,Thang 10"}
          style={{ width: "100%", fontFamily: "monospace" }}
        />
        {csvErrors && <p role="alert">{csvErrors}</p>}
        <button type="button" onClick={() => csvMut.mutate()} disabled={!csvText.trim() || csvMut.isPending}>
          Xem trước &amp; lưu CSV
        </button>
      </section>

      <section className="card" style={{ marginTop: 24 }}>
        <h2>Tỷ giá &amp; tiền tệ app</h2>
        <p>Tiền tệ app: <strong>{currencyQuery.data?.appCurrency ?? "…"}</strong></p>
        <ul>
          {(currencyQuery.data?.rates ?? []).map((r) => (
            <li key={r.currency}>{r.currency}: {r.rateToAppCurrency}</li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!rateForm.rate || !Number.isFinite(Number(rateForm.rate))) return;
            rateMut.mutate();
          }}
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          <input
            aria-label="Mã tiền tệ tỷ giá"
            value={rateForm.currency}
            onChange={(e) => setRateForm({ ...rateForm, currency: e.target.value.toUpperCase() })}
            placeholder="USD"
          />
          <input
            aria-label="Tỷ giá sang tiền app"
            value={rateForm.rate}
            onChange={(e) => setRateForm({ ...rateForm, rate: e.target.value })}
            placeholder="26000"
          />
          <button type="submit">Lưu tỷ giá</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: 24 }}>
        <h2>YouTube doanh thu (API)</h2>
        {(youtubeQuery.data?.items ?? []).length === 0 && <p>Chưa có tài khoản YouTube.</p>}
        <ul>
          {(youtubeQuery.data?.items ?? []).map((a) => (
            <li key={a.accountId}>
              {a.displayName}
              {" — "}
              {a.revenueSyncEnabled ? (a.revenueStatus ?? "ok") : "tắt"}
              {a.revenueStatus === "not_monetized" && " · Kênh chưa bật kiếm tiền"}
              {a.revenueStatus === "needs_reconnect" && (
                <>
                  {" · "}
                  <a href={oauthStartUrl(a.platform, a.accountId)}>Kết nối lại để bật thống kê doanh thu</a>
                </>
              )}
              <button
                type="button"
                style={{ marginLeft: 8 }}
                onClick={() => ytEnableMut.mutate({ id: a.accountId, enabled: !a.revenueSyncEnabled })}
              >
                {a.revenueSyncEnabled ? "Tắt" : "Bật thống kê doanh thu YouTube"}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" style={{ marginTop: 24 }}>
        <h2>Ngưỡng rút tiền</h2>
        <ul>
          {(payoutQuery.data?.items ?? []).map((t) => (
            <li key={t.accountId}>
              {t.displayName}: ngưỡng {formatMoney(t.thresholdAmount, t.currency)}
              {t.currentBalance != null ? ` · số dư ${formatMoney(t.currentBalance, t.currency)}` : ""}
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!payoutForm.accountId || !payoutForm.threshold) return;
            payoutMut.mutate();
          }}
          style={{ display: "grid", gap: 8, maxWidth: 480 }}
        >
          <label>
            Account ID
            <input
              aria-label="Account ID payout"
              value={payoutForm.accountId}
              onChange={(e) => setPayoutForm({ ...payoutForm, accountId: e.target.value })}
            />
          </label>
          <label>
            Ngưỡng
            <input
              aria-label="Ngưỡng rút"
              value={payoutForm.threshold}
              onChange={(e) => setPayoutForm({ ...payoutForm, threshold: e.target.value })}
            />
          </label>
          <label>
            Số dư hiện tại (tuỳ chọn)
            <input
              aria-label="Số dư hiện tại"
              value={payoutForm.balance}
              onChange={(e) => setPayoutForm({ ...payoutForm, balance: e.target.value })}
            />
          </label>
          <button type="submit">Lưu ngưỡng</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: 24 }}>
        <h2>Báo cáo tháng</h2>
        <ul>
          {(reportsQuery.data?.items ?? []).map((r) => (
            <li key={r.month}>
              <button type="button" onClick={() => setReportMonth(r.month)}>{r.month}</button>
              {" · "}
              <button type="button" onClick={() => regenMut.mutate(r.month)}>Tạo lại</button>
            </li>
          ))}
        </ul>
        <label>
          Tháng (YYYY-MM)
          <input
            aria-label="Tháng báo cáo"
            value={reportMonth}
            onChange={(e) => setReportMonth(e.target.value)}
            placeholder="2026-10"
          />
        </label>
        <button
          type="button"
          onClick={() => reportMonth && regenMut.mutate(reportMonth)}
          disabled={!reportMonth}
        >
          Tạo / tạo lại báo cáo
        </button>
        {reportDetailQuery.data && (
          <ReportDetail
            detail={reportDetailQuery.data}
            onCsv={() => {
              const r = reportDetailQuery.data.report;
              downloadCsv(`bao-cao-${r.month}.csv`, [
                ["metric", "value"],
                ["profit", String(r.profit)],
                ["margin", String(r.margin ?? "")],
                ["videosPublished", String(r.videosPublished)],
                ["publishFailures", String(r.publishFailures)],
                ...r.revenueByKind.map((x) => [`revenue:${x.kind}`, String(x.amount)]),
                ...r.costByKind.map((x) => [`cost:${x.kind}`, String(x.amount)]),
              ]);
            }}
          />
        )}
      </section>
    </section>
  );
}

function SummarySection({
  summary,
  stacked,
}: {
  summary: FinanceSummaryResponse;
  stacked: Array<{ id: string; label: string; segments: Array<{ id: string; value: number; color: string }> }>;
}) {
  return (
    <>
      <div className="kpi-row" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        <Kpi title="Doanh thu" value={formatMoney(summary.kpi.revenue, summary.currency)} />
        <Kpi title="Chi phí" value={formatMoney(summary.kpi.cost, summary.currency)} />
        <Kpi title="Lợi nhuận" value={formatMoney(summary.kpi.profit, summary.currency)} />
        <Kpi
          title="Biên lợi nhuận"
          value={summary.kpi.margin == null ? "—" : `${(summary.kpi.margin * 100).toFixed(1)}%`}
        />
      </div>

      <section style={{ marginTop: 24 }}>
        <h2>Doanh thu vs chi phí theo tháng</h2>
        <StackedBarChart data={stacked} ariaLabel="Biểu đồ doanh thu và chi phí theo tháng" />
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Theo hồ sơ</h2>
        <table>
          <thead>
            <tr><th>Hồ sơ</th><th>Doanh thu</th><th>Chi phí</th><th>Lợi nhuận</th></tr>
          </thead>
          <tbody>
            {summary.byProfile.map((p) => (
              <tr key={p.profileId ?? "none"}>
                <td>{p.profileName}</td>
                <td>{formatMoney(p.revenue, summary.currency)}</td>
                <td>{formatMoney(p.cost, summary.currency)}</td>
                <td>{formatMoney(p.profit, summary.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Theo nền tảng</h2>
        <table>
          <thead>
            <tr><th>Nền tảng</th><th>Doanh thu</th><th>Chi phí</th><th>Lợi nhuận</th></tr>
          </thead>
          <tbody>
            {summary.byPlatform.map((p) => (
              <tr key={String(p.platform)}>
                <td>{(p.platform as PlatformId | null) ?? "(không)"}</td>
                <td>{formatMoney(p.revenue, summary.currency)}</td>
                <td>{formatMoney(p.cost, summary.currency)}</td>
                <td>{formatMoney(p.profit, summary.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Theo video</h2>
        <table>
          <thead>
            <tr><th>Video</th><th>Doanh thu</th><th>Chi phí</th><th>Lợi nhuận</th></tr>
          </thead>
          <tbody>
            {summary.byVideo.slice(0, 20).map((v, i) => (
              <tr key={`${v.publicationId ?? v.title}-${i}`}>
                <td>
                  {v.title}
                  {v.revenueEstimated ? " (ước tính)" : ""}
                </td>
                <td>{formatMoney(v.revenue, summary.currency)}</td>
                <td>{formatMoney(v.cost, summary.currency)}</td>
                <td>{formatMoney(v.profit, summary.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Kpi({ title, value }: { title: string; value: string }) {
  return <KpiCard label={title} value={value} />;
}

function ReportDetail({
  detail,
  onCsv,
}: {
  detail: { month: string; report: { profit: number; margin: number | null; insightBullets?: string[]; currency: string } };
  onCsv: () => void;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <h3>Chi tiết {detail.month}</h3>
      <p>Lợi nhuận: {formatMoney(detail.report.profit, detail.report.currency)}</p>
      {detail.report.insightBullets && (
        <ul>
          {detail.report.insightBullets.map((b, i) => <li key={`${i}-${b}`}>{b}</li>)}
        </ul>
      )}
      <button type="button" onClick={onCsv}>Tải CSV</button>
    </div>
  );
}
