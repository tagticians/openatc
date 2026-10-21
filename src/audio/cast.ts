// System-voice filtering and aircraft-type helpers for the radio. Who speaks for which
// flight lives in personas.ts.

// macOS ships novelty voices (Bells, Cellos, Good News…) that sing or whisper: never use them.
const NOVELTY =
  /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Junior|Kathy|Organ|Pipe Organ|Princess|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley)\b/i;

export function usableSystemVoices(all: SpeechSynthesisVoice[]) {
  return all.filter((v) => /^en[-_]/i.test(v.lang) && !NOVELTY.test(v.name));
}

/** Aircraft types whose cockpit bed is a turboprop. */
export const isProp = (type: string) => /^(DH8|AT[4-7]|PC12|C172|C208|SF34|JS4|B190|BE20)/.test(type);
