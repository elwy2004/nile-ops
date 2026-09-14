"use client";

export default function PrintButton() {
  return (
    <button className="btn btn-go btn-sm" type="button" onClick={() => window.print()}>
      Print vouchers
    </button>
  );
}
