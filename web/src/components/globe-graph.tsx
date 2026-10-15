import ForceGraph3D, { type ConfigOptions, type ForceGraph3DInstance } from "3d-force-graph";
import { useEffect, useRef } from "react";
import SpriteText from "three-spritetext";
import * as THREE from "three";
import type { GraphData } from "@/lib/api";
import { NODE_COLORS } from "@/lib/palette";

export interface GlobeNode {
  id: string;
  label: string;
  name: string;
  status: string | null;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
}
interface GlobeLink {
  source: string | GlobeNode;
  target: string | GlobeNode;
  type: string;
}

/** The library types its constructor loosely; this gives it our node and link shapes. */
const Globe = ForceGraph3D as unknown as new (element: HTMLElement, options?: ConfigOptions) => ForceGraph3DInstance<GlobeNode, GlobeLink>;

const RADIUS = 170;
const isDark = () => document.documentElement.dataset.theme === "dark";
/** Colours that follow the theme: paper and navy in light mode, deep navy in dark mode. */
const theme = () =>
  isDark()
    ? { background: "#081232", core: "#0b173d", wire: "#5b86ff", ink: "#edf0f8", label: "#0f1c47", dim: "#22346a", link: "rgba(237,240,248,0.12)", linkLit: "#edf0f8" }
    : { background: "#F5F3EE", core: "#ffffff", wire: "#0C1E53", ink: "#0C1E53", label: "#ffffff", dim: "#D8D4CA", link: "rgba(12,30,83,0.12)", linkLit: "#0C1E53" };
const MUTED = "#8A8F9C";
const endId = (end: string | GlobeNode) => (typeof end === "string" ? end : end.id);

/**
 * A d3 force that pulls every node onto the surface of a sphere.
 * Links still pull related things together, so clusters form like continents.
 */
function sphereForce(radius: number) {
  let nodes: GlobeNode[] = [];
  const force = (alpha: number) => {
    for (const node of nodes) {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const z = node.z ?? 0;
      const distance = Math.hypot(x, y, z) || 1;
      const pull = ((radius - distance) / distance) * alpha;
      node.vx = (node.vx ?? 0) + x * pull;
      node.vy = (node.vy ?? 0) + y * pull;
      node.vz = (node.vz ?? 0) + z * pull;
    }
  };
  force.initialize = (all: GlobeNode[]) => {
    nodes = all;
  };
  return force;
}

/** A faint navy wireframe planet under the nodes, so the graph reads as one small world. */
function decorate(scene: THREE.Scene) {
  const colors = theme();
  const planet = new THREE.Mesh(
    new THREE.IcosahedronGeometry(RADIUS * 0.96, 4),
    new THREE.MeshBasicMaterial({ color: colors.wire, wireframe: true, transparent: true, opacity: 0.07 }),
  );
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 0.94, 48, 48),
    new THREE.MeshBasicMaterial({ color: colors.core, transparent: true, opacity: 0.85 }),
  );
  scene.add(core, planet);
}

interface GlobeGraphProps {
  data: GraphData | undefined;
  highlight: string[];
  onSelect: (node: GlobeNode | undefined) => void;
}

