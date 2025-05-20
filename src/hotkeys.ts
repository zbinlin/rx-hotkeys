import {
    fromEvent, BehaviorSubject, Subscription, Observable, EMPTY,
    filter, map, bufferCount, withLatestFrom, tap, catchError, scan,
} from "rxjs";
import { StandardKey } from "./keys.js";

// --- Interfaces and Types ---

interface ShortcutConfigBase {
    id: string;
    callback: (event?: KeyboardEvent) => void;
    context?: string | null;
    preventDefault?: boolean;
    description?: string;
}

export interface KeyCombinationConfig extends ShortcutConfigBase {
    keys: {
        /**
         * The main key for the combination.
         * This MUST be a value from the exported `Keys` object
         * (e.g., `Keys.A`, `Keys.Enter`, `Keys.Escape`).
         * The library handles case-insensitivity for single character keys (like A-Z, 0-9)
         * automatically when comparing with the actual browser event's `event.key`.
         * For special, multi-character keys (e.g. "ArrowUp", "Escape"), the value from
         * `Keys` ensures the correct case-sensitive string is used.
         * Refer to: https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values
         */
        key: StandardKey;
        ctrlKey?: boolean;
        altKey?: boolean;
        shiftKey?: boolean;
        metaKey?: boolean;
    };
}

export interface KeySequenceConfig extends ShortcutConfigBase {
    /**
     * An array of keys that form the sequence.
     * Each key in the sequence MUST be a value from the exported `Keys` object
     * (e.g., `Keys.ArrowUp`, `Keys.G`, `Keys.Digit1`).
     * The library handles case-insensitivity for single character keys automatically
     * when comparing with the actual browser event's `event.key`.
     * Refer to: https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values
     * Example: [Keys.Control, Keys.Alt, Keys.Delete] or [Keys.G, Keys.I]
     */
    sequence: StandardKey[];
    /**
     * Optional: Timeout in milliseconds between consecutive key presses in the sequence.
     * If the time between two keys in the sequence exceeds this value, the sequence attempt is reset.
     * Set to 0 or undefined to disable inter-key timeout behavior (uses simpler buffer-based matching).
     */
    sequenceTimeoutMs?: number;
}

type ShortcutConfig = KeyCombinationConfig | KeySequenceConfig;

interface ActiveShortcut {
    id: string;
    config: ShortcutConfig;
    subscription: Subscription;
}

// --- Helper function to compare keys ---
/**
 * Compares a browser event's key with a configured key.
 * - For single character keys (e.g., "a", "A", "7"), comparison is case-insensitive.
 * - For multi-character special keys (e.g., "Enter", "ArrowUp"), comparison is case-sensitive.
 * @param eventKey The `key` property from the `KeyboardEvent`.
 * @param configuredKey The key string from `Keys` used in the configuration.
 * @returns True if the keys match according to the rules, false otherwise.
 */
function compareKey(eventKey: string, configuredKey: StandardKey): boolean {
    if (configuredKey.length === 1 && eventKey.length === 1) {
        return eventKey.toLowerCase() === configuredKey.toLowerCase();
    }
    return eventKey === configuredKey;
}


// --- Hotkeys Library ---

/**
 * Manages keyboard shortcuts for web applications.
 * Allows registration of single key combinations (e.g., Ctrl+S) and key sequences (e.g., g -> i).
 * Supports contexts to enable/disable shortcuts based on application state.
 */
export class Hotkeys {
    private static readonly KEYDOWN_EVENT = "keydown";
    private static readonly LOG_PREFIX = "Hotkeys:";

    private keydown$: Observable<KeyboardEvent>;
    private activeContext$: BehaviorSubject<string | null>;
    private activeShortcuts: Map<string, ActiveShortcut>;
    private debugMode: boolean;

