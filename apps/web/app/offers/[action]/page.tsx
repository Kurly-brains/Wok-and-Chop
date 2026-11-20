import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OfferPreference } from "../../../components/offer-preferences";
import Storefront from "../../../components/storefront";

export const metadata: Metadata = {
  title: "Email preferences · Wok & Chop",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function OfferPreferencePage({
  params,
  searchParams,
}: {
  params: Promise<{ action: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const [{ action }, { token }] = await Promise.all([params, searchParams]);
  if (action !== "confirm" && action !== "unsubscribe") notFound();

  return (
    <Storefront page="offers">
      <OfferPreference
        action={action}
        token={
          typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token)
            ? token
            : null
        }
      />
    </Storefront>
  );
}
