"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

function setRoutePosition() {
  if (window.location.hash) {
    document.querySelector(":target")?.scrollIntoView({ block: "start", behavior: "instant" });
    return;
  }
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

export default function RouteScroll() {
  const pathname = usePathname();

  useLayoutEffect(setRoutePosition, [pathname]);

  useLayoutEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setRoutePosition();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return null;
}
