import { useRef, useCallback } from "react";
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect.js";

/**
 * A custom React hook that creates a stable function reference (a "callback event")
 * that will always call the latest version of the function passed to it.
 * This is a TypeScript implementation of the pattern used to polyfill the
 * upcoming official `useEffectEvent` hook.
 *
 * @template T - The type of the callback function.
 * @param {T} callback - The function to be made stable. This function can use
 * the latest props and state, and it will be updated on every render.
 * @returns {T} A memoized function that has a stable identity across re-renders
 * but executes the most recent version of the `callback`.
 */
export function useEventCallback<T extends (...args: any[]) => any>(callback: T): T {
    // 1. Store the latest callback in a ref. The ref's type is the function signature.
    const callbackRef = useRef<T>(callback);

    // 2. Use useLayoutEffect to update the ref synchronously after every render.
    // This ensures the ref always holds the latest version of the callback
    // before any other effects run.
    useIsomorphicLayoutEffect(() => {
        callbackRef.current = callback;
    }); // No dependency array means this effect runs on every render.

    // 3. Return a stable, memoized function.
    // This function's identity will never change because of the empty dependency array.
    // We cast the returned function to type T to match the input function signature.
    return useCallback((...args: Parameters<T>): ReturnType<T> => {
        // When called, it executes the *current* function stored in the ref.
        return callbackRef.current(...args);
    }, []) as T;
}