    /**
     * Creates an instance of Hotkeys.
     * @param initialContext - Optional initial context name. Shortcuts will only trigger if their context matches this, or if they have no context defined.
     * @param debugMode - Optional. If true, debug messages will be logged to the console. Defaults to false.
     * @throws Error if not in a browser environment (i.e., `document` or `performance` is undefined).
     */
    constructor(initialContext: string | null = null, debugMode: boolean = false) {
        this.debugMode = debugMode;

        if (typeof document === "undefined" || typeof performance === "undefined") {
            throw new Error(`${Hotkeys.LOG_PREFIX} Hotkeys can only be used in a browser environment with global 'document' and 'performance' objects.`);
        }
        this.keydown$ = fromEvent<KeyboardEvent>(document, Hotkeys.KEYDOWN_EVENT);
        this.activeContext$ = new BehaviorSubject<string | null>(initialContext);
        this.activeShortcuts = new Map();

        if (this.debugMode) {
            console.log(`${Hotkeys.LOG_PREFIX} Library initialized. Initial context: "${initialContext}". Debug mode: ${debugMode}.`);
        }
    }

    /**
     * Sets the active context for shortcuts.
     * Only shortcuts matching this context (or shortcuts with no specific context defined)
     * will be active and can be triggered.
     * @param contextName - The name of the context (e.g., "modal", "editor", "global").
     * Pass `null` to activate shortcuts with no context or to deactivate context-specific shortcuts.
     */
    public setContext(contextName: string | null): void {
        if (this.debugMode) {
            console.log(`${Hotkeys.LOG_PREFIX} Context changed to "${contextName}"`);
        }
        this.activeContext$.next(contextName);
    }

    /**
     * Gets the current active context.
     * @returns The current context name as a string, or `null` if no context is set.
     */
    public getContext(): string | null {
        return this.activeContext$.getValue();
    }

    /**
     * Enables or disables debug logging for the Hotkeys instance.
     * When enabled, various internal actions and shortcut triggers will be logged to the console.
     * @param enable - True to enable debug logs, false to disable.
     */
    public setDebugMode(enable: boolean): void {
        this.debugMode = enable;
        if (this.debugMode) {
            console.log(`${Hotkeys.LOG_PREFIX} Debug mode ${enable ? 'enabled' : 'disabled'}.`);
        }
    }

    /**
     * Checks if a shortcut with the given ID is currently registered and active.
     * @param id - The unique ID of the shortcut to check.
     * @returns True if a shortcut with the specified ID exists, false otherwise.
     */
    public hasShortcut(id: string): boolean {
        return this.activeShortcuts.has(id);
    }

    private filterByContext(source$: Observable<KeyboardEvent>, context?: string | null): Observable<KeyboardEvent> {
        return source$.pipe(
            withLatestFrom(this.activeContext$),
            filter(([/* event */, activeCtx]) => context == null || context === activeCtx),
            map(([event, /* _activeCtx */]) => event)
        );
    }

    private _registerShortcut(
        config: ShortcutConfig,
        subscription: Subscription,
        type: "Combination" | "Sequence",
        detailsForLog: string
    ): string {
        const existingShortcut = this.activeShortcuts.get(config.id);
        if (existingShortcut) {
            console.warn(`${Hotkeys.LOG_PREFIX} Shortcut with ID "${config.id}" already exists. It will be overwritten.`);
            existingShortcut.subscription.unsubscribe();
        }
        this.activeShortcuts.set(config.id, { id: config.id, config, subscription });
        if (this.debugMode) {
            console.log(`${Hotkeys.LOG_PREFIX} ${type} shortcut "${config.id}" added. ${detailsForLog}, Context: ${config.context ?? "any"}`);
        }
        return config.id;
    }

