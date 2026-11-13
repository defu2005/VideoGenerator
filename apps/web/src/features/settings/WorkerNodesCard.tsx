import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listNodes } from "../nodes/nodesApi";

/** Slim pointer; the full management UI lives on the Máy page (/nodes). */
export function WorkerNodesCard() {
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: listNodes, refetchInterval: 30_000 });
  const online = Array.isArray(nodes.data?.nodes) ? nodes.data.nodes.filter((node) => node.status === "online").length : 0;
  return (
    <section className="panel" id="may-worker" aria-label="Máy worker">
      <h2>Máy worker</h2>
      <p>
        Máy worker: {online} đang chạy — <Link to="/nodes">Mở trang Máy</Link>
      </p>
    </section>
  );
}
