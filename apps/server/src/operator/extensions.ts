/**
 * Arrays other modules extend. TASK-046 registers provider-research duties
 * and seeded standing orders without changing the operator runtime.
 */
export type OperatorDuty = {
  id: string;
  titleVi: string;
  bodyVi: string;
};

export type SeededStandingOrder = {
  id: string;
  title: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  moduleId: string;
};

export const operatorDuties: OperatorDuty[] = [
  {
    id: "operate-app",
    titleVi: "Vận hành ứng dụng",
    bodyVi: "Đọc notes trước. Lập kế hoạch ngắn. Gọi công cụ. Kiểm tra lại bằng công cụ đọc. Trả lời tiếng Việt: đã làm gì, việc nào đang chờ duyệt, bước tiếp theo.",
  },
];

export const seededStandingOrders: SeededStandingOrder[] = [];

export function registerOperatorDuty(duty: OperatorDuty): void {
  if (operatorDuties.some((item) => item.id === duty.id)) return;
  operatorDuties.push(duty);
}

export function registerSeededStandingOrder(order: SeededStandingOrder): void {
  if (seededStandingOrders.some((item) => item.id === order.id)) return;
  seededStandingOrders.push(order);
}
