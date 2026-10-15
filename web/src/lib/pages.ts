import {
  Boxes,
  Building2,
  ChartColumn,
  LayoutDashboard,
  MessageCircleQuestion,
  MessagesSquare,
  Orbit,
  Settings,
  Ticket,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import type { Tone } from "./palette";

export interface PageMeta {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The page's own colour: its icon tile in the sidebar and the header. */
  tone: Tone;
}

/** Every page of the desk, grouped as in the sidebar. */
export const PAGE_GROUPS: Array<{ group: string; pages: PageMeta[] }> = [
  {
    group: "Desk",
    pages: [
      { id: "overview", label: "Overview", icon: LayoutDashboard, tone: "blue" },
      { id: "tickets", label: "Tickets", icon: Ticket, tone: "red" },
      { id: "clients", label: "Clients", icon: Building2, tone: "violet" },
      { id: "conversations", label: "Conversations", icon: MessagesSquare, tone: "green" },
      { id: "ask", label: "Ask", icon: MessageCircleQuestion, tone: "sky" },
    ],
  },
  {
    group: "Insight",
    pages: [
      { id: "patterns", label: "Patterns", icon: Waypoints, tone: "red" },
      { id: "analytics", label: "Analytics", icon: ChartColumn, tone: "amber" },
      { id: "network", label: "Network", icon: Orbit, tone: "violet" },
    ],
  },
  {
    group: "Company",
    pages: [
      { id: "products", label: "Products", icon: Boxes, tone: "sky" },
      { id: "settings", label: "Settings", icon: Settings, tone: "neutral" },
    ],
  },
];

export function pageMeta(id: string): PageMeta | undefined {
  return PAGE_GROUPS.flatMap((g) => g.pages).find((p) => p.id === id);
}

/** Soft tile + strong icon colour for each tone. */
export const TILE: Record<Tone, string> = {
  blue: "bg-primary-soft text-primary",
  red: "bg-red-soft text-red",
  violet: "bg-violet-soft text-violet",
  green: "bg-green-soft text-green",
  sky: "bg-sky-soft text-sky",
  amber: "bg-amber-soft text-amber",
  neutral: "bg-paper-2 text-ink-2",
  navy: "bg-ink text-card",
};
