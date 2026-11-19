"use client";

import { useState } from "react";
import { renderDeliverySlip, type DeliverySlipAudience, type DeliverySlipOrder } from "../../../../packages/printing/src/index";
import "../../styles/printer-station.css";

/** Only mount inside the authenticated manager delivery detail. */
export function DeliverySlipTools({ order }: { order: DeliverySlipOrder }) {
  const [audience, setAudience] = useState<DeliverySlipAudience>("kitchen");
  const [open, setOpen] = useState(false);
  const slip = open ? renderDeliverySlip(order, audience) : "";

  function save() {
    const href = URL.createObjectURL(new Blob([slip + "\n"], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = order.number.replace(/[^a-zA-Z0-9-]/g, "") + "-" + audience + ".txt";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 2000);
  }

  return <div className="ops-delivery-slips">
    <button className="ops-text-button" type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? "Close delivery slips" : "View delivery slips"}
    </button>
    {open && <div>
      <div role="group" aria-label="Slip audience" className="ops-slip-switch">
        <button type="button" aria-pressed={audience === "kitchen"} onClick={() => setAudience("kitchen")}>Kitchen copy</button>
        <button type="button" aria-pressed={audience === "driver"} onClick={() => setAudience("driver")}>Driver copy</button>
      </div>
      <pre>{slip}</pre>
      <button type="button" className="ops-button ops-button-outline" onClick={save}>Save {audience} slip (.txt)</button>
    </div>}
  </div>;
}