    /**
     * Registers a key combination shortcut (e.g., Ctrl+S, Shift+Enter).
     * The callback is triggered when the specified key and modifier keys are pressed simultaneously.
     * @param config - Configuration object for the key combination.
     * See {@link KeyCombinationConfig} for details.
     * The `key` property within `config.keys` must be a value from the `Keys` object.
     * @returns The ID of the registered shortcut if successful, or `undefined` if the configuration is invalid (e.g., empty key).
     * A warning is logged to the console if the configuration is invalid or if a shortcut with the same ID is overwritten.
     * @example
     * ```typescript
     * import { Keys } from './keys';
     * keyManager.addCombination({
     * id: "saveFile",
     * keys: { key: Keys.S, ctrlKey: true },
     * callback: () => console.log("File saved!"),
     * context: "editor"
     * });
     * ```
     */
    public addCombination(config: KeyCombinationConfig): string | undefined {
        const { keys, callback, context, preventDefault = false, id } = config;

        if (!keys || !keys.key || typeof keys.key !== 'string' || keys.key.trim() === '') {
            console.warn(`${Hotkeys.LOG_PREFIX} Invalid 'keys.key' for combination shortcut "${id}". Key must be a non-empty value from Keys. Shortcut not added.`);
            return undefined;
        }

        const configuredMainKey = keys.key;

        const shortcut$ = this.filterByContext(this.keydown$, context).pipe(
            filter(event =>
                (keys.ctrlKey === undefined || event.ctrlKey === keys.ctrlKey) &&
                (keys.altKey === undefined || event.altKey === keys.altKey) &&
                (keys.shiftKey === undefined || event.shiftKey === keys.shiftKey) &&
                (keys.metaKey === undefined || event.metaKey === keys.metaKey)
            ),
            filter(event => compareKey(event.key, configuredMainKey)),
            tap(event => {
                if (this.debugMode) {
                    const preventAction = preventDefault ? ", preventing default" : "";
                    console.log(`${Hotkeys.LOG_PREFIX} Combination "${id}" triggered${preventAction}.`);
                }
                if (preventDefault) event.preventDefault();
            }),
            catchError(err => {
                console.error(`${Hotkeys.LOG_PREFIX} Error in combination stream for shortcut "${id}":`, err);
                return EMPTY;
            })
        );
        const subscription = shortcut$.subscribe(event => {
            try {
                callback(event);
            } catch (e) {
                console.error(`${Hotkeys.LOG_PREFIX} Error in user callback for combination shortcut "${id}":`, e);
            }
        });

        const keyDetails = `key: "${keys.key}"` +
                           (keys.ctrlKey !== undefined ? `, ctrlKey: ${keys.ctrlKey}` : "") +
                           (keys.altKey !== undefined ? `, altKey: ${keys.altKey}` : "") +
                           (keys.shiftKey !== undefined ? `, shiftKey: ${keys.shiftKey}` : "") +
                           (keys.metaKey !== undefined ? `, metaKey: ${keys.metaKey}` : "");

        return this._registerShortcut(config, subscription, "Combination", `Keys: { ${keyDetails} }`);
    }

