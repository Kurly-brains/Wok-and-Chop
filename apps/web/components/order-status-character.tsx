import "../styles/order-status-character.css";

const phases = new Map([
  ["RECEIVED", "received"],
  ["ACCEPTED", "received"],
  ["SCHEDULED", "received"],
  ["PREPARING", "preparing"],
  ["IN_PREPARATION", "preparing"],
  ["READY_FOR_PICKUP", "ready"],
  ["READY", "ready"],
  ["OUT_FOR_DELIVERY", "on-the-way"],
  ["PICKED_UP", "complete"],
  ["DELIVERED", "complete"],
  ["COMPLETED", "complete"],
  ["CANCELLED", "cancelled"],
]);

export default function OrderStatusCharacter({ status }: { status: string }) {
  const phase = phases.get(status);
  if (!phase) return null;

  return (
    <span
      className="order-status-character"
      data-phase={phase}
      aria-hidden="true"
    >
      <span className="order-character-body">
        <span className="order-character-pleats" />
        <span className="order-character-eyes" />
        <span className="order-character-mouth" />
      </span>
      <span className="order-character-prop" />
    </span>
  );
}
