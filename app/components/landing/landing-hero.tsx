import { Link } from "react-router";
import { ArrowRight, BookOpen, Check } from "lucide-react";
import { Button } from "~/components/ui/button";
import { CourseImage } from "~/components/course-image";
import type { LandingCourse } from "~/modules/landing-page/index.server";

const SELLING_POINTS = [
  "Structured modules",
  "Progress tracking",
  "Quizzes that check you",
];

export function LandingHero({
  signedIn,
  courses,
}: {
  signedIn: boolean;
  courses: LandingCourse[];
}) {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 sm:py-24 grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">
          Courses for developers
        </p>
        <h1 className="mt-4 text-5xl font-bold tracking-tight sm:text-6xl">
          Learn to code,
          <br />
          <span className="text-muted-foreground">at your own pace.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Structured courses built by experienced instructors. Track your
          progress, take quizzes, and build real-world skills.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Button asChild size="lg">
            <Link to="/courses">
              Browse Courses
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            {signedIn ? (
              <Link to="/dashboard">Go to your dashboard</Link>
            ) : (
              <Link to="/signup">Create a free account</Link>
            )}
          </Button>
        </div>
        <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {SELLING_POINTS.map((point) => (
            <li key={point} className="flex items-center gap-2">
              <Check className="size-4 text-primary" />
              {point}
            </li>
          ))}
        </ul>
      </div>
      {courses.length > 0 && <CoursePreview courses={courses} />}
    </section>
  );
}

function CoursePreview({ courses }: { courses: LandingCourse[] }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/50 p-4 shadow-sm">
      <p className="px-2 pb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        New in the catalogue
      </p>
      <ul className="space-y-3">
        {courses.map((course) => (
          <li key={course.id}>
            <Link
              to={`/courses/${course.slug}`}
              className="group flex items-center gap-4 rounded-xl border border-border bg-background p-3 transition-shadow hover:shadow-md"
            >
              <CourseImage
                src={course.coverImageUrl}
                alt=""
                className="aspect-video w-20 shrink-0 sm:w-28 rounded-md object-cover"
              />
              <div className="min-w-0">
                <p className="line-clamp-2 font-semibold leading-snug group-hover:text-primary">
                  {course.title}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  {course.instructorName}
                  <span aria-hidden>·</span>
                  <BookOpen className="size-3" />
                  {course.lessonCount} lessons
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
