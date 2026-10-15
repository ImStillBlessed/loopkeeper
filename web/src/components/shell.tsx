import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { FastForward, LogOut, Menu, Moon, Pause, Play, Sun, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAuth, useUser } from "@/lib/auth";
import { formatDateTime, formatTime } from "@/lib/format";
import { useLive } from "@/lib/live";
import { PAGE_GROUPS, TILE } from "@/lib/pages";
import { ROLE } from "@/lib/palette";
import { href, useRoute } from "@/lib/router";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Wordmark } from "./brand";
import { Avatar } from "./desk";
import { Button } from "./ui/button";

/** The signed-in frame: a white sidebar with coloured page icons, and a slim top bar with the chat clock. */
export function Shell({ children, badges }: { children: ReactNode; badges: Partial<Record<string, number>> }) {
  const route = useRoute();
  const current = route.path[0] ?? "overview";
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-full">
      {/* Sidebar (a drawer on small screens) */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-line-soft bg-card transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0 shadow-float" : "-translate-x-full",
        )}
      >
        <div className="flex h-22 items-center justify-between px-6">
          <a href={href("overview")} onClick={() => setOpen(false)}>
            <Wordmark />
          </a>
          <button className="text-muted lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
          {PAGE_GROUPS.map((section) => (
            <div key={section.group} className="mb-6">
              <div className="mb-2 px-3 text-[12px] font-semibold text-faint">{section.group}</div>
              <div className="flex flex-col gap-0.5">
                {section.pages.map((page) => {
                  const active = current === page.id;
                  const badge = badges[page.id];
                  return (
                    <a
                      key={page.id}
                      href={href(page.id)}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-10 items-center gap-3 rounded-xl px-2 text-[14.5px] font-medium transition-colors",
                        active ? "bg-primary-soft text-primary" : "text-ink-2 hover:bg-paper",
                      )}
                    >
                      <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", active ? "bg-primary text-white" : TILE[page.tone])}>
                        <page.icon className="size-4" strokeWidth={2} />
                      </span>
                      <span className="flex-1">{page.label}</span>
                      {badge ? <span className="rounded-full bg-red px-2 py-0.5 text-[11.5px] font-semibold text-white tabular">{badge}</span> : null}
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <UserBlock />
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-[rgb(14_31_85/0.3)] lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setOpen(true)} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function UserBlock() {
  const user = useUser();
  const { logOut } = useAuth();
  return (
    <div className="m-3 flex items-center gap-3 rounded-2xl bg-paper px-3 py-3">
      <Avatar name={user.name} staff />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[14px] font-semibold">{user.name}</div>
        <div className="text-[12.5px] text-muted">{ROLE[user.role]}</div>
      </div>
      <button onClick={logOut} className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-card hover:text-red" aria-label="Log out" title="Log out">
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

/** The chat clock, the live demo controls and the theme toggle. */
function TopBar({ onMenu }: { onMenu: () => void }) {
  const live = useLive();
  const [theme, toggleTheme] = useTheme();

  return (
    <div className="sticky top-0 z-20 border-b border-line-soft bg-card/85 backdrop-blur-md">
      <div className="flex h-16 items-center gap-2 px-4 sm:h-18 sm:gap-3 sm:px-9 lg:px-12">
        <button className="grid size-9 shrink-0 place-items-center rounded-xl border border-line lg:hidden" onClick={onMenu} aria-label="Open menu">
          <Menu className="size-4.5" />
        </button>

        <div className={cn("flex min-w-0 items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5 sm:gap-3 sm:pr-4 sm:pl-2", live.running ? "bg-green-soft" : "bg-paper")}>
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", live.running ? "bg-green text-white" : "bg-card text-muted")} aria-hidden>
            <span className={cn("size-2 rounded-full", live.running ? "animate-[pulse-dot_1.6s_ease-in-out_infinite] bg-white" : "bg-faint")} />
          </span>
          <div className="min-w-0 leading-tight">
            <div className={cn("hidden text-[11.5px] font-semibold sm:block", live.running ? "text-green" : "text-muted")}>{live.running ? "WhatsApp groups live" : "Chat time"}</div>
            <div className="truncate text-[13.5px] font-semibold tabular">
              <span className="hidden sm:inline">{formatDateTime(live.clock)}</span>
              <span className="sm:hidden">{formatTime(live.clock)}</span>
            </div>
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {live.running ? (
            <Button variant="outline" size="sm" onClick={live.pause}>
              <Pause /> <span className="hidden sm:inline">Pause</span>
            </Button>
          ) : (
            <Button size="sm" onClick={live.goLive} title="The simulated WhatsApp groups start chatting">
              <Play /> <span className="hidden sm:inline">Go live</span>
            </Button>
          )}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="outline" size="sm" aria-label="Fast-forward the chat clock">
                <FastForward /> <span className="hidden sm:inline">Skip ahead</span>
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-52 rounded-xl border border-line bg-card p-1.5 shadow-float">
                <div className="px-3 pt-2 pb-1.5 text-[12.5px] font-semibold text-muted">Move the chat clock</div>
                {[
                  { hours: 2, label: "2 hours later" },
                  { hours: 6, label: "6 hours later" },
                  { hours: 24, label: "Next day" },
                  { hours: 72, label: "3 days later" },
                ].map((step) => (
                  <DropdownMenu.Item key={step.hours} onSelect={() => live.advanceClock(step.hours)} className="cursor-pointer rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-paper">
                    {step.label}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <button
            onClick={toggleTheme}
            className="grid size-9 place-items-center rounded-xl border border-line text-muted transition-colors hover:bg-paper hover:text-ink"
            aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </div>
      {live.error && (
        <div className="flex items-center gap-4 border-t border-red/20 bg-red-soft px-5 py-2.5 text-[13.5px] text-red sm:px-9 lg:px-12">
          <span className="flex-1">{live.error}</span>
          <button onClick={live.dismissError} className="font-semibold underline-offset-4 hover:underline">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
