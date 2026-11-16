import { Link } from "react-router";
import { Moon, Sun } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useDarkMode } from "~/components/use-dark-mode";

export function LandingHeader({ signedIn }: { signedIn: boolean }) {
  const { isDark, toggleDarkMode } = useDarkMode();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="text-xl font-bold tracking-tight">
          Cadence
        </Link>
        <nav className="flex items-center gap-6">
          <Link
            to="/courses"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Courses
          </Link>
          <button
            onClick={toggleDarkMode}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          {signedIn ? (
            <Button asChild size="sm">
              <Link to="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Link
                to="/login"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Log In
              </Link>
              <Button asChild size="sm">
                <Link to="/signup">Sign Up</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
