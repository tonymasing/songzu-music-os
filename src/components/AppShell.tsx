"use client";

import clsx from "clsx";
import {
  AudioLines,
  BrainCircuit,
  ChevronDown,
  Flame,
  Zap,
  Database,
  Menu,
  MonitorSmartphone,
  Music2,
  Network,
  Settings,
  SlidersHorizontal,
  Workflow,
  X
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { PwaRuntime } from "@/components/PwaRuntime";
import { MobileNativeRecorder } from "@/components/MobileNativeRecorder";
import { DawStylesheetGuard as GlobalStylesheetGuard } from "@/components/DawStylesheetGuard";

const navGroups = [
  {
    id: "daily",
    label: "錄音製作",
    description: "錄音、剪輯與混音",
    items: [
      { href: "/daw", label: "DAW 錄音室", description: "錄音、剪輯、混音與輸出", icon: AudioLines }
    ]
  },
  {
    id: "intelligence",
    label: "創作資料",
    description: "參考素材、樂理規則與引擎紀錄",
    items: [
      { href: "/music-db", label: "音樂資料庫", description: "歌曲、樂團與風格參考", icon: Database },
      { href: "/theory", label: "樂理資料", description: "已保存的個人規則", icon: BrainCircuit },
      { href: "/intelligence", label: "音樂智慧核心", description: "引擎狀態與工作紀錄", icon: Network }
    ]
  },
  {
    id: "system",
    label: "系統管理",
    description: "資料維護、裝置整合與系統說明",
    items: [
      { href: "/settings", label: "資料維護", description: "儲存、備份與音檔修復", icon: Settings },
      { href: "/local-app", label: "裝置與整合", description: "連線、安裝與軟體通路", icon: MonitorSmartphone },
      { href: "/system", label: "系統說明", description: "工作台分工與功能規劃", icon: Workflow }
    ]
  }
] as const;

function matchesPath(pathname: string, href: string) {
  if (/^\/songs\/[^/]+\/daw(?:\/|$)/.test(pathname)) return href === "/daw";
  if (pathname === "/audio-repair" || pathname.startsWith("/audio-repair/")) pathname = "/settings";
  if (pathname === "/integrations" || pathname.startsWith("/integrations/")) pathname = "/local-app";
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const publicRoute =
    pathname.startsWith("/listen") ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/confirm-credit/") ||
    pathname.startsWith("/mobile-connect");
  const dawStudioRoute = /^\/songs\/[^/]+\/daw(?:\/|$)/.test(pathname);
  const activeGroup = navGroups.find((group) => group.items.some((item) => matchesPath(pathname, item.href))) ?? navGroups[0];
  const activeItem = activeGroup.items.find((item) => matchesPath(pathname, item.href)) ?? activeGroup.items[0];
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileLayout, setMobileLayout] = useState(false);
  const [workspaceTheme, setWorkspaceTheme] = useState<"professional" | "showcase" | "cyber">("cyber");
  const [online, setOnline] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<string[]>(() =>
    activeGroup.id === "daily" ? ["daily"] : ["daily", activeGroup.id]
  );
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const menuWasOpenRef = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const glassFrameRef = useRef<number | null>(null);
  const glassPointerRef = useRef({ x: 62, y: 24 });
  const [glassRipple, setGlassRipple] = useState<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1100px)");
    const syncLayout = () => setMobileLayout(media.matches);
    syncLayout();
    media.addEventListener("change", syncLayout);
    return () => media.removeEventListener("change", syncLayout);
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("songzu-workspace-theme.v2");
    if (savedTheme === "professional" || savedTheme === "showcase" || savedTheme === "cyber") setWorkspaceTheme(savedTheme);
    setOnline(window.navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setExpandedGroups((current) => (current.includes(activeGroup.id) ? current : [...current, activeGroup.id]));
  }, [activeGroup.id, pathname]);

  useEffect(() => {
    document.body.classList.toggle("nav-drawer-open", menuOpen);
    return () => document.body.classList.remove("nav-drawer-open");
  }, [menuOpen]);

  useEffect(() => {
    if (!mobileLayout) return;

    if (menuOpen) {
      menuWasOpenRef.current = true;
      window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    } else if (menuWasOpenRef.current) {
      menuWasOpenRef.current = false;
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
  }, [menuOpen, mobileLayout]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  useEffect(() => () => {
    if (glassFrameRef.current !== null) window.cancelAnimationFrame(glassFrameRef.current);
  }, []);

  function toggleGroup(id: string) {
    setExpandedGroups((current) =>
      current.includes(id) ? current.filter((groupId) => groupId !== id) : [...current, id]
    );
  }

  function handleGlassPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (dawStudioRoute || workspaceTheme === "professional") return;
    glassPointerRef.current = {
      x: Math.min(100, Math.max(0, (event.clientX / window.innerWidth) * 100)),
      y: Math.min(100, Math.max(0, (event.clientY / window.innerHeight) * 100))
    };
    if (glassFrameRef.current !== null) return;
    glassFrameRef.current = window.requestAnimationFrame(() => {
      shellRef.current?.style.setProperty("--app-glass-x", `${glassPointerRef.current.x}%`);
      shellRef.current?.style.setProperty("--app-glass-y", `${glassPointerRef.current.y}%`);
      glassFrameRef.current = null;
    });
  }

  function handleGlassPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (dawStudioRoute || workspaceTheme === "professional" || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (!target.closest("a, button, input, textarea, select, .panel")) return;
    setGlassRipple({ id: Date.now(), x: event.clientX, y: event.clientY });
  }

  if (publicRoute) {
    return (
      <div className="public-app-shell">
        {children}
        <PwaRuntime />
      </div>
    );
  }

  return (
    <>
      {/* The DAW mounts its own guard; OS pages need the same global CSS recovery. */}
      {!dawStudioRoute ? <GlobalStylesheetGuard /> : null}
      <a className="skip-link" href="#main-content">跳到主要內容</a>
      <header className={clsx("mobile-appbar", dawStudioRoute ? "daw-mobile-appbar" : "fire-glass-appbar", workspaceTheme === "cyber" && "os-cyber-appbar")}>
        <button
          ref={menuButtonRef}
          className="mobile-menu-button"
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="開啟功能選單"
          aria-expanded={menuOpen}
          aria-controls="app-navigation-drawer"
        >
          <Menu size={20} />
        </button>
        <span className="mobile-route-copy">
          <small>{activeGroup.label}</small>
          <strong>{activeItem.label}</strong>
        </span>
        <Link className="mobile-brand-mark" href="/daw" aria-label="回 DAW 錄音室">
          <Music2 size={17} />
        </Link>
      </header>

      <div
        ref={shellRef}
        className={clsx(
          "app-shell",
          dawStudioRoute ? "daw-app-shell" : "fire-glass-shell",
          !dawStudioRoute && `workspace-${workspaceTheme}`,
          workspaceTheme === "cyber" && "os-cyber"
        )}
        onPointerMove={handleGlassPointerMove}
        onPointerDown={handleGlassPointerDown}
      >
        {!dawStudioRoute ? <span className="fire-glass-atmosphere" aria-hidden="true" /> : null}
        {glassRipple ? (
          <span
            className="fire-glass-ripple"
            key={glassRipple.id}
            style={{ left: glassRipple.x, top: glassRipple.y }}
            aria-hidden="true"
          />
        ) : null}
        <button
          className={clsx("sidebar-overlay", menuOpen && "visible")}
          type="button"
          aria-label="關閉功能選單"
          onClick={() => setMenuOpen(false)}
        />

        <aside
          id="app-navigation-drawer"
          className={clsx("sidebar", menuOpen && "open")}
          aria-label="功能選單"
          aria-hidden={mobileLayout && !menuOpen ? true : undefined}
          aria-modal={mobileLayout ? true : undefined}
          role={mobileLayout ? "dialog" : undefined}
          inert={mobileLayout && !menuOpen}
        >
          <div className="sidebar-brand-row">
            <Link className="brand" href="/daw" onClick={() => setMenuOpen(false)}>
              <span className="brand-mark">
                <Music2 size={18} />
              </span>
              <span className="brand-text">
                <strong>頌祖音樂 OS</strong>
                <span>本機音樂製作系統</span>
              </span>
            </Link>
            <button
              ref={closeButtonRef}
              className="sidebar-close"
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="關閉功能選單"
            >
              <X size={19} />
            </button>
          </div>

          <nav className="nav-list" aria-label="主要導覽">
            {navGroups.map((group) => {
              const expanded = expandedGroups.includes(group.id);
              const groupActive = group.id === activeGroup.id;
              return (
                <section className={clsx("nav-group", groupActive && "active")} key={group.id}>
                  <button
                    className="nav-group-toggle"
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggleGroup(group.id)}
                  >
                    <span>
                      <strong>{group.label}</strong>
                      <small>{group.description}</small>
                    </span>
                    <ChevronDown className={clsx(expanded && "rotated")} size={16} />
                  </button>
                  {expanded ? (
                    <div className="nav-group-items">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = matchesPath(pathname, item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={clsx("nav-link", active && "active")}
                            aria-current={active ? "page" : undefined}
                            onClick={() => setMenuOpen(false)}
                          >
                            <Icon size={17} />
                            <span className="nav-link-copy">
                              <strong>{item.label}</strong>
                              <small>{item.description}</small>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </nav>

          <div className="workspace-theme-control" role="group" aria-label="工作區視覺模式">
            <span>視覺模式</span>
            <div>
              <button
                className={workspaceTheme === "professional" ? "active" : ""}
                type="button"
                onClick={() => {
                  setWorkspaceTheme("professional");
                  window.localStorage.setItem("songzu-workspace-theme.v2", "professional");
                }}
                aria-pressed={workspaceTheme === "professional"}
                title="專業工作模式"
              >
                <SlidersHorizontal size={15} />
                專業
              </button>
              <button
                className={workspaceTheme === "showcase" ? "active" : ""}
                type="button"
                onClick={() => {
                  setWorkspaceTheme("showcase");
                  window.localStorage.setItem("songzu-workspace-theme.v2", "showcase");
                }}
                aria-pressed={workspaceTheme === "showcase"}
                title="烈火展示模式"
              >
                <Flame size={15} />
                烈火
              </button>
              <button
                className={workspaceTheme === "cyber" ? "active" : ""}
                type="button"
                onClick={() => {
                  setWorkspaceTheme("cyber");
                  window.localStorage.setItem("songzu-workspace-theme.v2", "cyber");
                }}
                aria-pressed={workspaceTheme === "cyber"}
                title="賽博霓虹模式"
              >
                <Zap size={15} />
                賽博
              </button>
            </div>
          </div>

          <Link className="sidebar-status" href="/settings" onClick={() => setMenuOpen(false)}>
            <span className="status-dot" />
            <span>
              <strong>本機優先</strong>
              <small>原始音檔與資料保持私有</small>
            </span>
          </Link>
        </aside>

        <main id="main-content" tabIndex={-1} className={clsx("main", dawStudioRoute && "daw-main")}>{children}</main>
        {!dawStudioRoute ? (
          <nav className="mobile-primary-nav" aria-label="手機主要功能">
            <Link className={matchesPath(pathname, "/daw") ? "active" : ""} href="/daw" aria-current={matchesPath(pathname, "/daw") ? "page" : undefined}>
              <AudioLines size={19} /><span>錄音</span>
            </Link>
            <Link className={matchesPath(pathname, "/music-db") ? "active" : ""} href="/music-db" aria-current={matchesPath(pathname, "/music-db") ? "page" : undefined}>
              <Database size={19} /><span>資料庫</span>
            </Link>
            <Link className={matchesPath(pathname, "/intelligence") ? "active" : ""} href="/intelligence" aria-current={matchesPath(pathname, "/intelligence") ? "page" : undefined}>
              <Network size={19} /><span>引擎</span>
            </Link>
            <button type="button" onClick={() => setMenuOpen(true)} aria-label="開啟更多功能">
              <Menu size={19} /><span>更多</span>
            </button>
          </nav>
        ) : null}
        {!online ? <div className="app-runtime-banner" role="status">目前離線，本機資料仍可使用；外部發布與同步會暫停。</div> : null}
        <MobileNativeRecorder />
        <PwaRuntime />
      </div>
    </>
  );
}
