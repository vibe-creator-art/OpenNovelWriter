"use client";

import { useEffect } from "react";

export function IPhoneViewport() {
  useEffect(() => {
    if (!/iPhone/.test(navigator.userAgent)) return;

    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!viewport) return;

    const originalContent = viewport.content;
    // Limit iPhone focus zoom while allowing the browser's manual pinch zoom.
    viewport.content = `${originalContent}, maximum-scale=1`;

    return () => {
      viewport.content = originalContent;
    };
  }, []);

  return null;
}