export function GlobeGraph({ data, highlight, onSelect }: GlobeGraphProps) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraph3DInstance<GlobeNode, GlobeLink>>(undefined);
  const lit = useRef(new Set<string>());

  // Create the scene once.
  useEffect(() => {
    if (!host.current) return;
    const isLit = (id: string) => lit.current.size === 0 || lit.current.has(id);
    const linkLit = (link: GlobeLink) => lit.current.size > 0 && lit.current.has(endId(link.source)) && lit.current.has(endId(link.target));

    const colors = theme();
    const instance = new Globe(host.current, { controlType: "orbit" })
      .backgroundColor(colors.background)
      .showNavInfo(false)
      .nodeId("id")
      .nodeRelSize(3.2)
      .nodeResolution(18)
      .nodeOpacity(0.95)
      .nodeVal((n) => (n.label === "Issue" ? 4 : n.label === "School" || n.label === "Person" ? 2.6 : n.label === "Feature" ? 2.2 : 1))
      .nodeColor((n) => (isLit(n.id) ? (NODE_COLORS[n.label] ?? MUTED) : colors.dim))
      .nodeLabel((n) => `<div style="font-family:'Instrument Sans',sans-serif;font-size:13px;padding:6px 10px;background:${colors.label};color:${colors.ink};border:1px solid ${colors.dim}">${escapeHtml(n.name ?? n.id)}</div>`)
      .nodeThreeObjectExtend(true)
      .nodeThreeObject((n) => {
        const labelled = lit.current.size > 0 ? lit.current.has(n.id) && n.label !== "Message" : n.label === "School" || n.label === "Feature";
        if (!labelled) return new THREE.Object3D();
        const text = new SpriteText((n.name ?? n.id).slice(0, 28), 4.2, colors.ink);
        text.fontFace = "Instrument Sans";
        text.position.y = 8;
        return text;
      })
      .linkCurvature(0.25)
      .linkOpacity(0.5)
      .linkColor((l) => (linkLit(l) ? colors.linkLit : colors.link))
      .linkWidth((l) => (linkLit(l) ? 0.9 : 0.3))
      .linkDirectionalParticles((l) => (linkLit(l) ? 3 : 0))
      .linkDirectionalParticleWidth(2.2)
      .linkDirectionalParticleColor(() => "#D2402C")
      .onNodeClick((node) => {
        onSelect(node);
        const distance = Math.hypot(node.x ?? 0, node.y ?? 0, node.z ?? 0) || 1;
        const scale = 1 + 140 / distance;
        instance.cameraPosition({ x: (node.x ?? 0) * scale, y: (node.y ?? 0) * scale, z: (node.z ?? 0) * scale }, { x: 0, y: 0, z: 0 }, 1200);
      })
      .onBackgroundClick(() => onSelect(undefined))
      .cameraPosition({ z: RADIUS * (host.current.clientWidth < 520 ? 4.6 : 3) });

    instance.d3Force("sphere", sphereForce(RADIUS) as never);
    instance.d3Force("charge")?.strength?.(-18);
    decorate(instance.scene());

    const controls = instance.controls() as { autoRotate: boolean; autoRotateSpeed: number; enableDamping: boolean };
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controls.enableDamping = true;

    const resize = new ResizeObserver(([entry]) => instance.width(entry.contentRect.width).height(entry.contentRect.height));
    resize.observe(host.current);
    graph.current = instance;

    return () => {
      resize.disconnect();
      instance._destructor();
      graph.current = undefined;
    };
    // onSelect is stable enough for a one-time setup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Feed in new data, keeping the positions of nodes already on the globe so it doesn't jump.
  useEffect(() => {
    const instance = graph.current;
    if (!instance || !data) return;
    const previous = new Map(instance.graphData().nodes.map((n) => [n.id, n]));
    const nodes: GlobeNode[] = data.nodes.map((n) => ({ ...n, ...pick(previous.get(n.id)) }));
    instance.graphData({ nodes, links: data.links.map((l) => ({ ...l })) });
  }, [data]);

  // Light up a path: everything else fades to graphite.
  useEffect(() => {
    const instance = graph.current;
    if (!instance) return;
    lit.current = new Set(highlight);
    instance.nodeColor(instance.nodeColor()).nodeThreeObject(instance.nodeThreeObject()).linkWidth(instance.linkWidth());
    const controls = instance.controls() as { autoRotate: boolean };
    controls.autoRotate = highlight.length === 0;
  }, [highlight]);

  return <div ref={host} className="absolute inset-0" />;
}

function pick(node: GlobeNode | undefined) {
  return node ? { x: node.x, y: node.y, z: node.z } : {};
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
