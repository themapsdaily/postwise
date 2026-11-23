export interface SegOption<T extends string> { value: T; label: string; disabled?: boolean; title?: string }

/** Compact single-choice toggle. */
export function Segmented<T extends string>({ value, options, onChange, label, size }: {
  value: T; options: SegOption<T>[]; onChange: (v: T) => void; label: string; size?: "sm";
}) {
  return (
    <div className={`seg ${size ?? ""}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} disabled={o.disabled} title={o.title}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
