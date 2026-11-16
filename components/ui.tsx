import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

type Variant = "filled" | "tonal" | "text" | "outlined" | "danger";

const BUTTON_BASE =
  "state-layer inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium tracking-wide select-none disabled:opacity-40 disabled:pointer-events-none";
const VARIANTS: Record<Variant, string> = {
  filled: "bg-primary text-on-primary",
  tonal: "bg-secondary-container text-on-secondary-container",
  text: "text-primary px-4",
  outlined: "border border-outline text-primary",
  danger: "text-error px-4",
};

export function buttonClass(variant: Variant = "filled", extra = "") {
  return `${BUTTON_BASE} ${VARIANTS[variant]} ${extra}`;
}

export function Button({
  variant = "filled",
  icon,
  className = "",
  children,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; icon?: IconName }) {
  return (
    <button type="button" {...props} className={buttonClass(variant, className)}>
      {icon && <Icon name={icon} className="size-5 -ml-1" />}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className = "",
  ...props
}: Omit<ComponentProps<"button">, "children"> & { icon: IconName; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`state-layer inline-flex size-12 items-center justify-center rounded-full text-on-surface-variant ${className}`}
    >
      <Icon name={icon} />
    </button>
  );
}

export function IconLink({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="state-layer inline-flex size-12 items-center justify-center rounded-full text-on-surface-variant"
    >
      <Icon name={icon} />
    </Link>
  );
}

/** Top app bar with an optional back link and trailing actions. */
export function TopBar({
  title,
  subtitle,
  backHref,
  actions,
}: {
  title: string;
  subtitle?: string | null;
  backHref?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex min-h-16 items-center gap-1 px-1 pt-[env(safe-area-inset-top)] md:px-3">
      {backHref ? <IconLink href={backHref} icon="back" label="Tilbake" /> : <span className="w-3" />}
      <div className="min-w-0 flex-1 px-1">
        <h1 className="truncate text-[1.375rem] leading-7">{title}</h1>
        {subtitle && <p className="truncate text-sm text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

export function Card({
  className = "",
  tone = "low",
  ...props
}: ComponentProps<"section"> & { tone?: "low" | "container" | "primary" }) {
  const tones = {
    low: "bg-surface-low",
    container: "bg-surface-container",
    primary: "bg-primary-container text-on-primary-container",
  };
  return <section {...props} className={`rounded-[28px] p-5 ${tones[tone]} ${className}`} />;
}

const FIELD =
  "peer h-14 w-full rounded-t-lg border-b border-outline bg-surface-highest px-4 pt-5 pb-1 text-base text-on-surface outline-none transition-colors placeholder:text-transparent focus:border-b-2 focus:border-primary";

/** Material filled text field with a floating label. */
export function Field({
  label,
  hint,
  suffix,
  className = "",
  ...props
}: ComponentProps<"input"> & { label: string; hint?: string; suffix?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="relative block">
        <input {...props} placeholder=" " className={`${FIELD} ${suffix ? "pr-12" : ""}`} />
        <span className="pointer-events-none absolute top-1.5 left-4 text-xs text-on-surface-variant transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-base peer-focus:top-1.5 peer-focus:text-xs peer-focus:text-primary">
          {label}
        </span>
        {suffix && (
          <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-on-surface-variant">
            {suffix}
          </span>
        )}
      </span>
      {hint && <span className="mt-1 block px-4 text-xs text-on-surface-variant">{hint}</span>}
    </label>
  );
}

export function SelectField({
  label,
  hint,
  children,
  className = "",
  ...props
}: ComponentProps<"select"> & { label: string; hint?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="relative block">
        <select {...props} className={`${FIELD} appearance-none pr-10`}>
          {children}
        </select>
        <span className="pointer-events-none absolute top-1.5 left-4 text-xs text-on-surface-variant">
          {label}
        </span>
        <Icon
          name="chevron"
          className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 rotate-90 text-on-surface-variant"
        />
      </span>
      {hint && <span className="mt-1 block px-4 text-xs text-on-surface-variant">{hint}</span>}
    </label>
  );
}

/** Single-choice segmented button row. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full border border-outline">
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`state-layer h-11 min-w-0 flex-1 px-2 text-sm font-medium ${
              index > 0 ? "border-l border-outline" : ""
            } ${index === 0 ? "rounded-l-full" : ""} ${
              index === options.length - 1 ? "rounded-r-full" : ""
            } ${selected ? "bg-secondary-container text-on-secondary-container" : "text-on-surface"}`}
          >
            <span className="block truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-2xl bg-error-container px-4 py-3 text-sm text-on-error-container">
      {children}
    </p>
  );
}

/** Extended floating action button, clear of the bottom navigation on phones. */
export function Fab({ icon, children, ...props }: ComponentProps<"button"> & { icon: IconName }) {
  return (
    <button
      type="button"
      {...props}
      className="state-layer fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-3 rounded-2xl bg-primary-container pr-5 pl-4 font-medium text-on-primary-container shadow-fab md:right-8 md:bottom-8"
    >
      <Icon name={icon} />
      {children}
    </button>
  );
}
