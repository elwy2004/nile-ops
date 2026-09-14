"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const on = path === href || path.startsWith(href + "/");
  return <Link href={href} className={on ? "on" : undefined}>{children}</Link>;
}
