/**
 * Blob contact shadows (W1 brief § 1, REWRITE.md § E7 low tier): a soft
 * dark decal under an object, so it sits on the bench instead of hovering.
 * The low tier uses them instead of cast shadows; the high tier may use them
 * to ground small things that the shadow map is too coarse for.
 *
 * One instanced draw for every blob. Each blob is an ellipse: centre on the
 * bench, radii in x and z, and a strength 0..1. The colour is a deep teal
 * from the palette, never black.
 */
import { Color, DataTexture, LinearFilter, Matrix4, Quaternion, RGBAFormat, UnsignedByteType, Vector3, type InstancedMesh, type MeshBasicMaterial, type Object3D } from 'three';
import { blobShadowMesh } from '../kit/stage-helpers.ts';
import { stageColours } from '../stage/colours.ts';

/** The falloff texture: alpha is a soft disc (a smoothstep of a gaussian), rgb white. */
export function blobFalloff(size = 64): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size) * 2 - 1;
      const y = ((j + 0.5) / size) * 2 - 1;
      const r = Math.min(1, Math.hypot(x, y));
      // Dense core, long soft skirt, exactly zero at the rim.
      const a = Math.exp(-3.2 * r * r) * (1 - r * r * r);
      const k = (j * size + i) * 4;
      data[k] = 255;
      data[k + 1] = 255;
      data[k + 2] = 255;
      data[k + 3] = Math.round(Math.max(0, a) * 255);
    }
  }
  return data;
}

export interface Blob {
  x: number;
  z: number;
  /** Radii along x and z. */
  rx: number;
  rz: number;
  /** 0..1. */
  strength: number;
  /** Rotation about +Y, radians. */
  angle?: number;
  /** Height of the surface the blob lies on (default the bench, 0). */
  y?: number;
}

export class BlobShadows {
  readonly mesh: InstancedMesh;
  private readonly texture: DataTexture;
  private readonly capacity: number;
  private count = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly c = new Color();

  constructor(capacity = 64, opacity = 0.85) {
    this.capacity = capacity;
    this.mesh = blobShadowMesh(capacity);
    const size = 64;
    this.texture = new DataTexture(blobFalloff(size), size, size, RGBAFormat, UnsignedByteType);
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.needsUpdate = true;
    const mat = this.mesh.material as MeshBasicMaterial;
    const col = stageColours().blob;
    mat.color.fromArray(col);
    mat.map = this.texture;
    mat.transparent = true;
    mat.opacity = opacity;
    mat.depthWrite = false;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    mat.toneMapped = true;
    mat.fog = false;
    // Per-blob strength rides in the instance colour's red channel and scales alpha only.
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#if defined( USE_INSTANCING_COLOR )\n  diffuseColor.a *= vColor.r;\n#endif',
      );
    };
    mat.needsUpdate = true;
    this.mesh.renderOrder = -1;
    this.mesh.count = 0;
  }

  /** Replace every blob. */
  set(blobs: readonly Blob[]): void {
    this.count = Math.min(blobs.length, this.capacity);
    for (let i = 0; i < this.count; i++) this.write(i, blobs[i]!);
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Move or change one blob (e.g. under a part being carried: smaller and fainter as it rises). */
  update(i: number, b: Blob): void {
    if (i >= this.count) return;
    this.write(i, b);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private write(i: number, b: Blob): void {
    this.q.setFromAxisAngle(this.up, b.angle ?? 0);
    this.p.set(b.x, (b.y ?? 0) + 0.003, b.z);
    this.s.set(b.rx * 2, 1, b.rz * 2);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    // Not a colour: the strength rides in the instance colour (the shader reads .r).
    this.mesh.setColorAt(i, this.c.setScalar(Math.min(1, Math.max(0, b.strength))));
  }

  addTo(parent: Object3D): this {
    parent.add(this.mesh);
    return this;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.texture.dispose();
  }
}
