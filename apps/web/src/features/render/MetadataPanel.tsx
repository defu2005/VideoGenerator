import {
  DEFAULT_AI_DISCLOSURE,
  appendDescriptionExtras,
  type Project,
  type VideoMetadataDraft,
} from "@vg/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { generateProjectMetadata, getProjectMetadata, saveProjectMetadata } from "../../services/metadataApi";
import { getProjectTimeline } from "../../services/timelineApi";

const metadataKeys = { project: (projectId: string) => ["metadata", projectId] as const };

function activeDraft(draft: VideoMetadataDraft | null | undefined, edited: VideoMetadataDraft | null | undefined): VideoMetadataDraft {
  return edited ?? draft ?? {
    titles: [""],
    description: "",
    tags: [],
    hashtags: [],
    thumbnailText: [],
  };
}

async function copyText(label: string, text: string): Promise<string> {
  await navigator.clipboard.writeText(text);
  return `Đã sao chép ${label}`;
}

export function MetadataPanel({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [includeChapters, setIncludeChapters] = useState(true);
  const [includeCredits, setIncludeCredits] = useState(true);
  const [includeDisclosure, setIncludeDisclosure] = useState(true);
  const [form, setForm] = useState<VideoMetadataDraft | null>(null);

  const metadata = useQuery({
    queryKey: metadataKeys.project(project.id),
    queryFn: () => getProjectMetadata(project.id),
  });
  const timeline = useQuery({
    queryKey: ["timeline", project.id],
    queryFn: () => getProjectTimeline(project.id),
  });

  useEffect(() => {
    if (!metadata.data?.metadata) {
      setForm(null);
      return;
    }
    setForm(activeDraft(metadata.data.metadata.draft, metadata.data.metadata.edited));
  }, [metadata.data]);

  const extras = metadata.data?.extras ?? {
    chaptersText: "",
    creditsText: "",
    disclosure: DEFAULT_AI_DISCLOSURE,
  };

  const composed = form
    ? appendDescriptionExtras({
      description: form.description,
      chaptersText: extras.chaptersText,
      creditsText: extras.creditsText,
      includeChapters,
      includeCredits,
      includeDisclosure,
      disclosure: extras.disclosure,
    })
    : "";

  const onError = (reason: unknown) => setError(reason instanceof Error ? reason.message : "Không thực hiện được yêu cầu");

  const save = useMutation({
    mutationFn: (draft: VideoMetadataDraft) => saveProjectMetadata(project.id, draft),
    onSuccess: (data) => {
      queryClient.setQueryData(metadataKeys.project(project.id), data);
      setNotice("Đã lưu chỉnh sửa");
    },
    onError,
  });

  const generate = useMutation({
    mutationFn: (overwriteEdits: boolean) => generateProjectMetadata(project.id, { overwriteEdits }),
    onSuccess: (data) => {
      queryClient.setQueryData(metadataKeys.project(project.id), data);
      setNotice("Đã tạo lại metadata");
    },
    onError,
  });

  if (metadata.isPending || timeline.isPending) return <Spinner label="Đang tải thông tin đăng tải" />;
  if (metadata.isError) return <ErrorState message={metadata.error.message} onRetry={() => void metadata.refetch()} />;
  if (!timeline.data?.timeline) {
    return (
      <section className="panel metadata-panel" aria-label="Thông tin đăng tải">
        <p className="eyebrow">THÔNG TIN ĐĂNG TẢI</p>
        <h2>Thông tin đăng tải</h2>
        <p>Cần timeline trước khi tạo tiêu đề, mô tả và thẻ.</p>
      </section>
    );
  }

  const stale = metadata.data.stale;
  const source = metadata.data.metadata?.source;

  async function regenerate() {
    setError("");
    setNotice("");
    const hasEdits = Boolean(metadata.data?.metadata?.edited);
    if (hasEdits && !window.confirm("Bạn đã sửa metadata. Tạo lại sẽ xóa bản sửa — tiếp tục?")) return;
    generate.mutate(hasEdits);
  }

  function updateForm(patch: Partial<VideoMetadataDraft>) {
    if (!form) return;
    setForm({ ...form, ...patch });
  }

  return (
    <section className="panel metadata-panel" aria-label="Thông tin đăng tải">
      <div className="metadata-header">
        <div>
          <p className="eyebrow">THÔNG TIN ĐĂNG TẢI</p>
          <h2>Thông tin đăng tải</h2>
          <p>
            {source ? `Nguồn: ${source === "LLM" ? "AI" : "code"}` : "Chưa tạo"}
            {stale ? " · Đã cũ so với timeline — Tạo lại" : ""}
          </p>
        </div>
        <div className="metadata-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={generate.isPending}
            onClick={() => void regenerate()}
          >
            Tạo lại
          </button>
          {form && (
            <button
              className="button button-primary"
              type="button"
              disabled={save.isPending}
              onClick={() => {
                setError("");
                setNotice("");
                save.mutate(form);
              }}
            >
              Lưu
            </button>
          )}
        </div>
      </div>

      {error && <p className="request-error" role="alert">{error}</p>}
      {notice && <p className="metadata-notice" role="status">{notice}</p>}

      {!form ? (
        <p>Chưa có metadata. Bấm Tạo lại sau khi timeline xong, hoặc chạy lại bước Timeline.</p>
      ) : (
        <>
          <fieldset className="metadata-titles">
            <legend>Tiêu đề</legend>
            {(form.titles.length ? form.titles : [""]).map((title, index) => (
              <label key={`title-${index}`} className="metadata-title-option">
                <input
                  type="radio"
                  name="metadata-title"
                  checked={(form.titles[0] ?? "") === title}
                  onChange={() => {
                    const rest = form.titles.filter((item) => item !== title);
                    updateForm({ titles: [title, ...rest].slice(0, 3) });
                  }}
                />
                <input
                  aria-label={`Tiêu đề ${index + 1}`}
                  value={title}
                  maxLength={100}
                  onChange={(event) => {
                    const titles = [...form.titles];
                    titles[index] = event.target.value;
                    updateForm({ titles });
                  }}
                />
              </label>
            ))}
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void copyText("tiêu đề", form.titles[0] ?? "").then(setNotice).catch(onError)}
            >
              Sao chép tiêu đề
            </button>
          </fieldset>

          <label className="metadata-description">
            Mô tả
            <textarea
              aria-label="Mô tả"
              rows={6}
              maxLength={1500}
              value={form.description}
              onChange={(event) => updateForm({ description: event.target.value })}
            />
          </label>

          <div className="metadata-extras">
            <label>
              <input type="checkbox" checked={includeChapters} onChange={(event) => setIncludeChapters(event.target.checked)} />
              Gồm chapters
            </label>
            <label>
              <input type="checkbox" checked={includeCredits} onChange={(event) => setIncludeCredits(event.target.checked)} />
              Gồm credits
            </label>
            <label>
              <input type="checkbox" checked={includeDisclosure} onChange={(event) => setIncludeDisclosure(event.target.checked)} />
              Gồm dòng AI disclosure
            </label>
            <pre className="metadata-readonly" aria-label="Phần mô tả bổ sung (chỉ đọc)">
              {[
                includeChapters && extras.chaptersText ? extras.chaptersText : "",
                includeCredits && extras.creditsText ? extras.creditsText : "",
                includeDisclosure ? extras.disclosure : "",
              ].filter(Boolean).join("\n\n") || "(không có phần bổ sung)"}
            </pre>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void copyText("mô tả", composed).then(setNotice).catch(onError)}
            >
              Sao chép mô tả
            </button>
          </div>

          <div className="metadata-chips">
            <div>
              <h3>Tags</h3>
              <div className="chip-row">
                {form.tags.map((tag) => (
                  <span key={tag} className="chip">{tag}</span>
                ))}
              </div>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void copyText("tags", form.tags.join(", ")).then(setNotice).catch(onError)}
              >
                Sao chép tags
              </button>
            </div>
            <div>
              <h3>Hashtags</h3>
              <div className="chip-row">
                {form.hashtags.map((tag) => (
                  <span key={tag} className="chip">{tag}</span>
                ))}
              </div>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void copyText("hashtags", form.hashtags.join(" ")).then(setNotice).catch(onError)}
              >
                Sao chép hashtags
              </button>
            </div>
          </div>

          {form.thumbnailText.length > 0 && (
            <div className="metadata-thumbs-text">
              <h3>Gợi ý chữ thumbnail</h3>
              <ul>{form.thumbnailText.map((text) => <li key={text}>{text}</li>)}</ul>
            </div>
          )}

          <button
            className="button button-primary"
            type="button"
            onClick={() => {
              const all = [
                form.titles[0] ?? "",
                "",
                composed,
                "",
                form.tags.join(", "),
                form.hashtags.join(" "),
              ].join("\n").trim();
              void copyText("toàn bộ", all).then(setNotice).catch(onError);
            }}
          >
            Sao chép tất cả
          </button>
        </>
      )}
    </section>
  );
}
