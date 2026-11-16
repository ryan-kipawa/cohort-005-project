import { db } from "~/db";
import { getLandingPage, type Db } from "./lib/landing-page";

export type {
  CatalogueStats,
  LandingCourse,
  LandingPage,
} from "./lib/landing-page";

/**
 * What the landing page shows about the catalogue, bound to a database. The
 * app uses `landingPage`; tests build their own against a test database.
 */
export function createLandingPage(database: Db) {
  return {
    /**
     * The three newest published courses, each with its lesson count, and
     * totals across every published course: courses, lessons, and the
     * instructors who teach them. Drafts and archived courses count nowhere.
     */
    get() {
      return getLandingPage(database);
    },
  };
}

// Pure so a route importing this only for its loader doesn't pull the
// database into the client bundle (see `~/db`).
export const landingPage = /* @__PURE__ */ createLandingPage(db);
