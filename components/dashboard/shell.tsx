"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import ThemeToggle from "@/components/theme-toggle";
import {
  DocIcon,
  FeedIcon,
  GearIcon,
  HomeIcon,
  LinkIcon,
  MenuIcon,
  NoteIcon,
  OverviewIcon,
  PenIcon,
  TaskIcon,
  WorkIcon,
} from "@/components/dashboard/icons";
import { useWorkspace, type Workspace } from "@/components/dashboard/workspace-context";

export type DashboardSection = "overview" | "links" | "notes" | "tasks" | "documents" | "feeds" | "blog" | "settings";

/** Per-section badge counts. Sections without a count render no badge. */
export type DashboardCounts = Partial<Record<DashboardSection, number>>;

interface NavEntry {
  key: DashboardSection;
  label: string;
  href: string;
  Icon: ({ size }: { size?: number }) => React.ReactElement;
  /**
   * The bottom tab bar carries the content sections only (Settings stays
   * sidebar-only). Overview and Tasks post-date the design's original four;
   * six tabs.
   */
  inTabBar: boolean;
}

const NAV_ENTRIES: NavEntry[] = [
  { key: "overview", label: "Overview", href: "/dashboard", Icon: OverviewIcon, inTabBar: true },
  { key: "links", label: "Links", href: "/dashboard/links", Icon: LinkIcon, inTabBar: true },
  { key: "notes", label: "Notes", href: "/dashboard/notes", Icon: NoteIcon, inTabBar: true },
  { key: "tasks", label: "Tasks", href: "/dashboard/tasks", Icon: TaskIcon, inTabBar: true },
  { key: "documents", label: "Documents", href: "/dashboard/documents", Icon: DocIcon, inTabBar: true },
  { key: "feeds", label: "Feeds", href: "/dashboard/feeds", Icon: FeedIcon, inTabBar: true },
  { key: "blog", label: "Blog", href: "/dashboard/blog", Icon: PenIcon, inTabBar: false },
  { key: "settings", label: "Settings", href: "/dashboard/settings", Icon: GearIcon, inTabBar: false },
];

const WORKSPACES: { key: Workspace; label: string; Icon: ({ size }: { size?: number }) => React.ReactElement }[] = [
  { key: "work", label: "Work", Icon: WorkIcon },
  { key: "home", label: "Home", Icon: HomeIcon },
];

function navItemClass(active: boolean) {
  return [
    "flex w-full items-center justify-between gap-2 rounded-[10px] px-3 py-[10px] text-sm",
    active ? "bg-accent-soft font-semibold text-accent" : "bg-transparent font-medium text-text-2",
  ].join(" ");
}

function tabItemClass(active: boolean) {
  return [
    "flex flex-1 flex-col items-center gap-[3px] px-[2px] py-[6px]",
    active ? "text-accent" : "text-muted",
  ].join(" ");
}

const FOOTER_LINK_CLASS =
  "flex h-[38px] items-center rounded-[9px] border border-border bg-transparent px-3 text-[13px] font-medium text-text-2";

