"use client";

import { useEffect, useRef, useState } from "react";
import {
  googleReviews,
  googleReviewListing,
  googleReviewSnapshot,
} from "../lib/guest-reviews";
import "../styles/guest-reviews.css";

function GuestPhoto({ src, alt }: { src: string; alt: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return (
    <figure className="guest-review-photo">
      {failedSource === src ? (
        <div className="guest-review-photo-fallback">
          <img
            className="guest-review-fallback-mark"
            src="/images/brand/wok-and-chop-favicon.png"
            alt=""
            aria-hidden="true"
            width="40"
            height="40"
          />
          <p>Guest photo unavailable</p>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          width="900"
          height="600"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSource(src)}
        />
      )}
    </figure>
  );
}

function GuestAvatar({ src, name }: { src?: string; name: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase();
  return (
    <span className="guest-review-avatar" aria-hidden="true">
      {src && failedSource !== src ? (
        <img
          src={src}
          alt=""
          width="40"
          height="40"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSource(src)}
        />
      ) : (
        initials
      )}
    </span>
  );
}

export default function GuestReviews() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({
    first: 0,
    last: Math.min(2, googleReviews.length - 1),
  });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const updateRange = () => {
      const secondCard = track.children.item(1);
      if (!(secondCard instanceof HTMLElement) || !secondCard.offsetLeft)
        return;
      const columns = Number(
        getComputedStyle(track).getPropertyValue("--visible-reviews"),
      );
      const visibleCount = Math.min(columns, googleReviews.length);
      const first = Math.max(
        0,
        Math.min(
          googleReviews.length - visibleCount,
          Math.round(track.scrollLeft / secondCard.offsetLeft),
        ),
      );
      const last = first + visibleCount - 1;
      setRange((current) =>
        current.first === first && current.last === last
          ? current
          : { first, last },
      );
    };

    const observer = new ResizeObserver(updateRange);
    observer.observe(track);
    track.addEventListener("scroll", updateRange, { passive: true });
    return () => {
      observer.disconnect();
      track.removeEventListener("scroll", updateRange);
    };
  }, []);

  function goTo(index: number) {
    const track = trackRef.current;
    const card = track?.children.item(index);
    if (track && card instanceof HTMLElement)
      track.scrollTo({ left: card.offsetLeft });
  }

  return (
    <section
      className="wc-guest-reviews"
      aria-labelledby="guest-reviews-title"
      aria-roledescription="carousel"
    >
      <div className="guest-reviews-heading">
        <div className="guest-reviews-title-group">
          <span className="guest-reviews-seal" aria-hidden="true">
            <img
              src="/images/brand/wok-and-chop-favicon.png"
              alt=""
              width="200"
              height="200"
            />
          </span>
          <div>
            <h2 id="guest-reviews-title">Guest reviews</h2>
          </div>
        </div>
        <div className="guest-reviews-tools">
          <div className="guest-reviews-snapshot">
            <p>
              <span aria-hidden="true">★</span>
              <strong>{googleReviewSnapshot.rating}</strong>
              <span>out of 5</span>
            </p>
            <p>
              {googleReviewSnapshot.count.toLocaleString()} reviews on Google
            </p>
          </div>
          <div
            className="guest-reviews-controls"
            role="group"
            aria-label="Review navigation"
          >
            <button
              type="button"
              aria-label="Previous review"
              aria-controls="guest-reviews-list"
              disabled={range.first === 0}
              onClick={() => goTo(range.first - 1)}
            >
              <span aria-hidden="true">←</span>
            </button>
            <button
              type="button"
              aria-label="Next review"
              aria-controls="guest-reviews-list"
              disabled={range.last === googleReviews.length - 1}
              onClick={() => goTo(range.first + 1)}
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </div>

      <div
        className="guest-reviews-track"
        id="guest-reviews-list"
        ref={trackRef}
        role="group"
        aria-label="Guest review cards"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const destinations: Record<string, number> = {
            ArrowLeft: range.first - 1,
            ArrowRight: range.first + 1,
            Home: 0,
            End: googleReviews.length - 1,
          };
          if (!(event.key in destinations)) return;
          event.preventDefault();
          goTo(destinations[event.key]);
        }}
      >
        {googleReviews.map((review, index) => (
          <article
            className="guest-review"
            key={review.url}
            aria-label={`Review ${index + 1} of ${googleReviews.length} by ${review.name}`}
          >
            <GuestPhoto src={review.photo} alt={review.photoAlt} />
            <div className="guest-review-author">
              <div className="guest-review-byline">
                <GuestAvatar src={review.avatar} name={review.name} />
                <div>
                  <h3>{review.name}</h3>
                  <p className="guest-review-source">
                    Photo and review on Google
                  </p>
                </div>
              </div>
              <span
                className="guest-review-stars"
                aria-label={`${review.stars} out of 5 stars`}
              >
                <span aria-hidden="true">★</span> {review.stars}/5
              </span>
            </div>
            <blockquote>
              <p>“{review.excerpt}”</p>
            </blockquote>
            <a
              className="guest-review-link"
              href={review.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Read ${review.name}'s review on Google`}
            >
              Read on Google <span aria-hidden="true">↗</span>
            </a>
          </article>
        ))}
      </div>
      <span className="sr-only" role="status" aria-atomic="true">
        {range.first === range.last
          ? `Review ${range.first + 1}`
          : `Reviews ${range.first + 1} to ${range.last + 1}`}{" "}
        of {googleReviews.length}
      </span>

      <div className="guest-reviews-footer">
        <div className="guest-reviews-footer-note">
          <p>Selected excerpts from public Google reviews.</p>
        </div>
        <a
          className="guest-review-link"
          href={googleReviewListing}
          target="_blank"
          rel="noopener noreferrer"
        >
          See all reviews on Google <span aria-hidden="true">↗</span>
        </a>
      </div>
    </section>
  );
}
