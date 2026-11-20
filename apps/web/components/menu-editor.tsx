"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL, authRequest, useCustomer } from "../lib/customer-session";
import { ManagerSignIn } from "./operations/ManagerSignIn";
import { OperationsShell } from "./operations/OperationsShell";
import { availableDishModifierGroups, formatMoney, isLunchMenuItem, lunchCategories } from "@wok/domain";
import {
  createPublishedMenuItem,
  getMenuCatalogSnapshot,
  getPublishedMenuVersion,
  publishMenuItem,
  refreshPublishedMenu,
  resetPublishedMenu,
  useMenuCatalog,
  type MenuCatalogItem,
} from "../lib/menu-catalog";

type Draft = {
  name: string;
  description: string;
  categoryId: string;
  price: string;
  available: boolean;
  archived: boolean;
  featured: boolean;
  image: string;
  imagePresentation: "photo" | "cutout";
  heatLevel: 0 | 1 | 2;
  containsPeanuts: boolean;
  modifierGroupIds: readonly string[];
};
const menuCategories = lunchCategories;
const MAX_FILE_BYTES = 350 * 1024;
const emptyDraft: Draft = {
  name: "",
  description: "",
  categoryId: "",
  price: "",
  available: true,
  archived: false,
  featured: false,
  image: "",
  imagePresentation: "photo",
  heatLevel: 0,
  containsPeanuts: false,
  modifierGroupIds: [],
};
function draftFrom(item: MenuCatalogItem): Draft {
  return {
    name: item.name,
    description: item.description,
    categoryId: item.categoryId,
    price: (item.priceCents / 100).toFixed(2),
    available: item.available !== false,
    archived: item.archived === true,
    featured: item.featured === true,
    image: item.image ?? "",
    imagePresentation: item.imagePresentation ?? "photo",
    heatLevel: item.heatLevel ?? 0,
    containsPeanuts: item.containsPeanuts ?? false,
    modifierGroupIds: item.modifierGroups?.map(group => group.id) ?? [],
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
  onArchiveChange,
  onReload,
}: {
  item: MenuCatalogItem | null;
  onDirty(value: boolean): void;
  onSaved(item: MenuCatalogItem): void;
  onArchiveChange(item: MenuCatalogItem): void;
  onReload(): void;
}) {
  const creating = item === null;
  const [draft, setDraft] = useState(() => (item ? draftFrom(item) : emptyDraft));
  const [baseSnapshot, setBaseSnapshot] = useState(() => JSON.stringify(draft));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const uploadSequence = useRef(0);
  const uploadInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const archiveHeading = useRef<HTMLHeadingElement>(null);
  const archiveButton = useRef<HTMLButtonElement>(null);
  const saveInFlight = useRef(false);
  const createAttempt = useRef<{ payload: string; requestId: string } | null>(null);
  const changedElsewhere = item !== null && snapshot(item) !== baseSnapshot;
  const dirty = JSON.stringify(draft) !== baseSnapshot;
  const availableGroups = draft.categoryId
    ? availableDishModifierGroups({ id: item?.id, categoryId: draft.categoryId })
    : [];
  useEffect(() => {
    if (creating) heading.current?.focus();
  }, [creating]);
  useEffect(() => {
    if (confirmArchive) archiveHeading.current?.focus();
  }, [confirmArchive]);
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
  function changeCategory(categoryId: string) {
    const groups = availableDishModifierGroups({ id: item?.id, categoryId });
    change({
      categoryId,
      modifierGroupIds: groups.filter(group => draft.modifierGroupIds.includes(group.id)).map(group => group.id),
    });
  }
  function selectGroup(id: string, checked: boolean) {
    change({
      modifierGroupIds: availableGroups
        .filter(group => group.id === id ? checked : draft.modifierGroupIds.includes(group.id))
        .map(group => group.id),
    });
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
  function checkCurrentDish(id: string) {
    const current = getMenuCatalogSnapshot().find((entry) => entry.id === id);
    if (!current || snapshot(current) !== baseSnapshot)
      throw new Error("The published dish changed. Reload its details before saving.");
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveInFlight.current || uploading) return;
    saveInFlight.current = true;
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const previousGroups = item?.modifierGroups?.map(group => group.id) ?? [];
      const includeGroups = creating || draft.categoryId !== item?.categoryId ||
        draft.modifierGroupIds.join(",") !== previousGroups.join(",");
      const dish = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        categoryId: draft.categoryId,
        priceCents: centsFrom(draft.price),
        available: draft.available,
        featured: draft.featured,
        image: draft.image || null,
        imagePresentation: draft.imagePresentation,
        heatLevel: draft.heatLevel,
        containsPeanuts: draft.containsPeanuts,
        ...(includeGroups ? { modifierGroupIds: draft.modifierGroupIds } : {}),
      };
      let saved: MenuCatalogItem;
      if (item) {
        checkCurrentDish(item.id);
        saved = await publishMenuItem(item.id, dish);
      } else {
        const payload = JSON.stringify(dish);
        if (createAttempt.current?.payload !== payload)
          createAttempt.current = { payload, requestId: crypto.randomUUID() };
        saved = await createPublishedMenuItem(
          dish,
          getPublishedMenuVersion(),
          createAttempt.current.requestId,
        );
      }
      setDraft(draftFrom(saved));
      setBaseSnapshot(snapshot(saved));
      onDirty(false);
      onSaved(saved);
      setNotice(saved.archived ? "Saved to this archived dish." : "Published. The lunch menu now uses these details.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Changes could not be saved. Your edits are still here.",
      );
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }
  async function updateArchive(archived: boolean) {
    if (!item || dirty || changedElsewhere || saveInFlight.current || uploading) return;
    saveInFlight.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      checkCurrentDish(item.id);
      const saved = await publishMenuItem(item.id, { archived });
      setConfirmArchive(false);
      onArchiveChange(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The dish's archive status could not be changed.");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
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
          <span>{creating ? "New menu item" : "Lunch dish details"}</span>
          <h2 ref={heading} tabIndex={creating ? -1 : undefined}>
            {creating ? "Add a dish" : draft.name || "Untitled dish"}
          </h2>
        </div>
        <span className="menu-editor-save-state">
          {dirty ? "Unsaved changes" : creating ? "Draft" : draft.archived ? "Archived" : "Published"}
        </span>
      </div>
      {changedElsewhere && (
        <div className="menu-editor-conflict" role="status">
          <p>The published dish changed. Reload before saving.</p>
          <button type="button" onClick={onReload}>
            Reload details
          </button>
        </div>
      )}
      <form onSubmit={save}>
        <fieldset className="menu-editor-columns" disabled={saving} aria-label="Dish details">
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
                  aria-label="Dish category"
                  value={draft.categoryId}
                  onChange={(event) => changeCategory(event.target.value)}
                  required
                >
                  {creating && <option value="" disabled>Choose a category</option>}
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
            <fieldset className="menu-editor-dish-options">
              <legend>Guest options for this dish</legend>
              {availableGroups.length > 0 && (
                <div className="menu-editor-dish-options-grid">
                  {availableGroups.map((group) => {
                    const checked = draft.modifierGroupIds.includes(group.id);
                    return (
                      <label key={group.id} className={checked ? "is-selected" : undefined}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={event => selectGroup(group.id, event.target.checked)}
                        />
                        <span>
                          <strong>{group.name}</strong>
                          <small>
                            {group.options.filter(option => option.available !== false).map((option) =>
                              option.priceCents > 0
                                ? `${option.name} (+${formatMoney(option.priceCents)})`
                                : option.name,
                            ).join(" · ")}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              <p>{!draft.categoryId
                ? "Choose a category to see its options."
                : draft.modifierGroupIds.length
                  ? "Guests choose from the selected groups when adding this dish."
                  : "Guests add this dish straight to their bag."}</p>
            </fieldset>
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
                <small>Uncheck to hide this dish from the customer menu.</small>
              </span>
            </label>
            <label className="menu-editor-availability">
              <input
                type="checkbox"
                checked={draft.featured}
                onChange={(event) => change({ featured: event.target.checked })}
              />
              <span>
                <strong>Feature this dish</strong>
                <small>Prioritize it in menu highlights when available and photographed.</small>
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
              {!creating && <button
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
              </button>}
              {!creating && <button
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
              </button>}
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
              {(draft.archived || !draft.available) && (
                <span className="menu-editor-sold-out">{draft.archived ? "Archived" : "Sold out"}</span>
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
          </aside>
        </fieldset>
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
            {creating || dirty
              ? "Publish to update the lunch menu and pickup quotes."
              : "The customer menu uses these details."}
          </p>
          <div>
            <button
              type="button"
              className="menu-editor-secondary"
              onClick={onReload}
              disabled={uploading || saving || (!creating && !dirty)}
            >
              {creating ? "Discard new dish" : "Discard changes"}
            </button>
            <button
              type="submit"
              className="menu-editor-primary"
              disabled={uploading || saving || !dirty || changedElsewhere}
            >
              {uploading ? "Reading image…" : saving ? "Publishing…" : creating ? "Publish dish" : "Publish changes"}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>
      </form>
      {item && (
        <section className="menu-editor-archive-tools" aria-label="Dish archive">
          {confirmArchive ? (
            <div className="menu-editor-archive-confirm" role="group" aria-labelledby="menu-editor-archive-title">
              <div>
                <h3 id="menu-editor-archive-title" ref={archiveHeading} tabIndex={-1}>Archive {item.name}?</h3>
                <p>This moves the dish out of the customer menu. Previous orders keep their saved details.</p>
              </div>
              <div>
                <button
                  className="menu-editor-secondary"
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setConfirmArchive(false);
                    requestAnimationFrame(() => archiveButton.current?.focus());
                  }}
                >
                  Cancel
                </button>
                <button className="menu-editor-primary" type="button" disabled={saving || uploading || dirty || changedElsewhere} onClick={() => void updateArchive(true)}>
                  {saving ? "Archiving…" : "Confirm archive"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p>{dirty
                ? "Publish or discard your changes to update this dish’s archive status."
                : draft.archived
                  ? "Restore this dish with its saved availability and options."
                  : "Move this dish to Archived so guests can’t order it."}</p>
              <button
                className="menu-editor-secondary"
                type="button"
                ref={archiveButton}
                disabled={saving || uploading || dirty || changedElsewhere}
                onClick={() => draft.archived ? void updateArchive(false) : setConfirmArchive(true)}
              >
                {draft.archived ? saving ? "Restoring…" : "Restore dish" : "Archive dish"}
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function MenuEditorWorkspace() {
  const catalog = useMenuCatalog().filter(isLunchMenuItem);
  const [selectedId, setSelectedId] = useState<string>(catalog[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [archiveView, setArchiveView] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const resetHeading = useRef<HTMLHeadingElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const noticeRegion = useRef<HTMLParagraphElement>(null);
  const visibleCatalog = catalog.filter(item => (item.archived === true) === archiveView);
  const selected = visibleCatalog.find((item) => item.id === selectedId) ?? visibleCatalog[0];
  const matches = visibleCatalog.filter(
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
  function addDish() {
    if (dirty) {
      setNotice("Save or discard your changes before adding a dish.");
      return;
    }
    setNotice("");
    setCreating(true);
  }
  function closeEditor() {
    if (creating) {
      setCreating(false);
      requestAnimationFrame(() => addButton.current?.focus());
    }
    reload();
  }
  function onSaved(item: MenuCatalogItem) {
    if (creating) {
      setCreating(false);
      setArchiveView(false);
      setSelectedId(item.id);
      setSearch("");
      setCategoryFilter("all");
      setNotice(
        item.available === false
          ? `${item.name} was published as sold out.`
          : `${item.name} is now on the lunch menu.`,
      );
    } else {
      setNotice("");
    }
  }
  function changeArchiveView(archived: boolean) {
    if (archiveView === archived) return;
    if (dirty) {
      setNotice("Publish or discard your changes before changing the dish view.");
      return;
    }
    setArchiveView(archived);
    setSearch("");
    setCategoryFilter("all");
    setNotice("");
  }
  function onArchiveChange(item: MenuCatalogItem) {
    setArchiveView(item.archived === true);
    setSelectedId(item.id);
    setSearch("");
    setCategoryFilter("all");
    setNotice(item.archived
      ? `${item.name} moved to Archived.`
      : item.available === false
        ? `${item.name} restored as sold out.`
        : `${item.name} restored to the lunch menu.`);
    requestAnimationFrame(() => noticeRegion.current?.focus());
  }
  async function reset() {
    if (resetting) return;
    setResetting(true);
    try {
      await resetPublishedMenu();
      reload();
      setResetOpen(false);
      setNotice("Menu defaults restored.");
    } catch (err) {
      setNotice(
        err instanceof Error
          ? err.message
          : "The original menu could not be restored.",
      );
    } finally { setResetting(false); }
  }
  return (
      <div className="menu-workspace">
        <main id="main-content" tabIndex={-1} className="menu-editor-main">
        <div className="menu-editor-heading">
          <div>
            <p>Restaurant workspace / Lunch</p>
            <h1>Lunch menu editor</h1>
            <span>
              Publish dish details, prices and menu photography to the lunch menu.
            </span>
          </div>
          <div className="menu-editor-heading-actions">
            <button
              type="button"
              className="menu-editor-primary"
              ref={addButton}
              disabled={creating || resetOpen}
              onClick={addDish}
            >
              Add dish <span aria-hidden="true">+</span>
            </button>
            <div className="menu-editor-scope">
              <strong>Local preview</strong>
              <p>Updates apply to the menu and pickup quotes.</p>
            </div>
          </div>
        </div>
        {notice && <p className="menu-editor-global-notice" role="status" tabIndex={-1} ref={noticeRegion}>{notice}</p>}
        <div className={`menu-editor-layout${creating ? " menu-editor-layout--create" : ""}`}>
          {!creating && <aside className="menu-editor-sidebar" aria-label="Choose a dish">
            <div className="menu-editor-archive-tabs" role="group" aria-label="Dish visibility">
              <button type="button" aria-pressed={!archiveView} onClick={() => changeArchiveView(false)}>Current</button>
              <button type="button" aria-pressed={archiveView} onClick={() => changeArchiveView(true)}>Archived</button>
            </div>
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
                      {item.archived ? "Archived" : item.available === false ? "Sold out" : "Available"}
                    </span>
                  </div>
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
              {matches.length === 0 && (
                <p className="menu-editor-no-results">
                  {archiveView && visibleCatalog.length === 0
                    ? "No archived dishes."
                    : "No matching dishes. Try a different search."}
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
          </aside>}
          {(creating || selected) && (
            <DishEditor
              key={creating ? "new-dish" : `${selected?.id}-${revision}`}
              item={creating ? null : selected ?? null}
              onDirty={setDirty}
              onSaved={onSaved}
              onArchiveChange={onArchiveChange}
              onReload={closeEditor}
            />
          )}
        </div>
        {resetOpen && (
          <section
            className="menu-editor-reset-confirm"
            aria-label="Restore original menu confirmation"
          >
            <div>
              <h2 ref={resetHeading} tabIndex={-1}>
                Restore menu defaults?
              </h2>
              <p>
                Reset current dishes to their source or creation defaults. Archived dishes keep their saved settings.
              </p>
            </div>
            <div>
              <button
                type="button"
                className="menu-editor-secondary"
                onClick={() => setResetOpen(false)}
                disabled={resetting}
              >
                Keep my edits
              </button>
              <button
                type="button"
                className="menu-editor-primary"
                onClick={reset}
                disabled={resetting}
              >
                {resetting ? "Restoring…" : "Restore original"}
              </button>
            </div>
          </section>
        )}
        </main>
      </div>
  );
}

function MenuEditorAccess() {
  const [access, setAccess] = useState("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`${API_URL}/v1/auth/admin/menu`, {
          credentials: "include", cache: "no-store", signal: controller.signal,
        });
        const next = response.status === 403 || response.status === 401 ? "denied"
          : response.ok && await refreshPublishedMenu() ? "ready" : "unavailable";
        if (!controller.signal.aborted) setAccess(next);
      } catch {
        if (!controller.signal.aborted) setAccess("unavailable");
      }
    }
    void load();
    return () => controller.abort();
  }, [retry]);

  if (access === "ready") return <MenuEditorWorkspace />;
  return <main id="main-content" className="ops-main" tabIndex={-1}>
    <h1>Lunch menu editor</h1>
    {access === "loading" ? <p role="status">Checking menu access…</p>
      : access === "denied" ? <p role="alert">Sign in with a restaurant manager account to publish changes.</p>
      : <p role="alert">The menu service is temporarily unavailable.</p>}
    {access === "denied" && <button className="ops-button" onClick={() => void authRequest("logout").catch(() => setAccess("unavailable"))}>Sign out</button>}
    {access === "unavailable" && <button className="ops-button" onClick={() => { setAccess("loading"); setRetry(value => value + 1); }}>Retry</button>}
  </main>;
}

export default function MenuEditor() {
  const user = useCustomer();
  return <OperationsShell active="menu">
    {user ? <MenuEditorAccess key={user.id} /> :
      <main id="main-content" className="ops-main" tabIndex={-1}>
        <h1>Lunch menu editor</h1>
        <ManagerSignIn description="Sign in to update dishes, prices and photos." />
      </main>}
  </OperationsShell>;
}
