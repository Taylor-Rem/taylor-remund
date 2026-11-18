/**
 * The phone panel over the stage (W2 part 5; REWRITE.md § D 3): the panel
 * (`createPhonePanel`) on the world's phone line (`worldLine`), opening out
 * of the phone on the bench and standing clear of the station on the line
 * the cord is in (the boxes come from the phone's view,
 * `view/stations/phone.ts` `stagePhoneBoxes`).
 *
 * The input engineer wires the click on the phone (pick id `phone`) and its
 * key to `open()`; whoever runs the frames calls `sync()` once per frame,
 * after the steps.
 *
 *   const phone = createStagePhone({ world: ws.world, dispatch: (i) => ws.dispatch(i), canvas });
 *   each frame: phone.sync();      on the phone's click or key: phone.open();
 */
import type { Intent, WorldView } from '../../sim/index.ts';
import { stagePhoneBoxes } from '../../view/stations/phone.ts';
import { createPhonePanel, type PhonePanel } from './panel.ts';
import { worldLine, type WorldLine } from './world-line.ts';

export interface StagePhoneOptions {
  world: WorldView;
  dispatch(intent: Intent): void;
  /** The stage's canvas (the boxes are measured on it). */
  canvas: HTMLElement;
  parent?: HTMLElement;
  reducedMotion?: () => boolean;
  onToggle?: (open: boolean) => void;
}

export interface StagePhone {
  readonly panel: PhonePanel;
  readonly line: WorldLine;
  readonly isOpen: boolean;
  /** Pick the phone up (focus returns to `returnTo`, default what had it, on close). */
  open(returnTo?: HTMLElement | null): void;
  close(): void;
  /** Once per frame after the steps: hear the line; keep the open panel clear of the station as the camera moves. */
  sync(): void;
  destroy(): void;
}

export function createStagePhone(o: StagePhoneOptions): StagePhone {
  const line = worldLine({ world: o.world, dispatch: o.dispatch });
  const boxes = stagePhoneBoxes(o.canvas);
  const panel = createPhonePanel({
    line,
    anchor: boxes.anchor,
    avoid: boxes.avoid,
    ...(o.parent ? { parent: o.parent } : {}),
    ...(o.reducedMotion ? { reducedMotion: o.reducedMotion } : {}),
    ...(o.onToggle ? { onToggle: o.onToggle } : {}),
  });
  return {
    panel,
    line,
    get isOpen() {
      return panel.isOpen;
    },
    open: (to) => panel.open(to),
    close: () => panel.close(),
    sync() {
      line.sync();
      if (panel.isOpen) panel.place();
    },
    destroy: () => panel.destroy(),
  };
}
