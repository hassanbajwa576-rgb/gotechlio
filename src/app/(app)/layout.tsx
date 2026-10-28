import Shell from "@/components/Shell";
import { companiesFor, getCtx } from "@/lib/ctx";
import { inbox } from "@/server/requests";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, actor, accountId } = await getCtx();
  const [badge, companies] = await Promise.all([inbox(db, actor).then((r) => r.length), companiesFor(db, accountId)]);
  return <Shell actor={actor} badge={badge} companies={companies}>{children}</Shell>;
}
