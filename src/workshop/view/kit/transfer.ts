/**
 * (E1) A kit Piece across a worker's boundary: built off the main thread (a late unit's pieces, view/late/), handed
 * back as plain data with its geometry's buffers transferred, not copied, and made a Piece again here. Nothing about
 * the piece changes: the same node tree, transforms, parts, materials, textures' keys, geometry attributes (the bake's
 * values among them), index and userData, sockets, size and triangle count.
 */
import { BufferAttribute, BufferGeometry, Matrix4 } from 'three';
import type { KitPart, Piece, PieceNode } from './types.ts';

type TypedArray = Float32Array | Uint32Array | Uint16Array | Uint8Array | Int8Array | Int16Array | Int32Array;

interface PackedAttribute {
  array: TypedArray;
  itemSize: number;
  normalized: boolean;
}
interface PackedGeometry {
  attributes: Record<string, PackedAttribute>;
  index: TypedArray | null;
  userData: Record<string, unknown>;
}
interface PackedPart extends Omit<KitPart, 'geometry'> {
  geometry: PackedGeometry;
}
interface PackedNode {
  name: string;
  transform: number[] | null;
  parts: PackedPart[];
  children: PackedNode[] | null;
}
export interface PackedPiece {
  name: string;
  root: PackedNode;
  size: Piece['size'];
  sockets: Record<string, number[]> | null;
  triangles: number;
}

/** A piece as plain data, and the buffers to transfer with it (each once). */
export function packPiece(p: Piece): { packed: PackedPiece; transfer: ArrayBuffer[] } {
  const transfer = new Set<ArrayBuffer>();
  const geometry = (g: BufferGeometry): PackedGeometry => {
    const attributes: Record<string, PackedAttribute> = {};
    for (const [name, a] of Object.entries(g.attributes)) {
      const ba = a as BufferAttribute;
      const array = ba.array as TypedArray;
      transfer.add(array.buffer as ArrayBuffer);
      attributes[name] = { array, itemSize: ba.itemSize, normalized: ba.normalized };
    }
    const index = g.index ? (g.index.array as TypedArray) : null;
    if (index) transfer.add(index.buffer as ArrayBuffer);
    return { attributes, index, userData: JSON.parse(JSON.stringify(g.userData ?? {})) as Record<string, unknown> };
  };
  const node = (n: PieceNode): PackedNode => ({
    name: n.name,
    transform: n.transform ? [...n.transform.elements] : null,
    parts: n.parts.map((part) => ({ ...part, geometry: geometry(part.geometry) })),
    children: n.children ? n.children.map(node) : null,
  });
  const packed: PackedPiece = {
    name: p.name,
    root: node(p.root),
    size: { ...p.size },
    sockets: p.sockets ? Object.fromEntries(Object.entries(p.sockets).map(([k, m]) => [k, [...m.elements]])) : null,
    triangles: p.triangles,
  };
  return { packed, transfer: [...transfer] };
}

/** The piece again, from what `packPiece` made (its buffers now this side's). */
export function unpackPiece(d: PackedPiece): Piece {
  const geometry = (g: PackedGeometry): BufferGeometry => {
    const out = new BufferGeometry();
    for (const [name, a] of Object.entries(g.attributes)) out.setAttribute(name, new BufferAttribute(a.array, a.itemSize, a.normalized));
    if (g.index) out.setIndex(new BufferAttribute(g.index, 1));
    out.userData = g.userData;
    return out;
  };
  const node = (n: PackedNode): PieceNode => ({
    name: n.name,
    ...(n.transform ? { transform: new Matrix4().fromArray(n.transform) } : {}),
    parts: n.parts.map((part) => ({ ...part, geometry: geometry(part.geometry) })),
    ...(n.children ? { children: n.children.map(node) } : {}),
  });
  return {
    name: d.name,
    root: node(d.root),
    size: d.size,
    ...(d.sockets ? { sockets: Object.fromEntries(Object.entries(d.sockets).map(([k, m]) => [k, new Matrix4().fromArray(m)])) } : {}),
    triangles: d.triangles,
  };
}
