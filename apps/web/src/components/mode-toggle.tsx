import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

export function ModeToggle() {
  const { theme, setTheme } = useTheme();

  const isDark = theme === "dark";

  function toggleTheme() {
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      aria-label={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
      title={isDark ? "Tema claro" : "Tema escuro"}
    >
      <Sun
        className={`size-5 transition-all ${isDark ? "hidden" : "block"}`}
        aria-hidden="true"
      />
      <Moon
        className={`size-5 transition-all ${isDark ? "block" : "hidden"}`}
        aria-hidden="true"
      />
    </Button>
  );
}
