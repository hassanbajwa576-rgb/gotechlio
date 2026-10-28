import { notFound } from "next/navigation";
import { getCtx } from "@/lib/ctx";
import { AppError } from "@/server/core";
import { getPayslip } from "@/server/payroll";
import { getSettings } from "@/server/admin";
import { money } from "@/components/Tabs";
import PrintButton from "@/components/PrintButton";

export default async function Slip({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { db, actor } = await getCtx();
  let p;
  try { p = await getPayslip(db, actor, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const cfg = await getSettings(db, actor.companyId);
  const rows: [string, number, boolean?][] = [
    ["Basic salary", p.basic], ["Allowances", p.allowances], [`Unpaid leave (${p.unpaidLeaveDays} days)`, -p.unpaidLeaveDeduction, true],
    ["Gross pay", p.gross], ["Income tax", -p.tax, true], ["Fixed deductions", -p.deductions, true], ["Expense reimbursements", p.reimbursements],
  ];
  return (
    <div className="mx-auto max-w-2xl">
      <div className="card rise" style={{ padding: 28 }}>
        <div className="mb-4 flex items-start justify-between"><div><div className="text-xl font-bold">{cfg.companyName}</div><div className="text-sm" style={{ color: "var(--muted)" }}>Payslip · {p.month}</div></div><PrintButton /></div>
        <div className="mb-4 text-sm"><b>{p.name}</b></div>
        <table className="t"><tbody>
          {rows.map(([l, v]) => <tr key={l}><td>{l}</td><td className="text-right" style={{ color: v < 0 ? "var(--coral)" : undefined }}>{cfg.currency} {money(v)}</td></tr>)}
          <tr><td className="text-lg font-bold">Net pay</td><td className="text-right text-lg font-bold">{cfg.currency} {money(p.net)}</td></tr>
        </tbody></table>
      </div>
    </div>
  );
}
