"use client";

import { useState, type FormEvent } from "react";
import { formatMoney, lunchMenuItems, priceLine, type CartSelection } from "@wok/domain";
import type { TrainingWorkspace } from "../../lib/demo-operations";

function defaultLine(itemId: string): CartSelection {
  const dish = lunchMenuItems.find(item => item.id === itemId)!;
  return {
    itemId, quantity: 1, note: "",
    modifierIds: dish.modifierGroups?.flatMap(group => group.options.slice(0, group.min).map(option => option.id)) ?? [],
  };
}

export function TrainingIntake({ workspace, onCreated }: { workspace: TrainingWorkspace; onCreated: () => void }) {
  const [lines, setLines] = useState(() => [defaultLine(lunchMenuItems[0].id)]);
  const [minutes, setMinutes] = useState(20);
  const [allergy, setAllergy] = useState("");
  const [note, setNote] = useState("");
  const update = (index: number, next: CartSelection) => setLines(current => current.map((line, i) => i === index ? next : line));
  const subtotal = lines.reduce((sum, line) => sum + priceLine(line, lunchMenuItems).lineTotalCents, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await workspace.run({ type: "create", lines, minutes, allergy, note }, "Training pickup ticket added to the kitchen queue.")) onCreated();
  }

  return <form className="ops-intake" onSubmit={submit}>
    <header><h2>Enter a training pickup</h2><p>Use fictitious notes. Ticket numbers identify these kitchen rehearsals.</p></header>
    {lines.map((line, index) => {
      const dish = lunchMenuItems.find(item => item.id === line.itemId)!;
      return <fieldset key={index}><legend>Dish {index + 1}</legend>
        <div className="ops-intake-fields">
          <label>Dish<select value={line.itemId} onChange={event => update(index, { ...defaultLine(event.target.value), quantity: line.quantity })}>{lunchMenuItems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Quantity<select value={line.quantity} onChange={event => update(index, { ...line, quantity: Number(event.target.value) })}>{Array.from({ length: 20 }, (_, i) => <option key={i}>{i + 1}</option>)}</select></label>
          {dish.modifierGroups?.map(group => <label key={group.id}>{group.name}
            <select value={group.options.find(option => line.modifierIds?.includes(option.id))?.id}
              onChange={event => update(index, { ...line, modifierIds: [...(line.modifierIds ?? []).filter(id => !group.options.some(option => option.id === id)), event.target.value] })}>
              {group.options.filter(option => option.available !== false).map(option => <option key={option.id} value={option.id}>{option.name}{option.priceCents ? " +" + formatMoney(option.priceCents) : ""}</option>)}
            </select></label>)}
          <label>Dish note<input value={line.note ?? ""} maxLength={240} onChange={event => update(index, { ...line, note: event.target.value })} /></label>
        </div>
        {lines.length > 1 && <button type="button" className="ops-text-button" onClick={() => setLines(current => current.filter((_, i) => i !== index))}>Remove dish {index + 1}</button>}
      </fieldset>;
    })}
    <button type="button" className="ops-button ops-button-outline" disabled={lines.length >= 20} onClick={() => setLines(current => [...current, defaultLine(lunchMenuItems[0].id)])}>Add another dish</button>
    <div className="ops-intake-fields">
      <label>Pickup in<select value={minutes} onChange={event => setMinutes(Number(event.target.value))}>{[5, 10, 15, 20, 30, 45, 60, 90, 120].map(value => <option key={value} value={value}>{value} minutes</option>)}</select></label>
      <label>Allergy alert<input maxLength={240} value={allergy} onChange={event => setAllergy(event.target.value)} /></label>
      <label>Order note<input maxLength={240} value={note} onChange={event => setNote(event.target.value)} /></label>
    </div>
    <footer><strong>Training subtotal {formatMoney(subtotal)} CAD</strong><button className="ops-button" type="submit" disabled={workspace.busy || workspace.service.paused}>Send training ticket to kitchen</button></footer>
  </form>;
}
