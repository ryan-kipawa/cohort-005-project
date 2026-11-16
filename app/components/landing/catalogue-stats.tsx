type Stats = { courses: number; lessons: number; instructors: number };

export function CatalogueStats({ stats }: { stats: Stats }) {
  const items = [
    { value: stats.courses, label: "Published courses" },
    { value: stats.lessons, label: "Lessons to work through" },
    { value: stats.instructors, label: "Instructors teaching" },
  ];

  return (
    <section className="border-y border-border bg-muted/50">
      <dl className="mx-auto grid max-w-6xl grid-cols-1 divide-y divide-border px-6 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {items.map((item) => (
          <div
            key={item.label}
            className="py-8 sm:px-8 sm:first:pl-0 sm:last:pr-0"
          >
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className="mt-1 text-4xl font-bold tracking-tight">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
