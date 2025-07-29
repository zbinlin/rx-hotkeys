import { useEffect, useMemo } from "react";
import { useEventCallback } from "./useEventCallback.js";
import {
    type KeyCombinationConfig,
    type KeySequenceConfig,
} from "../../core/index.js";
import { useHotkeysManager }  from "./provider.js";

// Define options for the new hooks, excluding properties managed by the hook itself.
export type HotkeyHookOptions = Omit<KeyCombinationConfig, "id" | "keys">;
export type SequenceHookOptions = Omit<KeySequenceConfig, "id" | "sequence">;

// Internal hook to handle the common logic for both combination and sequence hotkeys
function useBaseHotkey(
    type: "combination" | "sequence",
    keyOrSequence: KeyCombinationConfig["keys"] | KeySequenceConfig["sequence"],
    callback: (event: KeyboardEvent) => void,
    options?: HotkeyHookOptions | SequenceHookOptions,
) {
    const manager = useHotkeysManager();
    // Generate a stable, unique ID for this hook instance.
    const hotkeyId = useMemo(() => `react-hotkey-${Math.random().toString(36).slice(2, 11)}`, []);

    // Use the provided useEventCallback hook.
    // This creates a stable function `onHotkey` that always calls the latest `callback`.
    const onHotkey = useEventCallback(callback);

    // Memoize options object to prevent effect re-runs. It's recommended that users memoize this object themselves for performance.
    const memoizedOptions = useMemo(() => options, [JSON.stringify(options)]);

    useEffect(() => {
        if (!manager || !keyOrSequence) {
            return;
        }

        const config = {
            id: hotkeyId,
            ...memoizedOptions,
        };

        const hotkey$ = type === "combination"
            ? manager.addCombination({ ...config, keys: keyOrSequence as KeyCombinationConfig["keys"] })
            : manager.addSequence({ ...config, sequence: keyOrSequence as KeySequenceConfig["sequence"] });

        const _subscription = hotkey$.subscribe(onHotkey);

        return () => {
            // The subscription is implicitly cleaned up because remove() completes the Observable.
            manager.remove(hotkeyId);
        };
    // Re-run the effect if the manager, keys, options, or callback changes.
    }, [manager, hotkeyId, JSON.stringify(keyOrSequence), memoizedOptions, onHotkey, type]);
}


/**
 * React hook to declaratively register a key combination hotkey.
 * The hotkey is automatically registered when the component mounts and unregistered when it unmounts.
 *
 * @param keys The key combination to listen for. Can be a string like "ctrl+s" or an array.
 * @param callback The function to execute when the hotkey is triggered.
 * @param options An optional configuration object for `preventDefault`, `context`, `target`, etc.
 *
 * @example
 * import { useHotkeys, Keys } from "./wraper";
 *
 * function MyComponent() {
 * const [count, setCount] = useState(0);
 *
 * // The callback can directly use the latest `count` state without stale closure issues,
 * // and we no longer need to pass a dependency array for it.
 * useHotkeys("c", () => {
 * console.log(`Current count is: ${count}. Incrementing.`);
 * setCount(count + 1);
 * });
 *
 * return <div>Count: {count} (Press "c" to increment)</div>;
 * }
 */
export function useHotkeys(
    keys: KeyCombinationConfig["keys"],
    callback: (event: KeyboardEvent) => void,
    options?: HotkeyHookOptions,
): void {
    useBaseHotkey("combination", keys, callback, options);
}

/**
 * React hook to declaratively register a key sequence hotkey.
 * The hotkey is automatically registered when the component mounts and unregistered when it unmounts.
 *
 * @param sequence The key sequence to listen for. Can be a string like "g -> i" or an array.
 * @param callback The function to execute when the hotkey is triggered.
 * @param options An optional configuration object for `preventDefault`, `context`, `sequenceTimeoutMs`, etc.
 *
 * @example
 * useSequence("g -> i", () => {
 * console.log("Navigating to inbox...");
 * }, { sequenceTimeoutMs: 1000 });
 */
export function useSequence(
    sequence: KeySequenceConfig["sequence"],
    callback: (event: KeyboardEvent) => void,
    options?: SequenceHookOptions,
): void {
    useBaseHotkey("sequence", sequence, callback, options);
}

