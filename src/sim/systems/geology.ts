import type { System } from "../core/engine";
import { GEOLOGY_VERSION } from "../geology/truth/model";

/**
 * Geology holds no state of its own: truth is regenerated from the world seed. The world
 * records which generator made it, so a save is never silently re-interpreted by a newer one.
 */
export const geology: System<{ version: number }> = {
  id: "geology",
  initialState: () => ({ version: GEOLOGY_VERSION }),
};
