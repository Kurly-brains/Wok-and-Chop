"use client";

import { useEffect, useRef } from "react";
import type { AnimationItem } from "lottie-web";

export default function DeliveryScooter() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animation: AnimationItem | undefined;
    let active = true;

    function syncMotion() {
      if (motion.matches) animation?.goToAndStop(0, true);
      else animation?.play();
    }

    void import("lottie-web/build/player/lottie_light").then(({ default: lottie }) => {
      if (!active) return;
      animation = lottie.loadAnimation({
        container,
        path: "/animations/delivery-scooter.json",
        renderer: "svg",
        autoplay: !motion.matches,
        loop: true,
        rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
      });
      motion.addEventListener("change", syncMotion);
    }).catch(() => {
      // A decorative animation can fail without interrupting checkout or tracking.
    });

    return () => {
      active = false;
      motion.removeEventListener("change", syncMotion);
      animation?.destroy();
    };
  }, []);

  return <div className="delivery-masthead-motion" ref={ref} />;
}
