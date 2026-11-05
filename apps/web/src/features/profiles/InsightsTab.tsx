import type { InsightApplyField, InsightRecommendations, ProfileDetail, ProfileInsight } from "@vg/shared";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import {
  useApplyInsight,
  useDismissInsight,
  useLearning,
  useRunInsight,
  useSaveLearningSettings,
  useUndoInsight,
} from "../../hooks/useLearning";

const FIELD_LABEL: Record<InsightApplyField, string> = {
  directionAddendum: "Ghi chú bài học",
  preferredDuration: "Thời lượng mặc định",
  publishTimes: "Giờ đăng",
  topicAngles: "Góc chủ đề",
  avoid: "Nên tránh",
};

function recommendationCards(recommendations: InsightRecommendations): Array<{ field: InsightApplyField; text: string }> {
  const cards: Array<{ field: InsightApplyField; text: string }> = [];
  if (recommendations.directionAddendum) {
    cards.push({ field: "directionAddendum", text: recommendations.directionAddendum });
  }
  if (recommendations.preferredDurationSec) {
    const range = recommendations.preferredDurationSec;
    cards.push({ field: "preferredDuration", text: `${range.min}–${range.max} giây` });
  }
  if (recommendations.publishTimes?.length) {
    cards.push({ field: "publishTimes", text: recommendations.publishTimes.join(", ") });
  }
  if (recommendations.topicAngles?.length) {
    cards.push({ field: "topicAngles", text: recommendations.topicAngles.join("; ") });
  }
  if (recommendations.avoid?.length) {
    cards.push({ field: "avoid", text: recommendations.avoid.join("; ") });
  }
  return cards;
}

function InsightCard({
  profileId,
  insight,
  actionable,
}: {
  profileId: string;
  insight: ProfileInsight;
  actionable: boolean;
}) {
  const apply = useApplyInsight(profileId);
  const dismiss = useDismissInsight(profileId);
  const cards = recommendationCards(insight.recommendations).filter((card) =>
    !insight.dismissedFields.includes(card.field));
  return (
    <article className="panel">
      <p className="eyebrow">{insight.period} · {insight.status}</p>
      <pre className="insight-summary">{insight.summary}</pre>
      {insight.patterns.length > 0 && (
        <ul>
          {insight.patterns.map((pattern) => (
            <li key={`${pattern.kind}-${pattern.finding}`}>
              <strong>{pattern.finding}</strong>
              <span> — {pattern.evidence} ({pattern.confidence})</span>
            </li>
          ))}
        </ul>
      )}
      {cards.map((card) => {
        const applied = insight.appliedFields.includes(card.field);
        return (
          <div key={card.field} className="insight-card">
            <p><strong>{FIELD_LABEL[card.field]}</strong></p>
            <p>{card.text}</p>
            {actionable && !applied && (
              <div className="button-row">
                <button
                  type="button"
                  onClick={() => void apply.mutateAsync({ insightId: insight.id, fields: [card.field] })}
                  disabled={apply.isPending}
                >
                  Áp dụng
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void dismiss.mutateAsync({ insightId: insight.id, fields: [card.field] })}
                  disabled={dismiss.isPending}
                >
                  Bỏ qua
                </button>
              </div>
            )}
            {applied && <p>Đã áp dụng</p>}
          </div>
        );
      })}
    </article>
  );
}

export function InsightsTab({ profile }: { profile: ProfileDetail }) {
  const view = useLearning(profile.id);
  const save = useSaveLearningSettings(profile.id);
  const run = useRunInsight(profile.id);
  const undo = useUndoInsight(profile.id);

  if (view.isPending) return <Spinner label="Đang tải bài học" />;
  if (view.isError || !view.data) {
    return (
      <ErrorState
        message={view.error instanceof Error ? view.error.message : "Không tải được bài học"}
        onRetry={() => void view.refetch()}
      />
    );
  }

  const data = view.data;
  const message = run.data?.message ?? data.message;

  return (
    <div className="page-stack">
      <section className="panel">
        <label>
          Cách học
          <select
            aria-label="Cách học"
            value={data.learningMode}
            onChange={(event) => void save.mutateAsync({ learningMode: event.target.value as typeof data.learningMode })}
          >
            <option value="off">Tắt</option>
            <option value="suggest">Chỉ gợi ý</option>
            <option value="auto">Tự áp dụng</option>
          </select>
        </label>
        {data.titleAbAvailable ? (
          <label>
            <input
              type="checkbox"
              checked={data.titleAbTest}
              onChange={(event) => void save.mutateAsync({ titleAbTest: event.target.checked })}
            />
            Thử 2 tiêu đề
          </label>
        ) : (
          <p>{data.titleAbReason}</p>
        )}
        <div className="button-row">
          <button type="button" onClick={() => void run.mutateAsync()} disabled={run.isPending}>
            Phân tích ngay
          </button>
          {data.canUndo && (
            <button type="button" className="secondary" onClick={() => void undo.mutateAsync()} disabled={undo.isPending}>
              Hoàn tác
            </button>
          )}
        </div>
        {message && <p role="status">{message}</p>}
        {run.isError && <p role="alert">{run.error instanceof Error ? run.error.message : "Không phân tích được"}</p>}
        <p>Đã có {data.scoredCount} video đủ điểm.</p>
        {data.learnedNotes && (
          <p><strong>Bài học đang dùng:</strong> {data.learnedNotes}</p>
        )}
      </section>
      {data.latest ? (
        <InsightCard profileId={profile.id} insight={data.latest} actionable={data.latest.status !== "dismissed"} />
      ) : (
        <p>Chưa có bài học.</p>
      )}
      {data.history.length > 1 && (
        <section>
          <h2>Lịch sử</h2>
          {data.history.slice(1).map((insight) => (
            <InsightCard key={insight.id} profileId={profile.id} insight={insight} actionable={false} />
          ))}
        </section>
      )}
    </div>
  );
}
