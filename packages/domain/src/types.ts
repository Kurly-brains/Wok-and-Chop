export interface Category { id: string; name: string }
export interface ModifierOption {
  id: string;
  name: string;
  priceCents: number;
  available?: boolean;
}
export interface ModifierGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  options: readonly ModifierOption[];
}
export interface MenuItem {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  priceCents: number;
  vegetarian?: boolean;
  spicy?: boolean;
  heatLevel?: 0 | 1 | 2;
  containsPeanuts?: boolean;
  featured?: boolean;
  image?: string;
  imagePresentation?: 'photo' | 'cutout';
  available?: boolean;
  archived?: boolean;
  modifierGroups?: readonly ModifierGroup[];
  /** Blocks live pricing until restaurant content and operating configuration are approved. */
  fixture?: boolean;
}
export interface CartSelection {
  itemId: string;
  quantity: number;
  modifierIds?: readonly string[];
  note?: string;
}
export interface PricedLine {
  itemId: string;
  name: string;
  quantity: number;
  basePriceCents: number;
  modifiers: { id: string; name: string; priceCents: number }[];
  unitPriceCents: number;
  lineTotalCents: number;
  note: string;
}
export type PaymentState = 'UNPAID' | 'PROCESSING' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'FAILED';
export type FulfillmentState = 'AWAITING_PAYMENT' | 'ACCEPTED' | 'SCHEDULED' | 'IN_PREPARATION' | 'READY' | 'COMPLETED' | 'CANCELLED' | 'EXCEPTION';
export type RefundState = 'PENDING' | 'SUCCEEDED' | 'FAILED';
export type PrintState = 'QUEUED' | 'LEASED' | 'SENDING' | 'DELIVERED' | 'CONFIRMED' | 'RETRY_WAIT' | 'UNKNOWN' | 'FAILED' | 'CANCELLED';
