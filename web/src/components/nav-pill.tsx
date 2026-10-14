import { Globe2, MessageCircle, Sparkles, Sun, CircleDot } from "lucide-react";
import { motion } from "motion/react";
import { type Page, useNavigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const ITEMS: Array<{ page: Page; label: string; icon: typeof Sun }> = [
  { page: "today", label: "Today", icon: Sun },
  { page: "chat", label: "Chat", icon: MessageCircle },
  { page: "issues", label: "Issues", icon: CircleDot },
  { page: "globe", label: "Globe", icon: Globe2 },
  { page: "ask", label: "Ask", icon: Sparkles },
];

/** Floating pill navigation. The active highlight glides between items. */
export function NavPill() {
  const { page, go } = useNavigation();

  return (
    <nav
      aria-label="Pages"
      className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-pill bg-[#1a1a1d]/85 p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl"
    >
      {ITEMS.map(({ page: item, label, icon: Icon }) => {
        const active = item === page;
        return (
          <button
            key={item}
            onClick={() => go(item)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-12 items-center gap-2 rounded-pill px-5 text-small font-medium transition-colors duration-300",
              active ? "text-black" : "text-muted hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-pill bg-foreground"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <Icon className="relative size-[18px]" />
            <span className="relative max-sm:hidden">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
