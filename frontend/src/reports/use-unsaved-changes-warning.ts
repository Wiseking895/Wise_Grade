import { useEffect } from 'react'

const DEFAULT_MESSAGE =
  'You have unsaved changes. Leave this page and discard them?'

function isSameDocumentLink(anchor: HTMLAnchorElement): boolean {
  if (anchor.target && anchor.target !== '_self') return false
  if (anchor.hasAttribute('download')) return false

  const href = anchor.getAttribute('href')

  if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
    return false
  }

  const url = new URL(anchor.href, window.location.href)

  return (
    url.origin === window.location.origin &&
    url.pathname + url.search !==
      window.location.pathname + window.location.search
  )
}

/**
 * Warns before a class teacher leaves a partially saved term-records page.
 *
 * Two exits are covered:
 *
 * 1. A browser refresh, tab close or typed URL fires `beforeunload`.
 * 2. An in-app navigation click is intercepted while the page is dirty and asks
 *    for confirmation before the router changes page.
 *
 * The check is deliberately small and local: the pages already block term and
 * class switches while dirty, so this covers the remaining exits without
 * adding a router-level dependency.
 */
export function useUnsavedChangesWarning(
  dirty: boolean,
  message: string = DEFAULT_MESSAGE,
): void {
  useEffect(() => {
    if (!dirty) return

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      // Older browsers still need returnValue to show the native prompt.
      event.returnValue = message
    }

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }

      const target = event.target

      if (!(target instanceof Element)) return

      const anchor = target.closest('a')

      if (!(anchor instanceof HTMLAnchorElement)) return
      if (!isSameDocumentLink(anchor)) return

      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty, message])
}
