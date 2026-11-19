import { nextTicketAction, type DemoOrder, type TrainingWorkspace } from "../../lib/demo-operations";

export function TicketAction({ order, workspace }: { order: DemoOrder; workspace: TrainingWorkspace }) {
  const action = nextTicketAction(order);
  if (!action) return null;
  return <>
    {action.type === "acknowledge" && order.jobs[0].status === "UNKNOWN" && <p className="ops-action-warning">Check for an existing paper ticket before accepting kitchen handling.</p>}
    <button type="button" className="ops-button" disabled={workspace.busy} onClick={() => void workspace.run({ type: action.type, orderId: order.id }, "Updated ticket #" + order.id + ".")}>{action.label} <span aria-hidden="true">→</span></button>
  </>;
}

export function WorkspaceStatus({ workspace }: { workspace: TrainingWorkspace }) {
  const labels = { checking: "Connecting to training board…", shared: "Shared training board · updates automatically", offline: "Connection interrupted · showing last shared board", local: "Browser-only training · separate from the shared board" };
  return <div className="ops-workspace-state">
    <span>{labels[workspace.connection]}{workspace.connection === "local" && workspace.memoryOnly && " · browser storage unavailable"}</span>
    {workspace.connection === "local" && <button type="button" className="ops-text-button" onClick={workspace.reconnect}>Connect to shared board</button>}
    <span role="status">{workspace.notice}</span>
    {workspace.uncertain && !workspace.busy && <button type="button" className="ops-text-button" onClick={() => void workspace.retry()}>Retry last action</button>}
  </div>;
}
