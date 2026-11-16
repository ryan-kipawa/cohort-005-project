import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { countDistinct, desc, eq, sql } from "drizzle-orm";
import * as schema from "~/db/schema";
import { CourseStatus } from "~/db/schema";

export type Db = BetterSQLite3Database<typeof schema>;

const NEWEST_COURSE_LIMIT = 3;

export type LandingCourse = {
  id: number;
  title: string;
  slug: string;
  coverImageUrl: string | null;
  instructorName: string;
  lessonCount: number;
};

export type CatalogueStats = {
  courses: number;
  lessons: number;
  instructors: number;
};

export type LandingPage = {
  newestCourses: LandingCourse[];
  stats: CatalogueStats;
};

const { courses, users, modules, lessons } = schema;
const isPublished = eq(courses.status, CourseStatus.Published);

function newestCourses(db: Db): LandingCourse[] {
  return db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      coverImageUrl: courses.coverImageUrl,
      instructorName: users.name,
      lessonCount: sql<number>`count(${lessons.id})`,
    })
    .from(courses)
    .innerJoin(users, eq(courses.instructorId, users.id))
    .leftJoin(modules, eq(modules.courseId, courses.id))
    .leftJoin(lessons, eq(lessons.moduleId, modules.id))
    .where(isPublished)
    .groupBy(courses.id)
    .orderBy(desc(courses.createdAt), desc(courses.id))
    .limit(NEWEST_COURSE_LIMIT)
    .all();
}

function catalogueStats(db: Db): CatalogueStats {
  const [stats] = db
    .select({
      courses: countDistinct(courses.id),
      lessons: countDistinct(lessons.id),
      instructors: countDistinct(courses.instructorId),
    })
    .from(courses)
    .leftJoin(modules, eq(modules.courseId, courses.id))
    .leftJoin(lessons, eq(lessons.moduleId, modules.id))
    .where(isPublished)
    .all();
  return stats;
}

export function getLandingPage(db: Db): LandingPage {
  return { newestCourses: newestCourses(db), stats: catalogueStats(db) };
}
