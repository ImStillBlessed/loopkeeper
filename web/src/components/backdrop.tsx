import { motion, useReducedMotion } from "motion/react";
import { COLORS } from "@/lib/palette";

/**
 * The quiet background behind every page:
 * - a dot grid that only shows towards the edges, so the reading area stays clean
 * - two slow, soft glows in the brand colours
 * - a large thin loop half off-screen with a small dot travelling round it (the logo, writ large)
 */
export function Backdrop() {
  const reduceMotion = useReducedMotion();
  const drift = (x: number[], y: number[], duration: number) =>
    reduceMotion ? {} : { animate: { x, y }, transition: { duration, repeat: Infinity, repeatType: "mirror" as const, ease: "easeInOut" as const } };

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1.4px)",
          backgroundSize: "30px 30px",
          maskImage: "radial-gradient(ellipse 60% 70% at 50% 45%, transparent 35%, black 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 60% 70% at 50% 45%, transparent 35%, black 100%)",
        }}
      />

      <motion.div
        className="absolute -top-48 -left-40 size-[620px] rounded-full blur-[140px]"
        style={{ backgroundColor: COLORS.lilac, opacity: 0.13 }}
        {...drift([0, 80, 20], [0, 40, 90], 28)}
      />
      <motion.div
        className="absolute -right-48 -bottom-56 size-[560px] rounded-full blur-[150px]"
        style={{ backgroundColor: COLORS.sunflower, opacity: 0.07 }}
        {...drift([0, -60, -10], [0, -50, -20], 34)}
      />

      <svg className="absolute -bottom-[340px] -left-[260px] size-[760px]" viewBox="0 0 760 760">
        <circle cx="380" cy="380" r="300" fill="none" stroke={COLORS.lilac} strokeOpacity="0.09" strokeWidth="2" />
        <circle cx="380" cy="380" r="300" fill="none" stroke={COLORS.lilac} strokeOpacity="0.05" strokeWidth="1" strokeDasharray="2 10" transform="scale(1.12) translate(-41 -41)" />
        {/* SVG's own rotate takes the centre explicitly (380, 380), so the dot stays on the ring. */}
        <g>
          <circle cx="592" cy="168" r="9" fill={COLORS.sunflower} fillOpacity="0.55" />
          {!reduceMotion && <animateTransform attributeName="transform" type="rotate" from="0 380 380" to="360 380 380" dur="90s" repeatCount="indefinite" />}
        </g>
      </svg>
    </div>
  );
}
