import { useState } from "react";
import { Button } from "./Button";

export function Table<T extends { id: string }>({
  columns,
  rows,
  pageSize = 10,
  emptyLabel = "Chưa có dữ liệu",
}: {
  columns: { key: string; header: string; cell: (row: T) => string }[];
  rows: T[];
  pageSize?: number;
  emptyLabel?: string;
}) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pages);
  const slice = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key} scope="col">{column.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {slice.length === 0 ? (
            <tr className="ui-table-empty">
              <td colSpan={columns.length}>{emptyLabel}</td>
            </tr>
          ) : slice.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => <td key={column.key}>{column.cell(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > pageSize && (
        <div className="ui-table-pager">
          <Button variant="secondary" size="sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Trước</Button>
          <span>Trang {safePage}/{pages}</span>
          <Button variant="secondary" size="sm" disabled={safePage >= pages} onClick={() => setPage(safePage + 1)}>Sau</Button>
        </div>
      )}
    </div>
  );
}
