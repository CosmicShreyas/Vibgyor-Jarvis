import { useTheme } from "@/components/ThemeProvider";
import { getJarvisLogoForTheme } from "@/lib/jarvis-logo-assets";
import { cn } from "@/lib/utils";

interface JarvisLogoProps {
  alt?: string;
  className?: string;
  roundedClassName?: string;
}

export function JarvisLogo({
  alt = "Jarvis logo",
  className,
  roundedClassName = "rounded-2xl",
}: JarvisLogoProps) {
  const { resolved } = useTheme();
  const src = getJarvisLogoForTheme(resolved);

  return (
    <img
      src={src}
      alt={alt}
      className={cn("object-cover", roundedClassName, className)}
      draggable={false}
    />
  );
}
