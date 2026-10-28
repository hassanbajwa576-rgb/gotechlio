"use client";

export default function PrintButton() {
  return <button className="btn btn-sm print:hidden" onClick={() => window.print()}>Print</button>;
}
