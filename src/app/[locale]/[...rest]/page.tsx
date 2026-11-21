import { notFound } from "next/navigation";
import { isLocale } from "../../../i18n/routing";

// Unmatched paths under a locale render the localized not-found page
// instead of Next's unlocalized default.
export default async function CatchAll({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Unsupported locale: bail to the root not-found handler before any
  // locale-specific rendering.
  if (!isLocale(locale)) notFound();
  notFound();
}
