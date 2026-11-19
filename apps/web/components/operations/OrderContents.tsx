import type { DemoOrder } from "../../lib/demo-operations";

export function OrderContents({ order }: { order: DemoOrder }) {
  return <>
    <ul className="ops-items">{order.items.map((item, index) => <li key={`${item.name}-${index}`}><span className="ops-quantity">{item.quantity}</span><div><strong>{item.name}</strong>{item.modifiers.length > 0 && <span>{item.modifiers.join(" · ")}</span>}{item.note && <span className="ops-line-note"><b>Dish note</b> {item.note}</span>}</div></li>)}</ul>
    {order.allergy && <div className="ops-allergy"><strong>Allergy note</strong><p>{order.allergy}</p></div>}
    {order.note && <p className="ops-order-note"><strong>Kitchen note</strong>{order.note}</p>}
  </>;
}
