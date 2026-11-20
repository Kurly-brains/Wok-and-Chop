"use client";

import { useId, useState, type ReactNode } from "react";
import "../styles/sliding-disclosure.css";

export default function SlidingDisclosure({
  className,
  triggerClassName,
  trigger,
  children,
}: {
  className?: string;
  triggerClassName: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div className={className}>
      <button
        type="button"
        className={triggerClassName}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(current => !current)}
      >
        {trigger}
      </button>
      <div id={panelId} className="wc-slide-panel" data-open={open} aria-hidden={!open} inert={!open}>
        <div className="wc-slide-panel-content">{children}</div>
      </div>
    </div>
  );
}
