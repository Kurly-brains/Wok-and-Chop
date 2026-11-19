"use client";

import { useEffect, useRef, useState } from "react";
import { OperationsShell } from "./operations/OperationsShell";
import { formatMoney, isLunchMenuItem, lunchCategories } from "@wok/domain";
import {
  getMenuCatalogSnapshot,
  resetCatalog,
  saveMenuItem,
  useMenuCatalog,
  type MenuCatalogItem,
} from "../lib/menu-catalog";

type Draft = {
  name: string;
  description: string;
  categoryId: string;
  price: string;
  available: boolean;
  image: string;
  imagePresentation: "photo" | "cutout";
  heatLevel: 0 | 1 | 2;
  containsPeanuts: boolean;
};
const menuCategories = lunchCategories;
const MAX_FILE_BYTES = 350 * 1024;
function draftFrom(item: MenuCatalogItem): Draft {
  return {
    name: item.name,
    description: item.description,
    categoryId: item.categoryId,
    price: (item.priceCents / 100).toFixed(2),
    available: item.available !== false,
    image: item.image ?? "",
    imagePresentation: item.imagePresentation ?? "photo",
    heatLevel: item.heatLevel ?? 0,
    containsPeanuts: item.containsPeanuts ?? false,
  };
}
function snapshot(item: MenuCatalogItem) {
  return JSON.stringify(draftFrom(item));
}
function centsFrom(text: string) {
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(text.trim()))
    throw new Error(
      "Enter a price from $0.01 to $2,000.00 with no more than two decimal places.",
    );
  const [dollars, cents = ""] = text.trim().split(".");
  const value = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  if (value <= 0 || value > 200000)
    throw new Error("Enter a price from $0.01 to $2,000.00.");
  return value;
}
async function imageData(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(
      "Choose a JPEG, PNG or WebP image. SVG, GIF and other files are not supported.",
    );
  if (file.size === 0 || file.size > MAX_FILE_BYTES)
    throw new Error(
      "Choose an image smaller than 350 KB. Resize or compress a larger photo first.",
    );
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const png =
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    );
  const jpeg =
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255;
  const webp =
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!{ "image/png": png, "image/jpeg": jpeg, "image/webp": webp }[file.type])
    throw new Error(
      "The file contents do not match its image type. Choose a valid JPEG, PNG or WebP image.",
    );
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(
        new Error("The image could not be read. Please try another file."),
      );
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
  if (url.length > 500000)
    throw new Error(
      "This image is too large for browser storage. Compress it and try again.",
    );
  const decoded = new window.Image();
  decoded.src = url;
  try {
    await decoded.decode();
  } catch {
    throw new Error(
      "This image appears damaged or unsupported. Try another image.",
    );
  }
  if (
    !decoded.naturalWidth ||
    !decoded.naturalHeight ||
    decoded.naturalWidth > 6000 ||
    decoded.naturalHeight > 6000
  )
    throw new Error("Use an image no larger than 6,000 pixels on either side.");
  return url;
}

