import { requireCtx } from "@/server/context";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { checkIn, markSupportSeen, supportInbox } from "@/domain/system/licence";
import { HelpView } from "./view";

export const metadata = { title: "Help & support" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!ctx.readOnly) await checkIn(ctx.tenantId, { minAgeMs: 10 * 60_000, timeoutMs: 4000 });
  const inbox = await supportInbox(ctx.tenantId);
  if (!ctx.readOnly && inbox.unread) await markSupportSeen(ctx.tenantId);
  return (
    <>
      <PageHead title={t(ctx.lang).help} sub="Ask Medoro support. Replies from the team appear here." />
      <HelpView inbox={inbox} canWrite={!ctx.readOnly} />
    </>
  );
}
