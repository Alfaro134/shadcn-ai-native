import { useCallback, useEffect, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";

import type { Message } from "../domain/message";

const COPIED_RESET_MS = 1500;

/** Copies a message's text and remembers which one was copied, for a short "✓ Copied" state. */
export function useCopyFeedback() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async (message: Message) => {
    try {
      await Clipboard.setStringAsync(message.content);
    } catch {
      return;
    }
    // The clipboard write is async: don't touch state if the screen has since unmounted.
    if (!mounted.current) return;
    setCopiedId(message.id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopiedId(null), COPIED_RESET_MS);
  }, []);

  return { copiedId, copy };
}
