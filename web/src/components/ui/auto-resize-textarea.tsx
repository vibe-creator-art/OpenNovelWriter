'use client'

import * as React from "react"

import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"

type AutoResizeTextareaProps = React.ComponentProps<typeof Textarea> & {
  autoResize?: boolean
}

const AutoResizeTextarea = React.forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(
  ({ autoResize = true, className, onChange, value, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null)

    const setRefs = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node
        if (typeof forwardedRef === "function") {
          forwardedRef(node)
        } else if (forwardedRef) {
          ;(forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node
        }
      },
      [forwardedRef]
    )

    const resizeTextarea = React.useCallback(() => {
      const textarea = innerRef.current
      if (!textarea) return

      textarea.style.height = "auto"
      const borderHeight = textarea.offsetHeight - textarea.clientHeight
      textarea.style.height = `${textarea.scrollHeight + borderHeight}px`
    }, [])

    React.useLayoutEffect(() => {
      if (!autoResize) return
      resizeTextarea()
    }, [autoResize, resizeTextarea, value])

    return (
      <Textarea
        ref={setRefs}
        value={value}
        onChange={(e) => {
          onChange?.(e)
          if (autoResize) resizeTextarea()
        }}
        className={cn("overflow-hidden resize-none", className)}
        {...props}
      />
    )
  }
)
AutoResizeTextarea.displayName = "AutoResizeTextarea"

export { AutoResizeTextarea }