    /**
     * Registers a key sequence shortcut (e.g., g -> i, or ArrowUp -> ArrowUp -> ArrowDown).
     * The callback is triggered when the specified keys are pressed in order.
     * An optional timeout can be specified for the time allowed between key presses in the sequence.
     * @param config - Configuration object for the key sequence.
     * See {@link KeySequenceConfig} for details.
     * Each key in the `sequence` array must be a value from the `Keys` object.
     * @returns The ID of the registered shortcut if successful, or `undefined` if the configuration is invalid (e.g., empty sequence or invalid keys).
     * A warning is logged to the console if the configuration is invalid or if a shortcut with the same ID is overwritten.
     * @example
     * ```typescript
     * import { Keys } from './keys';
     * keyManager.addSequence({
     * id: "konamiCode",
     * sequence: [Keys.ArrowUp, Keys.ArrowUp, Keys.ArrowDown, Keys.ArrowDown, Keys.A, Keys.B],
     * callback: () => console.log("Konami!"),
     * sequenceTimeoutMs: 2000 // 2 seconds between keys
     * });
     * ```
     */
    public addSequence(config: KeySequenceConfig): string | undefined {
        const { sequence, callback, context, preventDefault = false, id, sequenceTimeoutMs } = config;

        if (!Array.isArray(sequence) || sequence.length === 0) {
            console.warn(`${Hotkeys.LOG_PREFIX} Sequence for shortcut "${id}" is empty or invalid. Shortcut not added.`);
            return undefined;
        }
        if (sequence.some(key => typeof key !== 'string' || key.trim() === '')) {
            console.warn(`${Hotkeys.LOG_PREFIX} Invalid key in sequence for shortcut "${id}". All keys must be non-empty strings from Keys. Shortcut not added.`);
            return undefined;
        }

        const configuredSequence = sequence;
        const sequenceLength = configuredSequence.length;
        let shortcut$: Observable<KeyboardEvent[]>;
        const baseKeydownStream$ = this.filterByContext(this.keydown$, context);

        if (sequenceTimeoutMs && sequenceTimeoutMs > 0) {
            interface SequenceScanState {
                matchedEvents: KeyboardEvent[];
                lastEventTime: number;
                emitState: 'emit' | 'ignore' | 'in-progress';
            }

            shortcut$ = baseKeydownStream$.pipe(
                scan<KeyboardEvent, SequenceScanState>(
                    (acc, event) => {
                        let { matchedEvents, lastEventTime } = acc;
                        const currentTime = performance.now();

                        if (acc.emitState === 'emit') {
                            matchedEvents = [];
                            lastEventTime = 0;
                        }

                        if (matchedEvents.length > 0 && (currentTime - lastEventTime > sequenceTimeoutMs)) {
                            if (this.debugMode) {
                                console.log(`${Hotkeys.LOG_PREFIX} Sequence "${id}" (timeout: ${sequenceTimeoutMs}ms) attempt timed out. Matched: ${matchedEvents.map(e=>e.key).join(',')}. Resetting.`);
                            }
                            matchedEvents = [];
                        }

                        const nextExpectedKeyIndex = matchedEvents.length;

                        if (nextExpectedKeyIndex >= sequenceLength) {
                            if (sequenceLength > 0 && compareKey(event.key, configuredSequence[0])) {
                                return { matchedEvents: [event], lastEventTime: currentTime, emitState: 'in-progress' };
                            }
                            return { matchedEvents: [], lastEventTime: 0, emitState: 'ignore' };
                        }

                        if (compareKey(event.key, configuredSequence[nextExpectedKeyIndex])) {
                            const newMatchedEvents = [...matchedEvents, event];
                            if (newMatchedEvents.length === sequenceLength) {
                                if (this.debugMode) console.log(`${Hotkeys.LOG_PREFIX} Sequence "${id}" (timeout: ${sequenceTimeoutMs}ms) matched.`);
                                return { matchedEvents: newMatchedEvents, lastEventTime: currentTime, emitState: 'emit' };
                            } else {
                                return { matchedEvents: newMatchedEvents, lastEventTime: currentTime, emitState: 'in-progress' };
                            }
                        } else {
                            if (matchedEvents.length > 0 && this.debugMode) {
                                 console.log(`${Hotkeys.LOG_PREFIX} Sequence "${id}" (timeout: ${sequenceTimeoutMs}ms) broken by key "${event.key}". Matched: ${matchedEvents.map(e=>e.key).join(',')}. Resetting.`);
                            }
                            if (sequenceLength > 0 && compareKey(event.key, configuredSequence[0])) {
                                return { matchedEvents: [event], lastEventTime: currentTime, emitState: 'in-progress' };
                            } else {
                                return { matchedEvents: [], lastEventTime: 0, emitState: 'ignore' };
                            }
                        }
                    },
                    { matchedEvents: [], lastEventTime: 0, emitState: 'ignore' }
                ),
                filter(state => state.emitState === 'emit'),
                map(state => state.matchedEvents)
            );
        } else {
            shortcut$ = baseKeydownStream$.pipe(
                bufferCount(sequenceLength, 1),
                filter((events: KeyboardEvent[]) => {
                    if (events.length < sequenceLength) return false;
                    return events.every((event, index) => compareKey(event.key, configuredSequence[index]));
                })
            );
        }

        const finalShortcut$ = shortcut$.pipe(
            tap((events: KeyboardEvent[]) => {
                if (this.debugMode) {
                    const timeoutInfo = (sequenceTimeoutMs && sequenceTimeoutMs > 0) ? ` (with timeout logic)` : ` (no timeout logic)`;
                    const preventAction = preventDefault ? ", preventing default for last event" : "";
                    console.log(`${Hotkeys.LOG_PREFIX} Sequence "${id}" triggered${timeoutInfo}${preventAction}.`);
                }
                if (preventDefault && events.length > 0) {
                    events[events.length - 1].preventDefault();
                }
            }),
            catchError(err => {
                console.error(`${Hotkeys.LOG_PREFIX} Error in sequence stream for shortcut "${id}":`, err);
                return EMPTY;
            })
        );

        const subscription = finalShortcut$.subscribe((events: KeyboardEvent[]) => {
            try {
                if (events.length > 0) callback(events[events.length - 1]);
            } catch (e) {
                console.error(`${Hotkeys.LOG_PREFIX} Error in user callback for sequence shortcut "${id}":`, e);
            }
        });

        const logDetails = `Sequence: ${sequence.join(" -> ")}${sequenceTimeoutMs && sequenceTimeoutMs > 0 ? ` (timeout: ${sequenceTimeoutMs}ms)` : ''}`;
        return this._registerShortcut(config, subscription, "Sequence", logDetails);
    }

