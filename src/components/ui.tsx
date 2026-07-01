"use client";

import type { CSSProperties, ReactNode } from "react";

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "20px 22px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 15, fontWeight: 600 }}>{children}</div>;
}

export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 style={{ fontSize: 27, fontWeight: 700, margin: "0 0 18px", letterSpacing: "-0.01em" }}>
      {children}
    </h1>
  );
}

export function ColorDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        display: "inline-block",
      }}
    />
  );
}

export function Pill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      style={{
        background: color,
        color: "white",
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 20,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            border: "none",
            background: value === opt.value ? "var(--accent)" : "transparent",
            color: value === opt.value ? "white" : "var(--text)",
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? "var(--border)" : "var(--accent)",
        color: "white",
        border: "none",
        borderRadius: 8,
        padding: "11px 22px",
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "var(--panel)",
        color: "var(--text)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "11px 20px",
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

export const inputStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  color: "var(--text)",
  background: "var(--panel)",
};

export const labelStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 5,
};
