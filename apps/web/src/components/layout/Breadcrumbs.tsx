import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { getProfile } from "../../services/profilesApi";
import { getProject } from "../../services/projectsApi";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PROFILE_TABS: Record<string, string> = {
  direction: "Định hướng",
  autonomy: "Tự vận hành",
  brief: "Brief mặc định",
  topics: "Chủ đề",
  automation: "Tự động hoá",
  insights: "Bài học",
  accounts: "Tài khoản",
  comments: "Bình luận",
  projects: "Dự án",
};

const PROJECT_TABS: Record<string, string> = {
  overview: "Tổng quan",
  script: "Kịch bản",
  scenes: "Phân cảnh",
  visuals: "Hình ảnh",
  voice: "Giọng đọc",
  subtitles: "Phụ đề",
  music: "Nhạc",
  timeline: "Timeline",
  render: "Render",
  usage: "Mức dùng",
};

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const profileMatch = pathname.match(/^\/profiles\/([^/]+)(?:\/([^/]+))?/);
  const projectMatch = pathname.match(/^\/projects\/([^/]+)(?:\/([^/]+))?/);
  const profileId = profileMatch?.[1] && UUID.test(profileMatch[1]) ? profileMatch[1] : "";
  const projectId = projectMatch?.[1] && UUID.test(projectMatch[1]) ? projectMatch[1] : "";
  const profile = useQuery({
    queryKey: ["profile", profileId],
    queryFn: () => getProfile(profileId),
    enabled: Boolean(profileId),
  });
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
    enabled: Boolean(projectId),
  });

  if (profileId) {
    const tab = profileMatch?.[2] ? PROFILE_TABS[profileMatch[2]] ?? profileMatch[2] : "";
    return (
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <ol>
          <li><Link to="/profiles">Hồ sơ</Link></li>
          <li>{profile.data?.name ?? "…"}</li>
          {tab ? <li>{tab}</li> : null}
        </ol>
      </nav>
    );
  }
  if (projectId) {
    const tab = projectMatch?.[2] ? PROJECT_TABS[projectMatch[2]] ?? projectMatch[2] : "";
    return (
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <ol>
          <li><Link to="/projects">Dự án</Link></li>
          <li>{project.data?.title ?? "…"}</li>
          {tab ? <li>{tab}</li> : null}
        </ol>
      </nav>
    );
  }
  return null;
}
