import { useState } from "react";
import { Badge, Chip } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { KpiCard } from "../../components/ui/KpiCard";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { Table } from "../../components/ui/Table";
import { Tabs } from "../../components/ui/Tabs";
import { Toggle } from "../../components/ui/Toggle";
import { Tooltip } from "../../components/ui/Tooltip";
import { useToast } from "../../components/ui/Toast";

const ROWS = [
  { id: "1", name: "Video A", status: "Xong" },
  { id: "2", name: "Video B", status: "Lỗi" },
];

export function UiGalleryPage() {
  const toast = useToast();
  const [tab, setTab] = useState("one");
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("eco");
  const [on, setOn] = useState(true);
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="DEV"
        title="Thư viện giao diện"
        description="Các component dùng chung. Trang này không có trên thanh điều hướng."
        actions={<Button onClick={() => toast.success("Đã lưu ví dụ")}>Hiện toast</Button>}
      />
      <Card title="Nút">
        <div className="ui-gallery-row">
          <Button>Chính</Button>
          <Button variant="secondary">Phụ</Button>
          <Button variant="ghost">Mờ</Button>
          <Button variant="danger">Nguy hiểm</Button>
          <Button size="sm">Nhỏ</Button>
          <Button size="lg">Lớn</Button>
          <Button loading>Đang lưu</Button>
        </div>
      </Card>
      <Card title="Chỉ số">
        <div className="stats-grid">
          <KpiCard label="Doanh thu" value="$12.50" hint="USD" />
          <KpiCard label="Quota" value="40%" />
        </div>
        <ProgressBar value={40} label="Quota đã dùng" />
        <ProgressBar value={92} max={100} tone="near" label="Sắp hết" />
        <ProgressBar value={100} tone="out" label="Hết" />
      </Card>
      <Card title="Trạng thái">
        <div className="ui-gallery-row">
          <Badge tone="success">Xong</Badge>
          <Badge tone="warning">Chờ</Badge>
          <Badge tone="danger">Lỗi</Badge>
          <Badge tone="info">Đang chạy</Badge>
          <Chip>nháp</Chip>
        </div>
      </Card>
      <Tabs
        label="Ví dụ thẻ"
        value={tab}
        onChange={setTab}
        tabs={[{ id: "one", label: "Một" }, { id: "two", label: "Hai" }]}
      />
      <Card title="Biểu mẫu">
        <Field label="Tên" hint="Tên hiển thị" error="Không được để trống">
          {(props) => <input {...props} defaultValue="" />}
        </Field>
        <Select
          label="Chế độ"
          value={choice}
          onChange={setChoice}
          options={[{ value: "eco", label: "Tiết kiệm" }, { value: "quality", label: "Chất lượng" }]}
        />
        <Toggle label="Bật tự động" checked={on} onChange={setOn} />
      </Card>
      <Table
        rows={ROWS}
        columns={[
          { key: "name", header: "Tên", cell: (row) => row.name },
          { key: "status", header: "Trạng thái", cell: (row) => row.status },
        ]}
      />
      <Table rows={[]} columns={[{ key: "name", header: "Tên", cell: (row: { id: string }) => row.id }]} />
      <Skeleton lines={2} />
      <Tooltip label="05/11/2026 15:04"><span>3 phút trước</span></Tooltip>
      <Button variant="secondary" onClick={() => setOpen(true)}>Mở hộp thoại</Button>
      <Modal open={open} title="Hộp thoại ví dụ" onClose={() => setOpen(false)}>
        <p>Nhấn Esc để đóng.</p>
        <Button onClick={() => setOpen(false)}>Đóng</Button>
      </Modal>
    </div>
  );
}
