"use client";

import { usePathname } from "next/navigation";

import ThemeToggle from "@/components/theme-toggle";

/**
 * Narrow-viewport link sizing. Below 861px the anchors stop being bare inline
 * text and become 44px-tall tap targets — WCAG 2.5.5 wants 44x44, and "About"
 * is only ~39px wide on its own, hence the horizontal padding.
 */
const NAV_LINK_CLASS = [
  "text-text-2 hover:text-accent",
  "max-[860px]:inline-flex max-[860px]:min-h-11 max-[860px]:flex-1",
  "max-[860px]:items-center max-[860px]:justify-center max-[860px]:px-2",
].join(" ");

export default function SiteHeader() {
  const pathname = usePathname();
  const onHome = pathname === "/";
  const section = (hash: string) => (onHome ? hash : `/${hash}`);
  const navLinks = [
    { href: section("#about"), label: "About" },
    { href: section("#projects"), label: "Projects" },
    { href: "/blog", label: "Blog" },
    { href: section("#contact"), label: "Contact" },
  ];

  return (
    <header
      className="pb-pad sticky top-0 z-40 flex flex-wrap items-center justify-between gap-5 border-b border-border px-[44px] py-4 max-[560px]:gap-x-3 max-[560px]:gap-y-0 max-[560px]:py-[10px]"
      style={{
        paddingTop: "calc(16px + env(safe-area-inset-top))",
        background: "color-mix(in srgb, var(--bg) 82%, transparent)",
        backdropFilter: "blur(16px)",
      }}
    >
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-accent font-mono text-[15px] font-semibold text-white shadow">
          PB
        </div>
        {/*
          The wordmark is the first thing to go below 861px: at 320px it wrapped
          onto two lines even with the anchors hidden, and dropping it is what
          frees the room the anchor row needs. The PB mark still brands the header.
        */}
        <span className="font-heading text-[16px] font-semibold tracking-[-0.01em] max-[860px]:hidden">
          Patrick Beasley
        </span>
      </div>

      {/*
        The one-row layout needs ~445px of content width once the anchors are
        44px targets (measured in the browser: brand 36 + nav 187 + toggle/login
        142 + gaps 40 + padding 40). Below that the browser wraps *something*,
        and left to itself it wraps the login button — so below 561px, the same
        breakpoint .pb-pad already uses, `order-1` + `w-full` makes the anchor
        row the thing that drops instead. No hamburger: three anchors on a
        one-pager do not justify a disclosure widget and its state machine.
      */}
      <nav
        id="pb-homelinks"
        className={[
          "flex items-center gap-[22px] text-sm font-medium text-text-2",
          "max-[860px]:gap-1 max-[860px]:text-[13px]",
          "max-[560px]:order-1 max-[560px]:w-full max-[560px]:justify-between",
          "max-[560px]:border-t max-[560px]:border-border",
        ].join(" ")}
      >
        {navLinks.map((link) => (
          <a key={link.href} href={link.href} className={NAV_LINK_CLASS}>
            {link.label}
          </a>
        ))}
      </nav>

      <div className="flex items-center gap-[10px]">
        <ThemeToggle className="h-[38px] w-[38px] rounded-[10px] max-[860px]:h-11 max-[860px]:w-11" />
        {/*
          `whitespace-nowrap` is load-bearing: without it "Login →" broke onto
          two lines at 320px. This is the only route into the dashboard, so it
          keeps its full 44px target at every width.
        */}
        <a
          href="/login?next=%2Fdashboard"
          className="flex h-[38px] cursor-pointer items-center whitespace-nowrap rounded-[10px] bg-accent px-[18px] text-sm font-semibold text-white shadow hover:text-white max-[860px]:h-11"
        >
          Login →
        </a>
      </div>
    </header>
  );
}
