"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from "react";
import "../styles/food-stories.css";

const stories = [
  {
    title: "The first sizzle.",
    chapter: "Fire & flavour",
    inscription: "鑊氣",
    image: "/images/chicken-cutout.webp",
    text: "A hot wok. A quick toss. That first rush of aroma. Some food stories begin in the kitchen, long before the first bite reaches the table.",
    note: "A little fire brings the story to life.",
  },
  {
    title: "One more strand.",
    chapter: "Noodles & conversation",
    inscription: "家常",
    image: "/images/noodles-cutout.webp",
    text: "Lift a few noodles, pass a plate, pick up the conversation. There is a lovely rhythm to a meal that gives everyone a reason to stay a little longer.",
    note: "Good company makes a generous helping.",
  },
  {
    title: "That little crunch.",
    chapter: "Texture & contrast",
    inscription: "功夫",
    image: "/images/spring-rolls-cutout.webp",
    text: "The crisp first bite. A soft centre. A little dip on the side. Sometimes the smallest things on the table are the ones everyone reaches for.",
    note: "Small bites. Plenty to talk about.",
  },
  {
    title: "Room for everyone.",
    chapter: "Around the table",
    inscription: "入席",
    image: "/images/lunch-veg-manchurian.webp",
    text: "Something warm in the middle of the table, a few plates passed from hand to hand, and no hurry to leave. That is the kind of food story we love.",
    note: "The best part is sharing it.",
  },
];
const COPY_COUNT = 7;
const MIDDLE_COPY = Math.floor(COPY_COUNT / 2);
const slides = Array.from({ length: COPY_COUNT }, (_, copy) =>
  stories.map((story, index) => ({ story, index, copy })),
).flat();
const cyclePosition = (left: number, width: number) =>
  ((left % width) + width) % width;

