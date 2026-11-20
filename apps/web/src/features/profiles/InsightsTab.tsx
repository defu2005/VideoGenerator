import type { InsightApplyField, InsightRecommendations, ProfileDetail, ProfileInsight } from "@vg/shared";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import {
  useApplyInsight,
  useDecideStageNote,
  useDismissInsight,
  useLearning,
  useRunInsight,
  useSaveLearningSettings,
  useStageNotes,
  useUndoInsight,
} from "../../hooks/useLearning";

const STAGE_LABEL: Record<string, string> = {
  RESEARCH: "Nghiên cứu",
  SCRIPT: "Kịch bản",
  SCENE_PLAN: "Phân cảnh",
  VISUAL_REVIEW: "Duyệt hình ảnh",
  MUSIC_REVIEW: "Duyệt nhạc",
  FINAL_APPROVAL: "Duyệt cuối",
};

const STATUS_LABEL: Record<string, string> = {
  proposed: "Chờ duyệt",
  approved: "Đang dùng",
  rejected: "Đã từ chối",
  retired: "Đã gỡ",
};

/** TASK-148a/b: lessons per stage. Only a person approves; approved lessons feed the next prompts. */
function StageLessonsSection({ profileId }: { profileId: string }) {
  const notes = useStageNotes(profileId);
  const decide = useDecideStageNote(profileId);
  if (notes.isPending) return <Spinner label="Đang tải bài học theo bước" />;
  if (notes.isError || !notes.data) {
    return <p role="alert">{notes.error instanceof Error ? notes.error.message : "Không tải được bài học theo bước"}</p>;
  }
  if (notes.data.length === 0) {
    return <p>Chưa có bài học theo bước. Bài học được đề xuất mỗi tuần khi đủ dữ liệu.</p>;
  }
  return (
    <section>
      <h2>Bài học theo bước</h2>
      {notes.data.map((note) => (
        <article key={note.id} className="panel">
          <p className="eyebrow">
            {STAGE_LABEL[note.stage] ?? note.stage} · {STATUS_LABEL[note.status] ?? note.status}
            {note.profileId === null ? " · chung" : ""}
          </p>
          <p>{note.text}</p>
          <p>Dùng {note.uses} lần · Dựa trên {note.evidenceIds.length} mục phản hồi</p>
          <div className="button-row">
            {note.status === "proposed" && (
              <>
                <button type="button" onClick={() => void decide.mutateAsync({ noteId: note.id, decision: "approve" })} disabled={decide.isPending}>
                  Duyệt
                </button>
                <button type="button" className="secondary" onClick={() => void decide.mutateAsync({ noteId: note.id, decision: "reject" })} disabled={decide.isPending}>
                  Từ chối
                </button>
              </>
            )}
            {note.status === "approved" && (
              <button type="button" className="secondary" onClick={() => void decide.mutateAsync({ noteId: note.id, decision: "retire" })} disabled={decide.isPending}>
                Gỡ
              </button>
            )}
            {(note.status === "approved" || note.status === "rejected") && (
              <button type="button" className="secondary" onClick={() => void decide.mutateAsync({ noteId: note.id, decision: "undo" })} disabled={decide.isPending}>
                Hoàn tác
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}

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
      <StageLessonsSection profileId={profile.id} />
    </div>
  );
}
