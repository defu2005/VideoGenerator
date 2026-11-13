import { registerOperatorDuty, registerSeededStandingOrder } from "../operator/extensions.js";

let registered = false;

export function registerProviderIntelExtensions(): void {
  if (registered) return;
  registered = true;
  registerOperatorDuty({
    id: "provider-research",
    titleVi: "Nghiên cứu nhà cung cấp",
    bodyVi: "Chỉ lấy trang chính thức. Chỉ ghi nhận định khi câu trích nằm nguyên trong trang. Không đoán. Chỗ chưa có nguồn thì ghi UNKNOWN. Được đề xuất định tuyến nhưng không tự áp dụng.",
  });
  registerSeededStandingOrder({
    id: "intel-full-research",
    title: "Nghiên cứu toàn bộ provider hiện có",
    prompt: "Lấy intel_next_research_batch và nghiên cứu từng nhà cung cấp bằng trang chính thức. Không áp dụng định tuyến.",
    cron: "0 0 31 2 *",
    enabled: true,
    moduleId: "provider-intel",
  });
  registerSeededStandingOrder({
    id: "intel-weekly-discover",
    title: "Tìm nhà cung cấp mới",
    prompt: "Đọc nguồn đã lưu và thêm stub needs_research cho tên mới. Không áp dụng định tuyến.",
    cron: "0 9 * * 1",
    enabled: false,
    moduleId: "provider-intel",
  });
  registerSeededStandingOrder({
    id: "intel-weekly-refresh",
    title: "Nghiên cứu lại dữ liệu cũ",
    prompt: "Nghiên cứu lại nhà cung cấp needs_research hoặc dữ liệu cũ hơn 30 ngày.",
    cron: "5 9 * * 1",
    enabled: false,
    moduleId: "provider-intel",
  });
  registerSeededStandingOrder({
    id: "intel-weekly-report",
    title: "Báo cáo tuần nhà cung cấp",
    prompt: "Viết báo cáo tuần bằng intel_write_report.",
    cron: "10 9 * * 1",
    enabled: false,
    moduleId: "provider-intel",
  });
  registerSeededStandingOrder({
    id: "intel-monthly-policy",
    title: "Rà điều khoản và thanh toán",
    prompt: "Xem lại điều khoản, quyền riêng tư và thanh toán ở những mục needsReview.",
    cron: "0 9 1 * *",
    enabled: false,
    moduleId: "provider-intel",
  });
}
