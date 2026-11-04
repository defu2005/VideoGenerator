import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { ProjectDetailPage } from "./features/projects/ProjectDetailPage";
import { ProjectListPage } from "./features/projects/ProjectListPage";
import { AiSettingsPage } from "./features/settings/AiSettingsPage";
import { RenderSettingsPage } from "./features/settings/RenderSettingsPage";
import { WebImageSettingsPage } from "./features/settings/WebImageSettingsPage";
import { ImageSourcesSettingsPage } from "./features/settings/ImageSourcesSettingsPage";
import { NotificationsPage } from "./features/settings/NotificationsPage";
import { GuidelineSettingsPage } from "./features/guidelines/GuidelineSettingsPage";
import { ProfileDetailPage } from "./features/profiles/ProfileDetailPage";
import { ProfileListPage } from "./features/profiles/ProfileListPage";
import { PublishCalendarPage } from "./features/publish/PublishCalendarPage";
import { UsagePage } from "./features/usage/UsagePage";
import { queryRetryDelay, shouldRetryQuery } from "./services/queryRetry";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: shouldRetryQuery, retryDelay: queryRetryDelay },
  },
});

function NotFoundPage() {
  return <section className="state-card"><h1>Page not found</h1><Link to="/">Return to dashboard</Link></section>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="projects" element={<ProjectListPage />} />
            <Route path="profiles" element={<ProfileListPage />} />
            <Route path="profiles/:id" element={<Navigate replace to="direction" />} />
            <Route path="profiles/:id/:tab" element={<ProfileDetailPage />} />
            <Route path="publish/calendar" element={<PublishCalendarPage />} />
            <Route path="settings/ai" element={<AiSettingsPage />} />
            <Route path="settings/render" element={<RenderSettingsPage />} />
            <Route path="settings/image-sources" element={<ImageSourcesSettingsPage />} />
            <Route path="settings/web-image" element={<WebImageSettingsPage />} />
            <Route path="settings/notifications" element={<NotificationsPage />} />
            <Route path="settings/guidelines" element={<GuidelineSettingsPage />} />
            <Route path="usage" element={<UsagePage />} />
            <Route path="projects/:id" element={<Navigate replace to="overview" />} />
            <Route path="projects/:id/:tab" element={<ProjectDetailPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
