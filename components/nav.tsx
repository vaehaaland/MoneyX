"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";

const ITEMS: { href: string; label: string; icon: IconName; match: (path: string) => boolean }[] = [
  { href: "/", label: "Lån", icon: "bank", match: (p) => p === "/" || p.startsWith("/loans") },
  { href: "/account", label: "Konto", icon: "person", match: (p) => p.startsWith("/account") },
];

/** Bottom navigation bar on phones, navigation rail from tablet width up. */
export function Nav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Hovudmeny"
      className="fixed inset-x-0 bottom-0 z-10 flex h-[calc(5rem+env(safe-area-inset-bottom))] items-start justify-around bg-surface-container pt-3 pb-[env(safe-area-inset-bottom)] md:inset-y-0 md:right-auto md:h-auto md:w-20 md:flex-col md:justify-start md:gap-3 md:bg-surface md:pt-6 md:pb-0"
    >
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="group flex w-20 flex-col items-center gap-1 text-xs font-medium"
          >
            <span
              className={`state-layer flex h-8 w-16 items-center justify-center rounded-full ${
                active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant"
              }`}
            >
              <Icon name={item.icon} />
            </span>
            <span className={active ? "text-on-surface" : "text-on-surface-variant"}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
