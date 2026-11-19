"use client";

import { useState } from "react";
import "../styles/round-table.css";

const dishes = [
  { position: "noodles", image: "noodles-cutout.webp" },
  { position: "chicken", image: "chicken-cutout.webp" },
  { position: "rolls", image: "art/spring-rolls-overhead.webp" },
  { position: "manchurian", image: "art/veg-manchurian-overhead.webp" },
];

export default function RoundTable() {
  const [paused, setPaused] = useState(false);
  return (
    <figure className="round-table" id="hero-table">
      <div className="round-table-layout" data-paused={paused}>
        <img
          className="round-table-wood"
          src="/images/art/round-rosewood-table.webp"
          alt=""
          width="1024"
          height="1024"
          fetchPriority="high"
          decoding="async"
          draggable={false}
        />
        <div className="round-table-turntable">
          {dishes.map((dish) => (
            <img
              key={dish.position}
              className={`round-table-dish dish-${dish.position}`}
              src={`/images/${dish.image}`}
              alt=""
              decoding="async"
              draggable={false}
            />
          ))}
        </div>
        <button
          className="round-table-control"
          type="button"
          onClick={() => setPaused((current) => !current)}
          aria-label={paused ? "Resume table rotation" : "Pause table rotation"}
        />
      </div>
      <figcaption className="sr-only">
        A round rosewood table set with Hakka noodles, chilli chicken, spring
        rolls and vegetable Manchurian.
      </figcaption>
    </figure>
  );
}