    /**
     * Removes a registered shortcut by its ID.
     * This will unsubscribe from the underlying keyboard event stream for that shortcut.
     * @param id - The unique ID of the shortcut to remove.
     * @returns True if the shortcut was found and removed, false otherwise.
     * A warning is logged to the console if no shortcut with the given ID is found.
     */
    public remove(id: string): boolean {
        const shortcut = this.activeShortcuts.get(id);
        if (shortcut) {
            shortcut.subscription.unsubscribe();
            this.activeShortcuts.delete(id);
            if (this.debugMode) console.log(`${Hotkeys.LOG_PREFIX} Shortcut "${id}" removed.`);
            return true;
        }
        console.warn(`${Hotkeys.LOG_PREFIX} Shortcut with ID "${id}" not found for removal.`);
        return false;
    }

    /**
     * Retrieves a list of all currently active (registered) shortcut configurations.
     * This can be useful for displaying available shortcuts to the user or for debugging.
     * @returns An array of objects, where each object represents an active shortcut
     * and includes its `id`, `description` (if provided), `context` (if any),
     * and `type` ("combination" or "sequence").
     */
    public getActiveShortcuts(): {id: string; description?: string; context?: string | null; type: "combination" | "sequence"}[] {
        const shortcuts: Array<{id: string; description?: string; context?: string | null; type: "combination" | "sequence"}> = [];
        for (const [id, activeShortcut] of this.activeShortcuts.entries()) {
            shortcuts.push({
                id,
                description: activeShortcut.config.description,
                context: activeShortcut.config.context,
                type: 'keys' in activeShortcut.config ? "combination" : "sequence"
            });
        }
        return shortcuts;
    }

    /**
     * Cleans up all active subscriptions and resources used by the Hotkeys instance.
     * This method should be called when the Hotkeys instance is no longer needed
     * (e.g., when a component unmounts or the application is shutting down) to prevent memory leaks.
     * After calling `destroy()`, the instance should not be used further.
     */
    public destroy(): void {
        if (this.debugMode) console.log(`${Hotkeys.LOG_PREFIX} Destroying library instance and unsubscribing all shortcuts.`);
        this.activeShortcuts.forEach(shortcut => shortcut.subscription.unsubscribe());
        this.activeShortcuts.clear();
        this.activeContext$.complete(); // Complete the BehaviorSubject to release its resources
        if (this.debugMode) console.log(`${Hotkeys.LOG_PREFIX} Library destroyed.`);
    }
}
