import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import {
  applyRoutingProposal,
  compareProviderModels,
  getProviderIntelPage,
  markIntelChangeReviewed,
  rerunProviderAudit,
  saveProviderChecklist,
  saveProviderFeeds,
  updateOmnirouteCombos,
  type ProviderCard,
  type ProviderIntelPageData,
} from "../../services/providerIntelApi";

const TABS = [
  ["overview", "Tổng quan"],
  ["using", "Đang dùng trong OmniRoute"],
  ["catalog", "Danh mục nhà cung cấp"],
  ["offers", "Ưu đãi và lợi ích"],
  ["billing", "Rủi ro thanh toán"],
  ["routing", "Định tuyến"],
  ["changes", "Thay đổi cần xem"],
  ["abilities", "Năng lực và benchmark"],
] as const;

type TabId = (typeof TABS)[number][0];

export function ProvidersPage() {
  const queryClient = useQueryClient();
  const page = useQuery({ queryKey: ["provider-intel", "page"], queryFn: getProviderIntelPage });
  const [tab, setTab] = useState<TabId>("overview");
  const [noCard, setNoCard] = useState(false);
  const [vietnamOnly, setVietnamOnly] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);
  const checklist = useMutation({
    mutationFn: (input: { id: string; value: boolean }) => saveProviderChecklist(input.id, "billing.cardRequired", input.value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-intel", "page"] }),
  });
  const apply = useMutation({
    mutationFn: (proposalId: string) => applyRoutingProposal(proposalId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-intel", "page"] }),
  });
  const updateRoute = useMutation({
    mutationFn: (profiles: Array<{ id: string; models: string[] }>) => updateOmnirouteCombos(profiles),
  });
  const reviewed = useMutation({
    mutationFn: (id: string) => markIntelChangeReviewed(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-intel", "page"] }),
  });
  const audit = useMutation({
    mutationFn: () => rerunProviderAudit(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-intel", "page"] }),
  });
  const feeds = useMutation({
    mutationFn: (next: Array<{ url: string; label: string }>) => saveProviderFeeds(next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-intel", "page"] }),
  });

  const providers = useMemo(() => {
    const rows = [...(page.data?.providers ?? [])];
    return rows.filter((row) => {
      if (noCard && row.cardRequired) return false;
      if (vietnamOnly && !row.vietnam) return false;
      if (freeOnly && row.flags.includes("NO_API_ACCESS")) return false;
      return true;
    }).sort((a, b) => ((b.score ?? -1) - (a.score ?? -1)) * (sortDesc ? 1 : -1));
  }, [page.data?.providers, noCard, vietnamOnly, freeOnly, sortDesc]);

  if (page.isLoading) return <Spinner />;
  if (page.isError || !page.data) return <ErrorState message="Không tải được nhà cung cấp." onRetry={() => page.refetch()} />;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MÔ HÌNH & DỊCH VỤ</p>
          <h1>Nhà cung cấp AI</h1>
          <p className="page-subtitle">Theo dõi trạng thái, ưu đãi, chi phí và hiệu năng các nhà cung cấp AI.</p>
        </div>
      </div>

      <nav className="tab-bar" aria-label="Tab nhà cung cấp">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : undefined}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? <Overview data={page.data} onSaveFeeds={(next) => feeds.mutate(next)} /> : null}
      {tab === "using" ? <Using data={page.data} onRecheck={() => audit.mutate()} /> : null}
      {tab === "catalog" ? (
        <Catalog
          rows={providers}
          noCard={noCard}
          vietnamOnly={vietnamOnly}
          freeOnly={freeOnly}
          onNoCard={setNoCard}
          onVietnam={setVietnamOnly}
          onFree={setFreeOnly}
          onSort={() => setSortDesc((value) => !value)}
        />
      ) : null}
      {tab === "offers" ? <Offers data={page.data} /> : null}
      {tab === "billing" ? (
        <Billing
          rows={page.data.billing}
          onCheck={(id) => checklist.mutate({ id, value: false })}
        />
      ) : null}
      {tab === "routing" ? (
        <Routing
          data={page.data}
          onApply={(id) => apply.mutate(id)}
          onUpdate={() => updateRoute.mutate(page.data?.proposals.map((item) => ({ id: item.profileId, models: item.modelIds })) ?? [])}
        />
      ) : null}
      {tab === "changes" ? <Changes data={page.data} onReviewed={(id) => reviewed.mutate(id)} /> : null}
      {tab === "abilities" ? <Abilities data={page.data} /> : null}
    </div>
  );
}

function Overview({ data, onSaveFeeds }: { data: ProviderIntelPageData; onSaveFeeds: (feeds: Array<{ url: string; label: string }>) => void }) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");

  return (
    <div className="page-stack">
      <section className="stats-grid" aria-label="Tổng quan nhà cung cấp" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {data.overview.map((item) => (
          <div key={item.id} className="stat-tile" style={{ minHeight: 90, cursor: "default", padding: 14 }}>
            <span className="stat-label" style={{ fontSize: 11, color: "var(--color-neutral-500)", fontWeight: 650 }}>{item.questionVi}</span>
            <strong style={{ fontSize: 14, fontWeight: 600, color: "var(--color-neutral-900)", marginTop: 6, lineHeight: 1.4 }}>{item.answerVi}</strong>
          </div>
        ))}
      </section>

      <section className="panel" style={{ padding: 20 }}>
        <h2>Nguồn theo dõi</h2>
        <ul className="attention-list" style={{ marginBottom: 16 }}>
          {data.feeds.map((feed) => (
            <li key={feed.url}>
              <strong>{feed.label}</strong>
              <a href={feed.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, wordBreak: "break-all" }}>{feed.url}</a>
            </li>
          ))}
        </ul>
        <form
          className="filter-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!url || !label) return;
            onSaveFeeds([...data.feeds, { url, label }].slice(0, 20));
            setUrl("");
            setLabel("");
          }}
        >
          <label className="form-field" style={{ margin: 0 }}>
            <span>Nhãn nguồn</span>
            <input aria-label="Nhãn nguồn" value={label} placeholder="vd: Groq Blog" onChange={(event) => setLabel(event.target.value)} />
          </label>
          <label className="form-field" style={{ margin: 0, flex: 2 }}>
            <span>URL nguồn</span>
            <input aria-label="URL nguồn" value={url} placeholder="https://..." onChange={(event) => setUrl(event.target.value)} />
          </label>
          <button type="submit" className="button button-primary" style={{ alignSelf: "flex-end" }}>Lưu nguồn</button>
        </form>
      </section>
    </div>
  );
}

