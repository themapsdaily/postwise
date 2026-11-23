export function Counter({ count, max }: { count: number; max: number }) {
  const over = count > max;
  return <span className={`counter ${over ? "over" : ""}`} aria-label={`${count} of ${max} characters${over ? ", over the limit" : ""}`}>{count}/{max}</span>;
}
