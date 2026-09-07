export function LeadFunnel({ steps }: { steps: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...steps.map((step) => step.value));

  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map((step, index) => {
        const previous = steps[index - 1]?.value;
        const dropOff =
          previous !== undefined && previous > 0 ? Math.round((step.value / previous) * 100) : null;
        return (
          <li key={step.label} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-[12px] text-ink-600">{step.label}</span>
            <span className="h-6 min-w-0 flex-1 overflow-hidden rounded bg-ink-100">
              <span
                className="flex h-full items-center justify-end rounded bg-accent-600 px-2 text-[11px] font-medium text-white"
                style={{ width: `${Math.max(4, (step.value / max) * 100)}%` }}
              >
                {step.value > 0 ? step.value : ''}
              </span>
            </span>
            <span className="w-10 shrink-0 text-right text-[11px] text-ink-400 tabular">
              {dropOff !== null ? `${dropOff}%` : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