function Using({ data, onRecheck }: { data: ProviderIntelPageData; onRecheck: () => void }) {
  return (
    <section className="panel" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2>Kết nối OmniRoute</h2>
        <button type="button" className="button button-secondary" onClick={onRecheck}>Kiểm tra lại</button>
      </div>
      {!data.connections || data.connections.needsToken ? (
        <p className="field-hint">{data.connections?.stepsVi || data.needsTokenStepsVi}</p>
      ) : (
        <ul className="attention-list">
          {data.connections.connections.map((item) => (
            <li key={item.id}>
              <strong>{item.label}</strong>
              <span>{item.states.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Catalog(props: {
  rows: ProviderCard[];
  noCard: boolean;
  vietnamOnly: boolean;
  freeOnly: boolean;
  onNoCard: (value: boolean) => void;
  onVietnam: (value: boolean) => void;
  onFree: (value: boolean) => void;
  onSort: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = props.rows.find((row) => row.id === openId) ?? null;

  return (
    <div className="page-stack">
      <div className="filter-toolbar" style={{ gap: 16 }}>
        <label className="checkbox-field">
          <input type="checkbox" checked={props.noCard} onChange={(event) => props.onNoCard(event.target.checked)} />
          Không cần thẻ
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={props.freeOnly} onChange={(event) => props.onFree(event.target.checked)} />
          API miễn phí
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={props.vietnamOnly} onChange={(event) => props.onVietnam(event.target.checked)} />
          Việt Nam dùng được
        </label>
      </div>

      <div className="panel ui-table-wrap" style={{ padding: 0 }}>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Tên</th>
              <th><button type="button" className="text-button" onClick={props.onSort} style={{ fontWeight: 700 }}>Điểm ↕</button></th>
              <th>Hợp lệ</th>
              <th>Việt Nam</th>
              <th>Ưu đãi</th>
              <th>Rủi ro</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.id}>
                <td><button type="button" className="button button-ghost" style={{ padding: 0, fontWeight: 650 }} onClick={() => setOpenId(row.id)}>{row.name}</button></td>
                <td><strong>{row.score ?? "UNKNOWN"}</strong></td>
                <td>{row.legitimacy ?? "UNKNOWN"}</td>
                <td>{row.vietnam ? "Có" : "Chưa rõ"}</td>
                <td>{row.bestOffer || "Chưa có"}</td>
                <td>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {row.flags.map((flag) => <span key={flag} className="badge badge-danger">{flag}</span>)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open ? (
        <aside className="panel" style={{ padding: 20 }}>
          <h2>{open.name}</h2>
          <p><a href={open.website} target="_blank" rel="noreferrer" className="underline">{open.website}</a></p>
          <p className="field-hint">Điểm {open.score ?? "UNKNOWN"} không che cờ rủi ro.</p>
        </aside>
      ) : null}
    </div>
  );
}

function Offers({ data }: { data: ProviderIntelPageData }) {
  return (
    <div className="page-stack">
      <section className="panel" style={{ padding: 20 }}>
        <h2>Đang có</h2>
        {data.offers.active.length === 0 ? <p className="field-hint">Chưa có ưu đãi đã kiểm chứng.</p> : (
          <ul className="attention-list">
            {data.offers.active.map((offer) => (
              <li key={offer.id}>
                <strong>{offer.providerId}</strong>
                <span>{offer.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" style={{ padding: 20 }}>
        <h2>Sắp hết hạn</h2>
        <p className="field-hint">{data.offers.expiring.length} mục trong 7 ngày.</p>
      </section>

      <section className="panel" style={{ padding: 20 }}>
        <h2>Đã hết hạn</h2>
        <p className="field-hint">{data.offers.expired.length} mục được giữ lại, không xoá.</p>
      </section>
    </div>
  );
}

function Billing(props: { rows: Array<{ providerId: string; name: string; riskLevel: string; unverified: boolean; safestVi?: string }>; onCheck: (id: string) => void }) {
  return (
    <div className="page-stack">
      {props.rows.map((row) => (
        <article key={row.providerId} className="panel" style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h2>{row.name}</h2>
              <p>Mức rủi ro: <strong>{row.riskLevel}</strong>{row.unverified ? " · chưa xác minh" : ""}</p>
              <p className="field-hint">Cách an toàn nhất để không phát sinh chi: {row.safestVi || "chưa có câu trả lời đã kiểm chứng."}</p>
            </div>
            <button type="button" className="button button-secondary" onClick={() => props.onCheck(row.providerId)}>
              Tôi đã kiểm tra trên dashboard
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function Routing(props: {
  data: ProviderIntelPageData;
  onApply: (id: string) => void;
  onUpdate: () => void;
}) {
  return (
    <section className="panel" style={{ padding: 20 }}>
      <h2>Đề xuất định tuyến</h2>
      <p className="field-hint">Xem trước OmniRoute: chỉ ghi combo tên va-. Nếu bản sao lưu lỗi thì không ghi gì.</p>
      {props.data.proposals.length === 0 ? (
        <p className="field-hint" style={{ marginTop: 12 }}>Chưa có đề xuất định tuyến.</p>
      ) : (
        <div style={{ display: "grid", gap: 10, margin: "16px 0" }}>
          {props.data.proposals.map((item) => (
            <article key={item.id} className="journal-item">
              <p style={{ margin: 0, fontWeight: 500 }}>{item.diffVi}</p>
              <button type="button" className="button button-primary" onClick={() => props.onApply(item.id)}>Áp dụng</button>
            </article>
          ))}
        </div>
      )}
      <button type="button" className="button button-secondary" onClick={props.onUpdate} style={{ marginTop: 12 }}>
        Cập nhật OmniRoute
      </button>
    </section>
  );
}

function Changes(props: { data: ProviderIntelPageData; onReviewed: (id: string) => void }) {
  const open = props.data.changes.filter((item) => item.needsReview);
  if (!open.length) return <p className="field-hint">Không có thay đổi cần xem.</p>;
  return (
    <section className="panel" style={{ padding: 20 }}>
      <h2>Thay đổi cần xem</h2>
      <ul className="attention-list" style={{ marginTop: 12 }}>
        {open.map((item) => (
          <li key={item.id}>
            <span>{item.what}</span>
            <button type="button" className="button button-secondary" onClick={() => props.onReviewed(item.id)}>Đã xem</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Abilities({ data }: { data: ProviderIntelPageData }) {
  const suites = data.suites.filter((suite) => suite.taskId !== "visionCheck");
  const [selectedSuite, setSelectedSuite] = useState("");
  const [baselineText, setBaselineText] = useState("");
  const [candidateText, setCandidateText] = useState("");
  const suite = suites.find((item) => item.id === selectedSuite) ?? suites[0];
  const evalRun = useMutation({
    mutationFn: compareProviderModels,
  });
  const baseline = evalModelRef(baselineText);
  const candidate = evalModelRef(candidateText);
  const report = evalRun.data;

  return (
    <div className="page-stack">
      <section className="panel ui-table-wrap" style={{ padding: 0 }}>
        <table className="ui-table">
          <thead>
            <tr><th>Tác vụ</th><th>Điểm</th><th>Độ tin cậy</th></tr>
          </thead>
          <tbody>
            {(data.tasks ?? []).slice(0, 8).map((task) => {
              const top = task.id === "metadata" ? data.scorecard?.ranked[0] : undefined;
              return (
                <tr key={task.id}>
                  <td>{task.label}</td>
                  <td><strong>{top ? top.score : "Chưa có"}</strong></td>
                  <td>{top?.confidence ?? "chưa đủ nguồn"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel" style={{ padding: 20 }}>
        <h2>So sánh model</h2>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            if (suite && baseline && candidate) evalRun.mutate({ suiteId: suite.id, baseline, candidate });
          }}
        >
          <label className="form-field" style={{ gridColumn: "1 / -1" }}>
            <span>Bộ mẫu</span>
            <select value={suite?.id ?? ""} onChange={(event) => setSelectedSuite(event.target.value)}>
              {suites.map((item) => <option key={item.id} value={item.id}>{item.titleVi}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span>Model hiện tại</span>
            <input placeholder="provider/model" value={baselineText} onChange={(event) => setBaselineText(event.target.value)} />
          </label>
          <label className="form-field">
            <span>Model ứng viên</span>
            <input placeholder="provider/model" value={candidateText} onChange={(event) => setCandidateText(event.target.value)} />
          </label>
          <p className="field-hint" style={{ gridColumn: "1 / -1", margin: "4px 0 12px" }}>
            Tối đa {(suite?.cases ?? 0) * 2} lượt gọi. Chỉ dùng gói miễn phí hoặc thuê bao đã xác định.
          </p>
          <div style={{ gridColumn: "1 / -1" }}>
            <button
              type="submit"
              className="button button-primary"
              disabled={!suite || !baseline || !candidate || evalRun.isPending}
            >
              {evalRun.isPending ? "Đang so sánh…" : "Chạy so sánh"}
            </button>
          </div>
        </form>
        {evalRun.isError && <p className="request-error" role="alert" style={{ marginTop: 12 }}>{evalRun.error.message}</p>}
        {report ? (
          <div className="panel" style={{ marginTop: 16, background: "var(--color-neutral-100)" }}>
            <p role="status" style={{ fontWeight: 600 }}>
              {report.recommendation === "candidate_eligible" ? "Ứng viên đạt ngưỡng để xem xét." : "Giữ model hiện tại."}
              {report.stopped ? " Lượt đánh giá kết thúc trước khi đủ mẫu." : ""}
            </p>
            <div className="ui-table-wrap" style={{ marginTop: 12 }}>
              <table className="ui-table">
                <thead><tr><th>Model</th><th>Mẫu</th><th>Chất lượng</th><th>Lỗi schema</th><th>Token</th><th>Chi phí ước tính</th><th>Độ trễ TB</th></tr></thead>
                <tbody>
                  {[report.baseline, report.candidate].map((item) => (
                    <tr key={`${item.provider}/${item.model}`}>
                      <td>{item.provider}/{item.model}</td>
                      <td>{item.cases}</td>
                      <td><strong>{Math.round(item.quality * 100)}%</strong></td>
                      <td>{Math.round(item.schemaErrorRate * 100)}%</td>
                      <td>{item.totalTokens ?? "Chưa rõ"}</td>
                      <td>{item.estimatedCostUsd === null ? "Chưa rõ" : `${item.estimatedCostUsd} USD`}</td>
                      <td>{Math.round(item.averageLatencyMs)} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function evalModelRef(value: string): { provider: string; model: string } | null {
  const separator = value.indexOf("/");
  if (separator < 1) return null;
  const provider = value.slice(0, separator).trim();
  const model = value.slice(separator + 1).trim();
  return provider && model ? { provider, model } : null;
}
