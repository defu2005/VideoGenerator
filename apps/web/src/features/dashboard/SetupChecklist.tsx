import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { getConnectionsOverview, setSetupHidden } from "../../services/connectionsApi";

/** First-run checklist. Hidden once everything is done or the user hides it. */
export function SetupChecklist() {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["connections", "overview"], queryFn: getConnectionsOverview });
  const hide = useMutation({
    mutationFn: () => setSetupHidden(true),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["connections"] }),
  });

  const setup = overview.data?.setup;
  if (!setup || !Array.isArray(setup.items) || setup.hidden || setup.complete) return null;
  const done = setup.items.filter((item) => item.done).length;

  return (
    <Card
      title="Thiết lập ban đầu"
      actions={<Button size="sm" variant="ghost" loading={hide.isPending} onClick={() => hide.mutate()}>Ẩn</Button>}
    >
      <p className="page-subtitle">Xong {done}/{setup.items.length} bước. Mọi thứ đều nhập được trong app, không cần sửa file.</p>
      <ul className="setup-checklist">
        {setup.items.map((item) => (
          <li key={item.id}>
            <Badge tone={item.done ? "success" : "warning"}>{item.done ? "Xong" : "Chưa"}</Badge>
            <Link to={item.href}>{item.label}</Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