function DishEditor({
  item,
  onDirty,
  onSaved,
  onReload,
}: {
  item: MenuCatalogItem;
  onDirty(value: boolean): void;
  onSaved(): void;
  onReload(): void;
}) {
  const [draft, setDraft] = useState(() => draftFrom(item));
  const [baseSnapshot, setBaseSnapshot] = useState(() => snapshot(item));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const uploadSequence = useRef(0);
  const uploadInput = useRef<HTMLInputElement>(null);
  const changedElsewhere = snapshot(item) !== baseSnapshot;
  const dirty = JSON.stringify(draft) !== baseSnapshot;
  useEffect(
    () => () => {
      uploadSequence.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function change(patch: Partial<Draft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    setNotice("");
    setError("");
    onDirty(JSON.stringify(next) !== baseSnapshot);
    if (patch.image !== undefined) setImageFailed(false);
  }
  async function upload(file?: File) {
    if (!file) return;
    const sequence = ++uploadSequence.current;
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const url = await imageData(file);
      if (sequence !== uploadSequence.current) return;
      change({ image: url, imagePresentation: "photo" });
      setNotice(
        `${file.name} is ready to save. Choose cutout framing only if the image already has transparency.`,
      );
    } catch (err) {
      if (sequence === uploadSequence.current)
        setError(err instanceof Error ? err.message : "Image upload failed.");
    } finally {
      if (sequence === uploadSequence.current) setUploading(false);
      if (uploadInput.current) uploadInput.current.value = "";
    }
  }
  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const current = getMenuCatalogSnapshot().find(
        (dish) => dish.id === item.id,
      );
      if (!current || snapshot(current) !== baseSnapshot)
        throw new Error(
          "This dish changed in another tab. Reload its details before saving to avoid overwriting that change.",
        );
      const saved = saveMenuItem(item.id, {
        name: draft.name.trim(),
        description: draft.description.trim(),
        categoryId: draft.categoryId,
        priceCents: centsFrom(draft.price),
        available: draft.available,
        image: draft.image || null,
        imagePresentation: draft.imagePresentation,
        heatLevel: draft.heatLevel,
        containsPeanuts: draft.containsPeanuts,
      });
      setDraft(draftFrom(saved));
      setBaseSnapshot(snapshot(saved));
      onDirty(false);
      onSaved();
      setNotice(
        "Saved in this browser. The lunch menu now uses these details.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Changes could not be saved. Your edits are still here.",
      );
    }
  }
  let priceLabel = "Enter a price";
  try {
    priceLabel = `${formatMoney(centsFrom(draft.price))} CAD`;
  } catch {
    /* Show validation when saving. */
  }
  return (
    <div className="menu-editor-detail">
      <div className="menu-editor-detail-title">
        <div>
          <span>Lunch dish details</span>
          <h2>{draft.name || "Untitled dish"}</h2>
        </div>
        <span className="menu-editor-save-state">
          {dirty ? "Unsaved changes" : "Saved locally"}
        </span>
      </div>
      {changedElsewhere && (
        <div className="menu-editor-conflict" role="status">
          <p>This dish changed in another tab. Reload before saving.</p>
          <button type="button" onClick={onReload}>
            Reload details
          </button>
        </div>
      )}
      <form onSubmit={save}>
        <div className="menu-editor-columns">
          <div className="menu-editor-fields">
            <label>
              Dish name
              <input
                value={draft.name}
                onChange={(event) => change({ name: event.target.value })}
                required
                maxLength={80}
              />
            </label>
            <label>
              Description
              <textarea
                value={draft.description}
                onChange={(event) =>
                  change({ description: event.target.value })
                }
                rows={3}
                maxLength={400}
              />
            </label>
            <div className="menu-editor-field-pair">
              <label>
                Category
                <select
                  value={draft.categoryId}
                  onChange={(event) =>
                    change({ categoryId: event.target.value })
                  }
                >
                  {menuCategories.map((category) => (
                    <option value={category.id} key={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Lunch price · CAD
                <div className="menu-editor-price">
                  <span>$</span>
                  <input
                    value={draft.price}
                    onChange={(event) => change({ price: event.target.value })}
                    inputMode="decimal"
                    required
                    aria-label="Lunch price in Canadian dollars"
                  />
                </div>
              </label>
            </div>
            <label className="menu-editor-availability">
              <input
                type="checkbox"
                checked={draft.available}
                onChange={(event) =>
                  change({ available: event.target.checked })
                }
              />
              <span>
                <strong>Available on the lunch menu</strong>
                <small>Uncheck to show this dish as sold out.</small>
              </span>
            </label>
            <div className="menu-editor-dietary-fields">
              <label>
                Heat level
                <select
                  value={draft.heatLevel}
                  onChange={(event) =>
                    change({
                      heatLevel: Number(event.target.value) as 0 | 1 | 2,
                    })
                  }
                >
                  <option value={0}>No heat marker</option>
                  <option value={1}>One chilli · spicy</option>
                  <option value={2}>Two chillies · extra spicy</option>
                </select>
              </label>
              <label className="menu-editor-peanuts">
                <input
                  type="checkbox"
                  checked={draft.containsPeanuts}
                  onChange={(event) =>
                    change({ containsPeanuts: event.target.checked })
                  }
                />
                <span>
                  <strong>Contains peanuts</strong>
                  <small>Show the menu’s peanut warning.</small>
                </span>
              </label>
            </div>
            <p className="menu-editor-allergen-note">
              These markers describe the menu. An unchecked peanut marker does
              not guarantee a peanut-free meal.
            </p>
            <fieldset className="menu-editor-image-options">
              <legend>How should the image fit?</legend>
              <div>
                <label
                  className={
                    draft.imagePresentation === "photo" ? "is-selected" : ""
                  }
                >
                  <input
                    type="radio"
                    name="image-presentation"
                    value="photo"
                    checked={draft.imagePresentation === "photo"}
                    onChange={() => change({ imagePresentation: "photo" })}
                  />
                  <span>
                    <strong>Full photo</strong>
                    <small>Fill the image frame with a regular photo.</small>
                  </span>
                </label>
                <label
                  className={
                    draft.imagePresentation === "cutout" ? "is-selected" : ""
                  }
                >
                  <input
                    type="radio"
                    name="image-presentation"
                    value="cutout"
                    checked={draft.imagePresentation === "cutout"}
                    onChange={() => change({ imagePresentation: "cutout" })}
                  />
                  <span>
                    <strong>Transparent cutout</strong>
                    <small>
                      Keep the whole dish visible, without cropping.
                    </small>
                  </span>
                </label>
              </div>
              <p>
                Framing does not remove an image’s background. Regular photos
                are welcome.
              </p>
            </fieldset>
            <div className="menu-editor-upload">
              <div>
                <strong>Your dish image</strong>
                <p>JPEG, PNG or WebP · up to 350 KB</p>
              </div>
              <label className="menu-editor-upload-button">
                {uploading ? "Reading image…" : "Choose image"}
                <input
                  ref={uploadInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploading}
                  onChange={(event) => void upload(event.target.files?.[0])}
                />
              </label>
            </div>
            <div className="menu-editor-image-actions">
              <button
                type="button"
                disabled={uploading}
                onClick={() =>
                  change({
                    image: "/images/chilli-chicken.jpg",
                    imagePresentation: "photo",
                  })
                }
              >
                Try a sample photo
              </button>
              <button
                type="button"
                disabled={uploading}
                onClick={() =>
                  change({
                    image: "/images/chicken-cutout.webp",
                    imagePresentation: "cutout",
                  })
                }
              >
                Try a sample cutout
              </button>
              {draft.image && (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => change({ image: "" })}
                >
                  Remove image
                </button>
              )}
            </div>
          </div>
          <aside className="menu-editor-preview" aria-label="Dish preview">
            <div className="menu-editor-preview-label">
              <span>Menu preview</span>
              <span>
                {draft.imagePresentation === "photo" ? "Full photo" : "Cutout"}
              </span>
            </div>
            <div
              className={`menu-editor-preview-art is-${draft.imagePresentation}`}
            >
              {draft.image && !imageFailed ? (
                <img
                  src={draft.image}
                  alt={draft.name || "Dish preview"}
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <div className="menu-editor-image-empty">
                  <span>W&amp;C</span>
                  <p>
                    {imageFailed
                      ? "This image could not be displayed."
                      : "Add a photo when it’s ready."}
                  </p>
                </div>
              )}
              {!draft.available && (
                <span className="menu-editor-sold-out">Sold out</span>
              )}
            </div>
            <div className="menu-editor-preview-copy">
              <p>
                {
                  menuCategories.find(
                    (category) => category.id === draft.categoryId,
                  )?.name
                }
              </p>
              <h3>{draft.name || "Your dish name"}</h3>
              {(draft.heatLevel > 0 || draft.containsPeanuts) && (
                <ul
                  className="menu-editor-preview-markers"
                  aria-label="Dish markers"
                >
                  {draft.heatLevel > 0 && (
                    <li>{draft.heatLevel === 2 ? "Extra spicy" : "Spicy"}</li>
                  )}
                  {draft.containsPeanuts && <li>Contains peanuts</li>}
                </ul>
              )}
              <span>
                {draft.description ||
                  "A short description helps guests choose."}
              </span>
              <strong>{priceLabel}</strong>
            </div>
            <p className="menu-editor-preview-note">
              Preview only. No image is uploaded to a server.
            </p>
          </aside>
        </div>
        {error && (
          <p className="menu-editor-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="menu-editor-notice" role="status">
            {notice}
          </p>
        )}
        <div className="menu-editor-save-bar">
          <p>
            {dirty
              ? "Ready when you are. Save to update this browser’s menu."
              : "Your changes stay on this device."}
          </p>
          <div>
            <button
              type="button"
              className="menu-editor-secondary"
              onClick={onReload}
              disabled={uploading || !dirty}
            >
              Discard changes
            </button>
            <button
              type="submit"
              className="menu-editor-primary"
              disabled={uploading || !dirty || changedElsewhere}
            >
              {uploading ? "Reading image…" : "Save changes"}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function MenuEditor() {
  const catalog = useMenuCatalog().filter(isLunchMenuItem);
  const [selectedId, setSelectedId] = useState(catalog[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const resetHeading = useRef<HTMLHeadingElement>(null);
  const selected = catalog.find((item) => item.id === selectedId) ?? catalog[0];
  const matches = catalog.filter(
    (item) =>
      (categoryFilter === "all" || item.categoryId === categoryFilter) &&
      `${item.name} ${item.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  useEffect(() => {
    if (resetOpen) resetHeading.current?.focus();
  }, [resetOpen]);
  function reload() {
    setDirty(false);
    setRevision((value) => value + 1);
    setNotice("");
  }
  function reset() {
    try {
      resetCatalog();
      reload();
      setResetOpen(false);
      setNotice("Original menu data restored in this browser.");
    } catch (err) {
      setNotice(
        err instanceof Error
          ? err.message
          : "The original menu could not be restored.",
      );
    }
  }
  return (
    <OperationsShell active="menu">
      <div className="menu-workspace">
        <main id="main-content" tabIndex={-1} className="menu-editor-main">
        <div className="menu-editor-heading">
          <div>
            <p>Restaurant workspace / Local catalogue</p>
            <h1>Lunch menu editor</h1>
            <span>
              Edit dish details, prices and menu photography in this browser.
            </span>
          </div>
          <div className="menu-editor-scope">
            <strong>Browser preview</strong>
            <p>
              Menu from your supplied artwork.
              <br />
              No restaurant publishing connection.
            </p>
          </div>
        </div>
        <div className="menu-editor-layout">
          <aside className="menu-editor-sidebar" aria-label="Choose a dish">
            <label className="menu-editor-search">
              <span>Find a dish</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search lunch dishes"
              />
            </label>
            <label className="menu-editor-category-filter">
              <span>Category</span>
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="all">All lunch dishes</option>
                {menuCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="menu-editor-list-heading">
              <strong>{matches.length} dishes</strong>
              <span>Choose one to edit</span>
            </div>
            <div className="menu-editor-dish-list">
              {matches.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={selected?.id === item.id}
                  onClick={() => {
                    if (item.id === selected?.id) return;
                    if (dirty) {
                      setNotice(
                        "Save or discard your changes before choosing another dish.",
                      );
                      return;
                    }
                    setSelectedId(item.id);
                    setNotice("");
                  }}
                >
                  <div>
                    <strong>{item.name}</strong>
                    <span>
                      {formatMoney(item.priceCents)} CAD <i>·</i>{" "}
                      {item.available === false ? "Sold out" : "Available"}
                    </span>
                  </div>
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
              {matches.length === 0 && (
                <p className="menu-editor-no-results">
                  No matching dishes. Try a different search.
                </p>
              )}
            </div>
            <button
              type="button"
              className="menu-editor-reset"
              onClick={() => setResetOpen(true)}
            >
              Restore original menu
            </button>
          </aside>
          {selected && (
            <DishEditor
              key={`${selected.id}-${revision}`}
              item={selected}
              onDirty={setDirty}
              onSaved={() => setNotice("")}
              onReload={reload}
            />
          )}
        </div>
        {notice && (
          <p className="menu-editor-global-notice" role="status">
            {notice}
          </p>
        )}
        {resetOpen && (
          <section
            className="menu-editor-reset-confirm"
            aria-label="Restore original menu confirmation"
          >
            <div>
              <h2 ref={resetHeading} tabIndex={-1}>
                Restore the original menu data?
              </h2>
              <p>
                This removes this browser’s menu edits and uploaded dish images,
                including changes outside the lunch menu. Other browser data
                stays as it is.
              </p>
            </div>
            <div>
              <button
                type="button"
                className="menu-editor-secondary"
                onClick={() => setResetOpen(false)}
              >
                Keep my edits
              </button>
              <button
                type="button"
                className="menu-editor-primary"
                onClick={reset}
              >
                Restore original
              </button>
            </div>
          </section>
        )}
        <footer className="menu-editor-footer">
          <p>
            This development authoring tool has no administrator sign-in or
            production publishing. Uploaded images are stored only in this
            browser.
          </p>
          <span>Wok &amp; Chop · Kanata</span>
        </footer>
        </main>
      </div>
    </OperationsShell>
  );
}
