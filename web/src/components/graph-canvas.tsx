import { forceX, forceY } from "d3-force-3d";
import ForceGraph from "force-graph";
import { useEffect, useRef, type RefObject } from "react";
import type { ExploreLink, ExploreNode } from "@/lib/api";

/** A node as the layout holds it (the library adds positions). */
type DrawNode = ExploreNode & { x?: number; y?: number };
type DrawLink = Omit<ExploreLink, "source" | "target"> & { source: number | DrawNode; target: number | DrawNode };

/** Zooms the graph in, out, or to fit everything. */
export type ZoomAction = "in" | "out" | "fit";

export interface GraphControls {
  zoom: (action: ZoomAction) => void;
}

export type Selection = { kind: "node"; node: ExploreNode } | { kind: "link"; link: ExploreLink } | undefined;

const RADIUS = 5;
const endId = (end: number | DrawNode) => (typeof end === "number" ? end : end.id);
const isDark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);

/**
 * A query result drawn as a flat force-directed graph, like FalkorDB Browser: nodes coloured by
 * label with their names, arrows on relationships, and the selected node lit up with its neighbours.
 */
export function GraphCanvas({
  nodes,
  links,
  colorOf,
  selected,
  onSelect,
  onExpand,
  controls,
}: {
  nodes: ExploreNode[];
  links: ExploreLink[];
  colorOf: (label: string) => string;
  selected: Selection;
  onSelect: (selection: Selection) => void;
  /** Double-click a node: load its neighbours too. */
  onExpand: (node: ExploreNode) => void;
  /** Filled in with the zoom buttons' actions. */
  controls?: RefObject<GraphControls | undefined>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraph<DrawNode, DrawLink>>(undefined);
  const lit = useRef<{ nodes: Set<number>; links: Set<number> } | undefined>(undefined);
  // A new result is fitted to the screen once its layout has settled.
  const fitPending = useRef(false);
  // Few enough nodes that every name fits on screen.
  const few = useRef(false);
  const callbacks = useRef({ onSelect, onExpand, colorOf });
  callbacks.current = { onSelect, onExpand, colorOf };

  // The canvas is created once; data and selection are passed in below.
  useEffect(() => {
    if (!host.current) return;
    let lastClick = { id: -1, at: 0 };
    const instance = new ForceGraph<DrawNode, DrawLink>(host.current)
      .backgroundColor("rgba(0,0,0,0)")
      .nodeRelSize(RADIUS)
      .nodeLabel((n) => `${n.label}: ${n.caption}`)
      .nodeCanvasObject((node, ctx, scale) => {
        const dim = lit.current && !lit.current.nodes.has(node.id);
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        ctx.globalAlpha = dim ? 0.18 : 1;
        ctx.beginPath();
        ctx.arc(x, y, RADIUS, 0, 2 * Math.PI);
        ctx.fillStyle = callbacks.current.colorOf(node.label);
        ctx.fill();
        if (lit.current?.nodes.has(node.id) && lit.current.nodes.size > 0) {
          ctx.lineWidth = 1.5 / scale;
          ctx.strokeStyle = isDark() ? "#ffffff" : "#0e1f55";
          ctx.stroke();
        }
        // Names: all of them for a small result, otherwise once zoomed in, or around the selection.
        if (few.current || scale > 2.6 || (lit.current?.nodes.has(node.id) ?? false)) {
          const size = Math.max(10 / scale, 2.4);
          ctx.font = `500 ${size}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = isDark() ? "#e7ebf5" : "#0e1f55";
          const text = node.caption.length > 28 ? `${node.caption.slice(0, 27)}…` : node.caption;
          ctx.fillText(text, x, y + RADIUS + 1.5);
        }
        ctx.globalAlpha = 1;
      })
      .nodePointerAreaPaint((node, color, ctx) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x ?? 0, node.y ?? 0, RADIUS + 2, 0, 2 * Math.PI);
        ctx.fill();
      })
      .linkColor((link) => {
        const on = !lit.current || lit.current.links.has(link.id);
        if (isDark()) return on ? "rgba(231,235,245,0.45)" : "rgba(231,235,245,0.06)";
        return on ? "rgba(14,31,85,0.35)" : "rgba(14,31,85,0.05)";
      })
      .linkWidth((link) => (lit.current?.links.has(link.id) ? 1.6 : 0.8))
      .linkDirectionalArrowLength(3.5)
      .linkDirectionalArrowRelPos(1)
      .linkLabel((link) => link.type)
      .cooldownTicks(120)
      .onEngineStop(() => {
        if (!fitPending.current) return;
        fitPending.current = false;
        instance.zoomToFit(400, 60);
      })
      .onNodeClick((node) => {
        const now = Date.now();
        if (lastClick.id === node.id && now - lastClick.at < 350) callbacks.current.onExpand(strip(node));
        lastClick = { id: node.id, at: now };
        callbacks.current.onSelect({ kind: "node", node: strip(node) });
      })
      .onLinkClick((link) =>
        callbacks.current.onSelect({ kind: "link", link: { id: link.id, type: link.type, source: endId(link.source), target: endId(link.target), properties: link.properties } }),
      )
      .onBackgroundClick(() => callbacks.current.onSelect(undefined));
    // A gentle pull to the middle, so nodes with no relationships don't drift off screen.
    instance.d3Force("x", forceX(0).strength(0.06)).d3Force("y", forceY(0).strength(0.06));
    graph.current = instance;
    if (controls) {
      controls.current = {
        zoom: (action) => (action === "fit" ? instance.zoomToFit(400, 60) : instance.zoom(instance.zoom() * (action === "in" ? 1.4 : 1 / 1.4), 200)),
      };
    }

    const resize = new ResizeObserver(([entry]) => instance.width(entry.contentRect.width).height(entry.contentRect.height));
    resize.observe(host.current);
    return () => {
      resize.disconnect();
      instance._destructor();
    };
  }, []);

  // New data: keep the positions of nodes already on screen, so expanding doesn't scramble the layout.
  useEffect(() => {
    const instance = graph.current;
    if (!instance) return;
    few.current = nodes.length <= 40;
    const previous = new Map(instance.graphData().nodes.map((n) => [n.id, n]));
    const fresh = nodes.map((n) => {
      const old = previous.get(n.id);
      return old ? Object.assign(old, n) : { ...n };
    });
    instance.graphData({ nodes: fresh, links: links.map((l) => ({ ...l })) });
    if (previous.size === 0 || ![...previous.keys()].some((id) => nodes.some((n) => n.id === id))) {
      fitPending.current = true;
      // In case the layout is still drifting when the engine reports it has stopped.
      const timer = window.setTimeout(() => instance.zoomToFit(400, 60), 2500);
      return () => window.clearTimeout(timer);
    }
  }, [nodes, links]);

  // Selection: light up the node and its neighbours, or the relationship and its two ends.
  useEffect(() => {
    if (!selected) lit.current = undefined;
    else if (selected.kind === "node") {
      const ids = new Set([selected.node.id]);
      const linkIds = new Set<number>();
      for (const l of links) {
        if (l.source === selected.node.id || l.target === selected.node.id) {
          ids.add(l.source);
          ids.add(l.target);
          linkIds.add(l.id);
        }
      }
      lit.current = { nodes: ids, links: linkIds };
    } else {
      lit.current = { nodes: new Set([selected.link.source, selected.link.target]), links: new Set([selected.link.id]) };
    }
    // Repaint without restarting the layout.
    const instance = graph.current;
    if (instance) instance.nodeRelSize(instance.nodeRelSize());
  }, [selected, links]);

  return <div ref={host} className="absolute inset-0" />;
}

/** The node without the layout's bookkeeping (positions, velocities). */
function strip(node: DrawNode): ExploreNode {
  return { id: node.id, label: node.label, caption: node.caption, properties: node.properties };
}

