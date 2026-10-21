// Plug-ins: optional systems an airport (or the player) switches on: shift events, VFR general
// aviation, the HEMS helicopter. The simulation calls each hook at its moment; a plug-in only
// implements the ones it needs, and can add instructions with registerCommands().
import type { Vec } from './geo';
import type { Aircraft } from './types';

export interface SimPlugin {
  id: string;
  /** The shift starts. */
  start?(): void;
  /** Every physics step (0.25 s). */
  step?(): void;
  /** Every radar sweep (2 s), after the safety nets. */
  sweep?(): void;
  /** First call on frequency for an aircraft it owns; true when handled. */
  call?(ac: Aircraft): boolean;
  /** Where an aircraft it owns is drawn while on the ground. */
  groundPos?(ac: Aircraft): Vec | null;
}
