import { requireStaff } from "@/staff/auth";
import { catalogueVersion, findDuplicates, listCatalogue, listCorrections } from "@/staff/catalogue";
import { CatalogueView } from "./view";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await requireStaff(["super_admin"]);
  const { q = "", status = "" } = await searchParams;
  const [entries, version, duplicates, corrections] = await Promise.all([listCatalogue(q, status), catalogueVersion(), findDuplicates(), listCorrections("open")]);
  return <CatalogueView entries={entries} version={version} duplicates={duplicates} corrections={corrections} q={q} status={status} />;
}
