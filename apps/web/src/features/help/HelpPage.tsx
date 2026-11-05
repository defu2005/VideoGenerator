import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { apiRequest } from "../../services/apiClient";
import { MarkdownView } from "./markdown";

type HelpDocument = { page: string; markdown: string };
type HelpHit = { page: string; anchor: string; title: string; text: string; href: string };
type HelpSearch = { query: string; sections: HelpHit[] };

export function HelpPage() {
  const { page = "README" } = useParams();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const doc = useQuery({
    queryKey: ["help", page],
    queryFn: () => apiRequest<HelpDocument>(`/help/${encodeURIComponent(page)}`),
  });
  const search = useQuery({
    queryKey: ["help-search", trimmed],
    queryFn: () => apiRequest<HelpSearch>(`/help/search?q=${encodeURIComponent(trimmed)}`),
    enabled: trimmed.length >= 2,
  });

  useEffect(() => {
    const id = location.hash.replace(/^#/, "");
    if (!id || !doc.data) return;
    document.getElementById(id)?.scrollIntoView();
  }, [location.hash, doc.data, page]);

  return (
    <div className="page-stack help-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">TRỢ GIÚP</p>
          <h1>Hướng dẫn</h1>
          <p className="page-subtitle">Tài liệu tiếng Việt của ứng dụng. Dấu ? trên mỗi trang mở đúng mục.</p>
        </div>
      </header>
      <label className="help-search">
        Tìm trong hướng dẫn
        <input
          aria-label="Tìm trong hướng dẫn"
          value={query}
          placeholder="ví dụ: quota, Telegram, render"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {trimmed.length >= 2 && (
        <section className="panel" aria-label="Kết quả tìm">
          {search.isPending && <Spinner label="Đang tìm" />}
          {search.isError && <p className="request-error" role="alert">Không tìm được.</p>}
          {search.data && search.data.sections.length === 0 && <p>Không thấy mục nào.</p>}
          {search.data && search.data.sections.length > 0 && (
            <ul className="help-results">
              {search.data.sections.map((section) => (
                <li key={section.href}>
                  <Link to={section.href}>{section.title}</Link>
                  <p>{section.text.slice(0, 280)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {doc.isPending && <Spinner label="Đang tải hướng dẫn" />}
      {doc.isError && (
        <ErrorState
          message={doc.error instanceof Error ? doc.error.message : "Không tải được hướng dẫn"}
          onRetry={() => void doc.refetch()}
        />
      )}
      {doc.data && <MarkdownView source={doc.data.markdown} />}
    </div>
  );
}
