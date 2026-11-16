import { useId, type InputHTMLAttributes } from 'react'

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
}

export default function FormField({
  label,
  error,
  hint,
  id,
  ...inputProps
}: FormFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div>
      <label
        htmlFor={inputId}
        className="block text-sm font-semibold text-gradely-text"
      >
        {label}
      </label>
      <input
        {...inputProps}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`mt-1.5 w-full rounded-xl border bg-gradely-white px-3.5 py-2.5 text-sm text-gradely-text shadow-sm transition-colors placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
            : 'border-slate-300 focus:border-gradely-blue focus:ring-gradely-blue/25'
        }`}
      />
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-gradely-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}
