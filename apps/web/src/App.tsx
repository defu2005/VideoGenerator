import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { ToastProvider } from "./components/ui/Toast";
import { queryRetryDelay, shouldRetryQuery } from "./services/queryRetry";

const DashboardPage = lazy(() => import("./features/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const AssistantPage = lazy(() => import("./features/assistant/AssistantPage").then((m) => ({ default: m.AssistantPage })));
const ProjectListPage = lazy(() => import("./features/projects/ProjectListPage").then((m) => ({ default: m.ProjectListPage })));
const ProjectDetailPage = lazy(() => import("./features/projects/ProjectDetailPage").then((m) => ({ default: m.ProjectDetailPage })));
const ProfileListPage = lazy(() => import("./features/profiles/ProfileListPage").then((m) => ({ default: m.ProfileListPage })));
const ProfileDetailPage = lazy(() => import("./features/profiles/ProfileDetailPage").then((m) => ({ default: m.ProfileDetailPage })));
const PublishCalendarPage = lazy(() => import("./features/publish/PublishCalendarPage").then((m) => ({ default: m.PublishCalendarPage })));
const AnalyticsPage = lazy(() => import("./features/analytics/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })));
const FinancePage = lazy(() => import("./features/finance/FinancePage").then((m) => ({ default: m.FinancePage })));
const CommentsPage = lazy(() => import("./features/comments/CommentsPage").then((m) => ({ default: m.CommentsPage })));
const AiSettingsPage = lazy(() => import("./features/settings/AiSettingsPage").then((m) => ({ default: m.AiSettingsPage })));
const RenderSettingsPage = lazy(() => import("./features/settings/RenderSettingsPage").then((m) => ({ default: m.RenderSettingsPage })));
const ImageSourcesSettingsPage = lazy(() => import("./features/settings/ImageSourcesSettingsPage").then((m) => ({ default: m.ImageSourcesSettingsPage })));
const WebImageSettingsPage = lazy(() => import("./features/settings/WebImageSettingsPage").then((m) => ({ default: m.WebImageSettingsPage })));
const NotificationsPage = lazy(() => import("./features/settings/NotificationsPage").then((m) => ({ default: m.NotificationsPage })));
const GuidelineSettingsPage = lazy(() => import("./features/guidelines/GuidelineSettingsPage").then((m) => ({ default: m.GuidelineSettingsPage })));
const UsagePage = lazy(() => import("./features/usage/UsagePage").then((m) => ({ default: m.UsagePage })));
const TtsSettingsPage = lazy(() => import("./features/settings/TtsSettingsPage").then((m) => ({ default: m.TtsSettingsPage })));
const HelpPage = lazy(() => import("./features/help/HelpPage").then((m) => ({ default: m.HelpPage })));
const UiGalleryPage = import.meta.env.DEV
  ? lazy(() => import("./features/dev/UiGalleryPage").then((m) => ({ default: m.UiGalleryPage })))
  : null;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: shouldRetryQuery,
      retryDelay: queryRetryDelay,
    },
  },
});

function NotFoundPage() {
  return <section className="state-card"><h1>Không tìm thấy trang</h1><Link to="/">Về bảng điều khiển</Link></section>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="assistant" element={<AssistantPage />} />
              <Route path="projects" element={<ProjectListPage />} />
              <Route path="profiles" element={<ProfileListPage />} />
              <Route path="profiles/:id" element={<Navigate replace to="direction" />} />
              <Route path="profiles/:id/:tab" element={<ProfileDetailPage />} />
              <Route path="publish/calendar" element={<PublishCalendarPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="finance" element={<FinancePage />} />
              <Route path="comments" element={<CommentsPage />} />
              <Route path="settings/ai" element={<AiSettingsPage />} />
              <Route path="settings/render" element={<RenderSettingsPage />} />
              <Route path="settings/image-sources" element={<ImageSourcesSettingsPage />} />
              <Route path="settings/web-image" element={<WebImageSettingsPage />} />
              <Route path="settings/tts" element={<TtsSettingsPage />} />
              <Route path="settings/notifications" element={<NotificationsPage />} />
              <Route path="settings/guidelines" element={<GuidelineSettingsPage />} />
              <Route path="usage" element={<UsagePage />} />
              <Route path="help" element={<HelpPage />} />
              <Route path="help/:page" element={<HelpPage />} />
              {UiGalleryPage ? <Route path="dev/ui" element={<UiGalleryPage />} /> : null}
              <Route path="projects/:id" element={<Navigate replace to="overview" />} />
              <Route path="projects/:id/:tab" element={<ProjectDetailPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
