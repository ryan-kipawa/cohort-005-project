import { BookOpen, ListChecks, TrendingUp } from "lucide-react";

const STEPS = [
  {
    icon: BookOpen,
    title: "Pick a course",
    body: "Every course is split into modules and short lessons, so you always know what comes next.",
  },
  {
    icon: TrendingUp,
    title: "Learn on your schedule",
    body: "Your progress is saved lesson by lesson. Stop whenever you like and pick up where you left off.",
  },
  {
    icon: ListChecks,
    title: "Check what stuck",
    body: "Where a lesson has a quiz, it tells you whether you've got it before you move on.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <h2 className="text-3xl font-bold tracking-tight">How Cadence works</h2>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Self-paced doesn't mean on your own. Every course has a structure, and
        quizzes along the way let you check yourself.
      </p>
      <ol className="mt-10 grid grid-cols-1 gap-10 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <step.icon className="size-5 text-primary" />
              </span>
              <span className="text-sm font-semibold text-muted-foreground">
                Step {index + 1}
              </span>
            </div>
            <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
