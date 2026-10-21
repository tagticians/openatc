# Backlog

Ideas agreed but not started. Newest at the top.

## Ground movement (follow-ups to taxi routing)

Taxi routing is in: departures and arrivals follow the OpenStreetMap taxiways
(`src/sim/taxi.ts`, data from `scripts/osm/taxiways.mjs`), and taxi time comes from the route length.

- **Runway crossings.** At EHAM and KDCA some taxi routes cross an active runway. Today they cross
  silently. Make it a clearance: the aircraft holds short and calls "holding short runway 36L",
  the controller gives "cross runway 36L" (new `CROSS` command). Unauthorised or badly timed
  crossings score as runway incursions.
- **Holding point names on the strip and card.** Show which holding point (e.g. "via W5"), from the
  OSM `ref` on `aeroway=holding_position`, and use it in the phraseology ("taxi to holding point
  W5 runway 27").
- **Ground conflicts.** Aircraft can overlap on the same taxiway. Options: simple spacing (an
  aircraft waits while another is within ~150 m ahead on its route), or a full Ground position with
  taxi instructions and give-way calls. The second is effectively a new game mode.
- **Push-back.** Today the start-up delay is a pause at the stand. Show a short push-back off the stand
  before the taxi starts.
- **Taxi route editing.** Let the controller pick a different holding point or route (e.g. an
  intersection departure for a short taxi).

## Airport configuration as data (from the "go 1-8" refactor, step 6)

Move each airport's settings from `src/data/<icao>.ts` into JSON files next to the procedures.
Skipped for now: the TypeScript files are about 40 lines each and keep type checks and source comments.
Revisit if the number of airports grows a lot.
