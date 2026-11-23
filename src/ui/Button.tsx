import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "ghost"; size?: "md" | "sm"; icon?: boolean };

export function Button({ variant = "default", size = "md", icon, className = "", type = "button", ...rest }: Props) {
  const cls = ["btn", variant === "default" ? "" : variant, size === "sm" ? "sm" : "", icon ? "icon" : "", className].filter(Boolean).join(" ");
  return <button type={type} className={cls} {...rest} />;
}
