import { redirect } from "next/navigation";
import { uberEatsUrl } from "../../lib/ordering";

export default function DeliveryPage() {
  redirect(uberEatsUrl);
}