function subscribe(callback: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const motionSnapshot = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function FoodStories() {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    left: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const cycleWidth = useRef(0);
  const cyclePhase = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [canMove, setCanMove] = useState(true);
  const reducedMotion = useSyncExternalStore(
    subscribe,
    motionSnapshot,
    () => true,
  );
  const normalizeScroll = useCallback((proposed?: number, force = false) => {
    const element = track.current;
    const width = cycleWidth.current;
    if (!element || !width) return element?.scrollLeft ?? 0;
    const left = proposed ?? element.scrollLeft;
    const max = element.scrollWidth - element.clientWidth;
    // Keep a generous runway for native touch momentum. Reposition only by
    // complete, visually identical cycles, never to a card boundary.
    const needsWrap = force || left < width / 2 || left > max - width / 2;
    const next = needsWrap
      ? width * MIDDLE_COPY + cyclePosition(left, width)
      : left;
    if (drag.current) drag.current.left += next - left;
    if (Math.abs(element.scrollLeft - next) > 0.1) element.scrollLeft = next;
    cyclePhase.current = cyclePosition(next, width) / width;
    return next;
  }, []);
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const measure = () => {
      const first = element.children[0];
      const nextCycle = element.children[stories.length];
      if (!first || !nextCycle) return;
      const width =
        nextCycle.getBoundingClientRect().left -
        first.getBoundingClientRect().left;
      if (width <= 0) return;
      if (Math.abs(width - cycleWidth.current) > 0.1) {
        cycleWidth.current = width;
        const next = width * (MIDDLE_COPY + cyclePhase.current);
        if (drag.current) drag.current.left += next - element.scrollLeft;
        element.scrollLeft = next;
      }
      setCanMove(width > element.clientWidth + 1);
    };
    const settle = () => {
      // Native inertia finishes before returning to the middle copy.
      if (!drag.current) normalizeScroll(undefined, true);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener("scrollend", settle);
    return () => {
      observer.disconnect();
      element.removeEventListener("scrollend", settle);
    };
  }, [normalizeScroll]);
  function stepSize() {
    const element = track.current;
    return element
      ? (element.firstElementChild?.getBoundingClientRect().width ?? 0) +
          parseFloat(getComputedStyle(element).columnGap || "0")
      : 0;
  }
  function moveTo(left: number, smooth = true) {
    const element = track.current;
    if (!element) return;
    element.scrollTo({
      left: Math.max(
        0,
        Math.min(left, element.scrollWidth - element.clientWidth),
      ),
      behavior: smooth && !reducedMotion ? "smooth" : "auto",
    });
  }
  function step(direction: number) {
    const left = normalizeScroll(undefined, true);
    moveTo(left + direction * stepSize());
  }
  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    suppressClick.current = drag.current.moved;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    normalizeScroll(undefined, true);
  }
  return (
    <section
      className="food-stories"
      aria-labelledby="food-stories-title"
      aria-roledescription="carousel"
    >
      <div className="food-stories-heading">
        <p className="handwritten">Chinese food. A little closer.</p>
        <h2 id="food-stories-title">
          More than a dish.
          <br />
          <strong>A story to share.</strong>
        </h2>
        <p>
          The sizzle, the crunch, the conversation.
          <br />A few of the things that make a table feel full.
        </p>
      </div>
      <div
        className={`food-story-track${dragging ? " is-dragging" : ""}`}
        ref={track}
        tabIndex={0}
        role="group"
        aria-label="Four food stories in a continuous loop. Drag or swipe to explore, or use the arrow keys."
        onScroll={() => normalizeScroll()}
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse" || event.button !== 0) return;
          if (
            event.target instanceof Element &&
            event.target.closest(
              "button, input, select, textarea, [contenteditable='true']",
            )
          )
            return;
          suppressClick.current = false;
          // Stop any arrow animation at its actual position before dragging.
          moveTo(normalizeScroll(undefined, true), false);
          drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            left: event.currentTarget.scrollLeft,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || active.pointerId !== event.pointerId) return;
          const distance = event.clientX - active.x;
          if (!active.moved && Math.abs(distance) < 4) return;
          if (!active.moved) {
            active.moved = true;
            setDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          event.preventDefault();
          normalizeScroll(active.left - distance);
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onPointerLeave={(event) => {
          if (drag.current && !drag.current.moved) finishDrag(event);
        }}
        onDragStart={(event) => event.preventDefault()}
        onClickCapture={(event) => {
          if (suppressClick.current && event.detail > 0) {
            suppressClick.current = false;
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowRight") {
            event.preventDefault();
            step(1);
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            step(-1);
          }
          if (event.key === "Home") {
            event.preventDefault();
            moveTo(cycleWidth.current * MIDDLE_COPY);
          }
          if (event.key === "End") {
            event.preventDefault();
            moveTo(
              cycleWidth.current * MIDDLE_COPY +
                (stories.length - 1) * stepSize(),
            );
          }
        }}
      >
        {slides.map(({ story, index, copy }) => (
          <article
            className={`food-story-card story-tone-${index % 2}`}
            key={`${copy}-${story.title}`}
            aria-label={`Story ${index + 1} of ${stories.length}`}
            aria-hidden={copy !== MIDDLE_COPY ? true : undefined}
          >
            <div className="food-story-art">
              <img
                src={story.image}
                alt=""
                aria-hidden="true"
                width="900"
                height="900"
                loading="lazy"
                draggable={false}
              />
            </div>
            <div className="food-story-panel">
              <div className="food-story-chapter">
                <span>{story.chapter}</span>
                <span
                  className="food-story-inscription"
                  lang="zh-Hant"
                  aria-hidden="true"
                >
                  {story.inscription}
                </span>
              </div>
              <h3>{story.title}</h3>
              <p className="food-story-description">{story.text}</p>
              <p className="food-story-note">{story.note}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="food-stories-controls">
        <div className="food-stories-direction">
          <span aria-hidden="true">↔</span>
          <span>Drag to discover</span>
        </div>
        <div className="food-stories-arrows">
          <button
            aria-label="Previous food story"
            onClick={() => step(-1)}
            disabled={!canMove}
          >
            ←
          </button>
          <button
            aria-label="Next food story"
            onClick={() => step(1)}
            disabled={!canMove}
          >
            →
          </button>
        </div>
      </div>
      <Link className="food-stories-about" href="/our-story/">
        The story of Wok & Chop <span aria-hidden="true">↗</span>
      </Link>
    </section>
  );
}
