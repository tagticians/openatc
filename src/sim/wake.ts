// Wake turbulence separation (ICAO PANS-ATM 8.7.3 / Doc 4444 categories).
// Categories: L light, M medium, H heavy, J super (A380).
import type { Wake } from '../data/traffic';

/** Radar distance minima on approach/departure (NM), leader → follower. */
const RADAR_NM: Partial<Record<Wake, Partial<Record<Wake, number>>>> = {
  J: { J: 4, H: 6, M: 7, L: 8 },
  H: { H: 4, M: 5, L: 6 },
  M: { L: 5 },
};

/** Departure time minima on the same runway (seconds), leader → follower. */
const DEP_SECONDS: Partial<Record<Wake, Partial<Record<Wake, number>>>> = {
  J: { H: 120, M: 180, L: 180 },
  H: { M: 120, L: 120 },
  M: { L: 120 },
};

export const WAKE_NAME: Record<Wake, string> = { J: 'super', H: 'heavy', M: 'medium', L: 'light' };

/** Wake distance a follower needs behind a leader, or null if only standard separation applies. */
export const wakeNm = (lead: Wake, follow: Wake): number | null => RADAR_NM[lead]?.[follow] ?? null;

/** Seconds a departure must wait after the previous one lifts off. */
export const wakeDepSeconds = (lead: Wake, follow: Wake): number => DEP_SECONDS[lead]?.[follow] ?? 0;
