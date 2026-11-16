import {
  AlertCircle,
  Inbox,
  Loader2,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-gradely-navy text-white shadow-sm hover:bg-[#123c80] focus-visible:ring-gradely-blue/40',
  secondary:
    'border border-slate-300 bg-white text-gradely-text shadow-sm hover:bg-gradely-light focus-visible:ring-gradely-blue/30',
  ghost:
    'text-gradely-navy hover:bg-gradely-navy/5 focus-visible:ring-gradely-blue/30',
  danger:
    'bg-red-700 text-white shadow-sm hover:bg-red-800 focus-visible:ring-red-300',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
    >
      {loading ? (
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      ) : null}
      {children}
    </button>
  )
}

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 ${className}`}
    >
      {children}
    </section>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-gradely-navy sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-gradely-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'info'
}) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700',
    success: 'bg-gradely-green/10 text-[#137026]',
    warning: 'bg-gradely-gold/15 text-[#7a5400]',
    info: 'bg-gradely-blue/10 text-gradely-navy',
  }

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

export function LoadingPanel({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-10 text-sm font-medium text-gradely-muted"
    >
      <Loader2
        aria-hidden="true"
        className="size-5 animate-spin text-gradely-blue"
      />
      {label}
    </div>
  )
}

export function ErrorNotice({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2">
        <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p>{message}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

export function AccessDenied({ message }: { message?: string }) {
  return (
    <div className="rounded-2xl border border-gradely-gold/30 bg-gradely-gold/10 p-6">
      <div className="flex items-start gap-3">
        <AlertCircle
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-[#7a5400]"
        />
        <div>
          <h2 className="text-base font-bold text-[#6b4a00]">
            Administrator access required
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-[#7a5400]">
            {message ??
              'Your school role does not allow this part of school configuration.'}
          </p>
        </div>
      </div>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: LucideIcon
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <span className="mx-auto inline-flex rounded-2xl bg-gradely-light p-3">
        <Icon aria-hidden="true" className="size-6 text-gradely-blue" />
      </span>
      <h2 className="mt-3 text-base font-bold text-gradely-text">{title}</h2>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-gradely-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`my-auto w-full rounded-2xl bg-white shadow-2xl ${
          wide ? 'max-w-3xl' : 'max-w-xl'
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-gradely-text">
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="mt-1 text-sm leading-relaxed text-gradely-muted"
              >
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-gradely-muted transition-colors hover:bg-slate-100 hover:text-gradely-text"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  busy = false,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  busy?: boolean
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="text-sm leading-relaxed text-gradely-muted">{description}</p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          onClick={onConfirm}
          loading={busy}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

export function SelectField({
  label,
  error,
  hint,
  id,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string
  error?: string
  hint?: string
}) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const errorId = `${selectId}-error`
  const hintId = `${selectId}-hint`
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div>
      <label
        htmlFor={selectId}
        className="block text-sm font-semibold text-gradely-text"
      >
        {label}
      </label>
      <select
        {...props}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`mt-1.5 w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-gradely-text shadow-sm transition-colors focus:outline-none focus:ring-2 ${
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
            : 'border-slate-300 focus:border-gradely-blue focus:ring-gradely-blue/25'
        }`}
      >
        {children}
      </select>
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

export function TextareaField({
  label,
  error,
  hint,
  id,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string
  error?: string
  hint?: string
}) {
  const generatedId = useId()
  const textareaId = id ?? generatedId
  const errorId = `${textareaId}-error`
  const hintId = `${textareaId}-hint`
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div>
      <label
        htmlFor={textareaId}
        className="block text-sm font-semibold text-gradely-text"
      >
        {label}
      </label>
      <textarea
        {...props}
        id={textareaId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`mt-1.5 w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-gradely-text shadow-sm transition-colors focus:outline-none focus:ring-2 ${
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
