import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getProfiles } from "../../services/profilesApi";
import { getProjects } from "../../services/projectsApi";
import { Modal } from "../ui/Modal";
import { NAV_ITEMS } from "./nav";

const EXTRA_PAGES = [{ to: "/nodes", label: "Máy worker" }];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const projects = useQuery({
    queryKey: ["projects", "command-palette"],
    queryFn: () => getProjects({
      includeArchived: false,
      archivedOnly: false,
      sort: "updatedAt",
      order: "desc",
      page: 1,
      pageSize: 20,
    }),
    enabled: open,
  });
  const profiles = useQuery({
    queryKey: ["profiles", "command-palette"],
    queryFn: () => getProfiles({ includeArchived: false }),
    enabled: open,
  });

  const needle = query.trim().toLowerCase();
  const pages = useMemo(
    () => [...NAV_ITEMS, ...EXTRA_PAGES].filter((item) => !needle || item.label.toLowerCase().includes(needle)),
    [needle],
  );
  const profileHits = (profiles.data?.items ?? [])
    .filter((profile) => !needle || "tri thức".includes(needle) || profile.name.toLowerCase().includes(needle))
    .slice(0, 8);
  const projectHits = (projects.data?.items ?? [])
    .filter((project) => !needle || project.title.toLowerCase().includes(needle) || project.topic.toLowerCase().includes(needle))
    .slice(0, 8);
  const empty = pages.length === 0 && profileHits.length === 0 && projectHits.length === 0;

  return (
    <Modal open={open} title="Chuyển nhanh" onClose={onClose}>
      <input
        className="command-input"
        aria-label="Tìm trang, hồ sơ hoặc dự án"
        placeholder="Tìm trang, hồ sơ, dự án"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {empty ? <p className="command-empty">Không thấy kết quả.</p> : null}
      {pages.length > 0 && (
        <section>
          <h3>Trang</h3>
          <ul className="command-list">
            {pages.map((page) => (
              <li key={page.to}>
                <Link to={page.to} onClick={onClose}>{page.label}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {profileHits.length > 0 && (
        <section>
          <h3>Hồ sơ</h3>
          <ul className="command-list">
            {profileHits.map((profile) => (
              <li key={profile.id}>
                <Link to={`/profiles/${profile.id}/direction`} onClick={onClose}>{profile.name}</Link> <Link to={`/profiles/${profile.id}/knowledge`} onClick={onClose}>Tri thức</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {projectHits.length > 0 && (
        <section>
          <h3>Dự án</h3>
          <ul className="command-list">
            {projectHits.map((project) => (
              <li key={project.id}>
                <Link to={`/projects/${project.id}/overview`} onClick={onClose}>{project.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  );
}
