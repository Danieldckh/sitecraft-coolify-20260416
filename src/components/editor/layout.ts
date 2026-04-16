import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

const PAGE_W = 300;
const PAGE_PAD_TOP = 56;
const PAGE_PAD_BOTTOM = 16;
const SECTION_W = 260;
const SECTION_H = 56;
const SECTION_GAP = 10;

export function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  const childrenByParent = new Map<string, Node[]>();
  for (const n of nodes) {
    if (n.parentId) {
      const arr = childrenByParent.get(n.parentId) ?? [];
      arr.push(n);
      childrenByParent.set(n.parentId, arr);
    }
  }

  const pageHeights = new Map<string, number>();
  for (const n of nodes) {
    if (n.type === 'page') {
      const kids = childrenByParent.get(n.id) ?? [];
      const h =
        PAGE_PAD_TOP +
        Math.max(kids.length, 1) * (SECTION_H + SECTION_GAP) +
        PAGE_PAD_BOTTOM;
      pageHeights.set(n.id, h);
    }
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 140, marginx: 40, marginy: 40 });

  for (const n of nodes) {
    if (n.type === 'page') {
      g.setNode(n.id, { width: PAGE_W, height: pageHeights.get(n.id) ?? 300 });
    }
  }
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  return nodes.map((n) => {
    if (n.type === 'page') {
      const p = g.node(n.id);
      if (!p) return n;
      return {
        ...n,
        position: { x: p.x - PAGE_W / 2, y: p.y - (pageHeights.get(n.id) ?? 300) / 2 },
        style: { ...(n.style ?? {}), width: PAGE_W, height: pageHeights.get(n.id) ?? 300 },
      };
    }
    // section: relative to parent
    const siblings = childrenByParent.get(n.parentId!) ?? [];
    const idx = siblings.findIndex((s) => s.id === n.id);
    return {
      ...n,
      position: {
        x: (PAGE_W - SECTION_W) / 2,
        y: PAGE_PAD_TOP + idx * (SECTION_H + SECTION_GAP),
      },
      style: { ...(n.style ?? {}), width: SECTION_W, height: SECTION_H },
    };
  });
}