export default function DashboardShell({
  children,
  counts,
}: {
  children: React.ReactNode;
  counts?: DashboardCounts;
}) {
  const pathname = usePathname();
  const { workspace, setWorkspace } = useWorkspace();
  const [navOpen, setNavOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  // Overview's href is the section root, so it must match exactly — the
  // prefix rule would light it for every section.
  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname.startsWith(`${href}/`);
  const activeEntry = NAV_ENTRIES.find((entry) => isActive(entry.href));
  const sectionTitle = activeEntry?.label ?? "Dashboard";

  // Closing always parks focus on the burger: the drawer becomes
  // `visibility: hidden`, so whatever was focused inside it would otherwise be
  // dropped to <body> behind the scrim.
  const closeNav = useCallback(() => {
    setNavOpen(false);
    burgerRef.current?.focus();
  }, []);

  /*
   * Touch gestures — swipe-to-switch-workspace and pull-to-refresh — are
   * deliberately absent, deferred to a post-launch release.
   *
   * A swipe implementation shipped in f7386c1 and was removed after failing on
   * a real phone. It passed twelve synthetic-pointer-event cases because those
   * bypass the browser's gesture arbitration entirely, which is precisely the
   * mechanism that broke it: with `touch-action` left at its default, the
   * browser owns panning on both axes, claims any touch drag, and fires
   * `pointercancel` before `pointerup` — so the handler always bailed. The
   * comment justifying that choice ("nothing changes touch-action, so ordinary
   * scrolling is untouched") described the very reason it could not work.
   *
   * Whoever picks this up: set `touch-action: pan-y` on this container so the
   * browser keeps vertical panning and yields the horizontal axis, and verify
   * on real touch hardware — synthetic events cannot prove this.
   *
   * Pull-to-refresh has a separate obstacle worth knowing: `globals.css` sets
   * `overscroll-behavior-y: none` on body, which already suppresses the
   * browser's native pull-to-refresh site-wide. Scoping that declaration is
   * likely the cheaper fix than any JS.
   */

  useEffect(() => {
    if (!navOpen) {
      return;
    }

    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNavOpen(false);
        burgerRef.current?.focus();
        return;
      }

      // The scrim makes the drawer modal, so Tab has to stay inside it —
      // otherwise focus walks onto the covered page with nothing to show for it.
      if (event.key !== "Tab" || !sidebarRef.current) {
        return;
      }

      const focusable = sidebarRef.current.querySelectorAll<HTMLElement>("a[href], button");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  /*
   * The entry animation lives on <main>, not on the outer element. The design
   * prototype puts `animation: pbUp .4s ease both` on the outer flex container,
   * but `animation-fill-mode: both` leaves a transform applied forever, and a
   * transformed ancestor becomes the containing block for every
   * `position: fixed` descendant. That silently re-anchored the mobile drawer,
   * its scrim and the bottom tab bar to the *document* instead of the viewport:
   * on a dashboard page taller than the screen, scrolling down carried the tab
   * bar away with it, and opening the drawer dimmed the screen with the drawer
   * itself parked off-screen above. Measured at 375px scrolled to y=1200
   * (viewport 667): tab bar at top:1884, drawer at top:-1200.
   */
  return (
    <div data-ctx={workspace} className="flex min-h-dvh">
      {navOpen ? (
        <div
          id="pb-scrim"
          aria-hidden="true"
          onClick={closeNav}
          className="fixed inset-0 z-[55] bg-[rgba(6,8,12,0.5)] min-[861px]:hidden"
        />
      ) : null}

      <aside
        id="pb-sidebar"
        ref={sidebarRef}
        data-open={navOpen}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
        className={[
          "sticky top-0 flex h-dvh w-[264px] flex-none flex-col border-r border-border bg-surface",
          "max-[860px]:fixed max-[860px]:inset-y-0 max-[860px]:left-0 max-[860px]:z-[60]",
          "max-[860px]:invisible max-[860px]:-translate-x-full max-[860px]:shadow-lg",
          // Tailwind v4's translate utilities set the `translate` property, not
          // `transform` — transitioning "transform" here would slide nothing.
          "max-[860px]:transition-[translate,visibility] max-[860px]:duration-[280ms] max-[860px]:ease-out",
          "max-[860px]:data-[open=true]:visible max-[860px]:data-[open=true]:translate-x-0",
          "motion-reduce:transition-none",
        ].join(" ")}
      >
        <div className="flex items-center gap-[10px] px-[18px] pt-5 pb-[14px]">
          <div className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-accent font-mono text-sm font-semibold text-white">
            PB
          </div>
          <div className="flex-1 font-heading text-[15px] font-semibold">Dashboard</div>
          <button
            ref={closeRef}
            type="button"
            onClick={closeNav}
            aria-label="Close navigation"
            title="Close"
            className="hidden h-8 w-8 cursor-pointer place-items-center rounded-lg border border-border bg-transparent text-base leading-none text-muted max-[860px]:grid"
          >
            ×
          </button>
        </div>

        <div className="px-[14px] pb-[14px]">
          <div
            role="group"
            aria-label="Workspace"
            className="flex gap-[3px] rounded-[11px] border border-border bg-surface-2 p-[3px]"
          >
            {WORKSPACES.map(({ key, label, Icon }) => {
              const on = workspace === key;

              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setWorkspace(key)}
                  className={[
                    "flex h-[34px] flex-1 cursor-pointer items-center justify-center gap-[7px] whitespace-nowrap rounded-[9px] px-[14px] text-[13px] font-semibold",
                    on ? "bg-surface text-accent shadow" : "bg-transparent text-muted",
                  ].join(" ")}
                >
                  <Icon />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <nav
          aria-label="Dashboard sections"
          className="flex flex-1 flex-col gap-[3px] px-3 py-2"
        >
          {NAV_ENTRIES.map(({ key, label, href, Icon }) => {
            const active = isActive(href);
            const count = counts?.[key];

            return (
              <Link
                key={key}
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={closeNav}
                className={navItemClass(active)}
              >
                <span className="flex items-center gap-[11px]">
                  <Icon />
                  <span>{label}</span>
                </span>
                {count === undefined ? null : (
                  <span className="font-mono text-[11px] opacity-60">{count}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-col gap-2 border-t border-border p-[14px]">
          <Link href="/" className={`${FOOTER_LINK_CLASS} mt-1.5`}>
            ← Back to site
          </Link>
          {/*
            Deliberately a plain <a>: /auth/logout is a GET route handler that
            signs the session out, and next/link would prefetch it — logging the
            owner out just by rendering the sidebar. `next` matches the route's
            own convention (it defaults to "/").
          */}
          <a href="/auth/logout?next=%2F" className={FOOTER_LINK_CLASS}>
            Log out
          </a>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col animate-[pbUp_0.4s_ease_both] motion-reduce:animate-none max-[860px]:pb-24">
        <header
          className="pb-pad sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 border-b border-border px-8 py-[14px]"
          style={{
            paddingTop: "calc(14px + env(safe-area-inset-top))",
            background: "color-mix(in srgb, var(--bg) 84%, transparent)",
            backdropFilter: "blur(16px)",
          }}
        >
          <div className="flex min-w-0 items-center gap-[14px]">
            <button
              ref={burgerRef}
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
              aria-controls="pb-sidebar"
              aria-expanded={navOpen}
              title="Menu"
              className="hidden h-10 w-10 cursor-pointer place-items-center rounded-[11px] border border-border bg-surface text-text max-[860px]:grid"
            >
              <MenuIcon />
            </button>
            <div>
              <div className="font-mono text-[11px] tracking-[0.06em] text-accent">
                {workspace === "work" ? "WORK" : "HOME"} WORKSPACE
              </div>
              <h1 className="mt-0.5 font-heading text-[26px] font-semibold tracking-[-0.02em] max-[860px]:text-[22px]">
                {sectionTitle}
              </h1>
            </div>
          </div>

          <ThemeToggle className="h-10 w-10 flex-none rounded-[11px]" />
        </header>

        <div className="pb-pad flex max-w-[1080px] flex-1 flex-col gap-5 px-8 py-6">{children}</div>
      </main>

      <nav
        aria-label="Dashboard sections (compact)"
        style={{
          paddingBottom: "calc(8px + env(safe-area-inset-bottom))",
          background: "color-mix(in srgb, var(--surface) 92%, transparent)",
          backdropFilter: "blur(20px)",
        }}
        className="fixed inset-x-0 bottom-0 z-50 hidden items-stretch justify-around gap-[2px] border-t border-border px-[10px] pt-2 max-[860px]:flex"
      >
        {NAV_ENTRIES.filter((entry) => entry.inTabBar).map(({ key, label, href, Icon }) => {
          const active = isActive(href);

          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? "page" : undefined}
              className={tabItemClass(active)}
            >
              <Icon />
              <span className="text-[10px] font-semibold">{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
