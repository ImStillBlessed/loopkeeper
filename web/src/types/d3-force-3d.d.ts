/** The two forces the graph explorer uses from d3-force-3d (it ships without types). */
declare module "d3-force-3d" {
  interface PositionForce {
    (alpha: number): void;
    strength(strength: number): PositionForce;
  }
  export function forceX(x?: number): PositionForce;
  export function forceY(y?: number): PositionForce;
}
