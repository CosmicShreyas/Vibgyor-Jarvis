import darkLogo from "../../pngs/J_dark.png";
import lightLogo from "../../pngs/J_light.png";

export function getJarvisLogoForTheme(theme: "light" | "dark") {
  return theme === "dark" ? lightLogo : darkLogo;
}
