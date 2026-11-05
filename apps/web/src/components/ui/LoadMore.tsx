import { Button } from "./Button";

export function LoadMore({
  shown,
  total,
  onMore,
}: {
  shown: number;
  total: number;
  onMore: () => void;
}) {
  if (shown >= total) return null;
  return (
    <div className="ui-load-more">
      <Button variant="secondary" onClick={onMore}>Tải thêm ({shown}/{total})</Button>
    </div>
  );
}
