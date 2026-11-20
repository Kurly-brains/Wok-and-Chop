"use client";

import { useState } from "react";
import { customLunchId, type MenuCatalogItem } from "@wok/domain";
import { catalogDish, featuredDishes } from "../lib/featured-dishes";
import "../styles/round-table.css";

const placements = [
  { position: "noodles", dishId: "lunch-chicken-chow-mein" },
  { position: "chicken", dishId: "lunch-chilli-chicken" },
  { position: "rolls", dishId: "crispy-spring-rolls", original: "/images/spring-rolls-cutout.webp", overhead: "/images/art/spring-rolls-overhead.webp" },
  { position: "manchurian", dishId: "lunch-veg-manchurian", original: "/images/lunch-veg-manchurian.webp", overhead: "/images/art/veg-manchurian-overhead.webp" },
];

export default function RoundTable({ items }: { items: readonly MenuCatalogItem[] }) {
  const [paused, setPaused] = useState(false);
  const choices = featuredDishes(items).filter(item => item.image && item.imagePresentation === "cutout");
  const preferred = choices.filter(item => item.featured && customLunchId.test(item.id));
  const shown = new Set<string>();
  const dishes = placements.flatMap(placement => {
    const original = catalogDish(items, placement.dishId);
    const item = preferred.find(item => !shown.has(item.id))
      ?? (original?.image && original.imagePresentation === "cutout" && !shown.has(original.id) ? original : undefined)
      ?? choices.find(item => !shown.has(item.id));
    if (!item?.image) return [];
    shown.add(item.id);
    const image = item.id === placement.dishId && item.image === placement.original ? placement.overhead! : item.image;
    return [{ position: placement.position, image, name: item.name }];
  });
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
              src={dish.image}
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
        {dishes.length ? `A round rosewood table with ${dishes.map(dish => dish.name).join(", ")}.` : "A round rosewood table."}
      </figcaption>
    </figure>
  );
}
