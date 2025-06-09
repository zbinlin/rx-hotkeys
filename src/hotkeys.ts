import {
    fromEvent, BehaviorSubject, EMPTY, Observable,
    filter, map, bufferCount, withLatestFrom, tap, catchError, scan, merge, Subject, takeUntil,
} from "rxjs";
import { type StandardKey } from "./keys.js";

// --- Enums, Interfaces and Types ---

export enum ShortcutTypes {
    Combination = "combination",
    Sequence = "sequence"
}

enum EmitStates {
    Emit,
    Ignore,
    InProgress,
}

interface SequenceScanState { // As per your uploaded file
    matchedEvents: KeyboardEvent[];
    lastEventTime: number;
    emitState: EmitStates;
}

interface ShortcutConfigBase {
    id: string;
    /**
     * @deprecated The callback property is deprecated. `addCombination` and `addSequence` now return an Observable. Please subscribe to it instead.
     */
    callback?: (event: KeyboardEvent) => void;
    context?: string | null;
    preventDefault?: boolean;
    description?: string;
    /**
     * **Only applicable if the shortcut has no top-level `context` defined.**
     * If `true`, this shortcut is **strictly global** and will only fire when the active
     * hotkey context is `null`.
     * If `false` or `undefined` (the default), the shortcut can fire in *any* context,
     * but will be suppressed by an identical shortcut that belongs to the active context.
     * @default false
     */
    strict?: boolean;
}

/**
 * Defines a single key trigger, which can be a StandardKey (for simple presses like "Escape")
 * or an object specifying the main key and its modifiers (e.g., { key: Keys.S, ctrlKey: true }).
 */
type KeyCombinationTrigger = {
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
} | StandardKey;


export interface KeyCombinationConfig extends ShortcutConfigBase {
    /**
     * Defines the key or key combination(s) that trigger the shortcut.
     * Can be a single trigger or an array of triggers.
     * Each trigger can be an object specifying the main `key` (from `StandardKey`) and optional
     * modifiers (`ctrlKey`, `altKey`, `shiftKey`, `metaKey`).
     * Example: `{ key: Keys.S, ctrlKey: true }` for Ctrl+S.
     *
     * Alternatively, for a simple key press without any modifiers, a trigger can be
     * a `StandardKey` directly.
     * Example: `Keys.Escape` for the Escape key. When using this shorthand,
     * it implies that no modifier keys (Ctrl, Alt, Shift, Meta) should be active.
     *
     * To define multiple triggers for the same action:
     * Example: `keys: [Keys.Enter, { key: Keys.Space, ctrlKey: true }]`
     */
    keys: KeyCombinationTrigger | KeyCombinationTrigger[];
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

export interface ActiveShortcut { // Made exportable as per previous diff
    id: string;
    config: ShortcutConfig;
    terminator$: Subject<void>;
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
            throw new Error(`${Hotkeys.LOG_PREFIX} Hotkeys can only be used in a browser environment with global "document" and "performance" objects.`);
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
     * @returns `true` if the context was changed, `false` if the new context was the same as the current one.
     */
    public setContext(contextName: string | null): boolean {
        const currentContext = this.activeContext$.getValue();
        if (currentContext === contextName) {
            if (this.debugMode) {
                // Optional: Log that no change is happening, or simply do nothing.
                console.log(`${Hotkeys.LOG_PREFIX} setContext called with the same context "${contextName}". No change made.`);
            }
            return false; // Context was NOT updated
        }

        // If we reach here, the context is actually changing.
        if (this.debugMode) {
            console.log(`${Hotkeys.LOG_PREFIX} Context changed from "${currentContext}" to "${contextName}".`);
        }
        this.activeContext$.next(contextName);
        return true; // Context WAS updated
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
        if (this.debugMode === enable) {
            return;
        }
        this.debugMode = enable;
        if (enable) {
            console.log(`${Hotkeys.LOG_PREFIX} Debug mode enabled.`);
        } else {
            console.log(`${Hotkeys.LOG_PREFIX} Debug mode disabled.`);
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

    /**
     * An Observable that emits the new context name (or null) whenever the active context changes.
     * This allows external parts of the application to react to context transitions.
     *
     * Note: This observable benefits from the distinct check within the `setContext` method,
     * meaning it will only emit when the context value actually changes.
     *
     * @example
     * ```typescript
     * const hotkeys = new Hotkeys();
     * const subscription = hotkeys.onContextChange$.subscribe(newContext => {
     * console.log("Hotkey context changed to:", newContext);
     * // Update UI or perform other actions
     * });
     * // To unsubscribe when no longer needed:
     * // subscription.unsubscribe();
     * ```
     */
    public get onContextChange$(): Observable<string | null> {
        return this.activeContext$.asObservable();
    }

    /**
     * Compares two sequences of StandardKey arrays to see if they are identical.
     * @param seq1 - The first sequence array.
     * @param seq2 - The second sequence array.
     * @returns True if the sequences are identical, false otherwise.
     */
    private _areSequencesIdentical(seq1: StandardKey[], seq2: StandardKey[]): boolean {
        if (seq1.length !== seq2.length) {
            return false;
        }
        for (let i = 0; i < seq1.length; i++) {
            if (seq1[i] !== seq2[i]) { // Direct comparison for canonical StandardKey values
                return false;
            }
        }
        return true;
    }

    /**
     * Checks if a given KeyCombinationConfig matches a given KeyboardEvent.
     * This is used internally for priority checking.
     * @param shortcutConfig The KeyCombinationConfig to check.
     * @param event The KeyboardEvent to match against.
     * @returns True if the shortcutConfig matches the event, false otherwise.
     */
    private _shortcutMatchesEvent(shortcutConfig: KeyCombinationConfig, event: KeyboardEvent): boolean {
        const keyTriggers = Array.isArray(shortcutConfig.keys) ? shortcutConfig.keys : [shortcutConfig.keys];

        for (const keyInput of keyTriggers) {
            let configuredMainKey: StandardKey;
            let ctrlKeyConfig: boolean | undefined;
            let altKeyConfig: boolean | undefined;
            let shiftKeyConfig: boolean | undefined;
            let metaKeyConfig: boolean | undefined;

            if (typeof keyInput === "string") {
                if ((keyInput as string) === "") continue; // Invalid trigger, skip
                configuredMainKey = keyInput;
                ctrlKeyConfig = false;
                altKeyConfig = false;
                shiftKeyConfig = false;
                metaKeyConfig = false;
            } else {
                if (!keyInput.key || (keyInput.key as string) === "") continue; // Invalid trigger, skip
                configuredMainKey = keyInput.key;
                ctrlKeyConfig = keyInput.ctrlKey;
                altKeyConfig = keyInput.altKey;
                shiftKeyConfig = keyInput.shiftKey;
                metaKeyConfig = keyInput.metaKey;
            }

            const keyMatch = compareKey(event.key, configuredMainKey);
            if (!keyMatch) continue;

            const ctrlMatch = (ctrlKeyConfig === undefined) ? true : (event.ctrlKey === ctrlKeyConfig);
            const altMatch = (altKeyConfig === undefined) ? true : (event.altKey === altKeyConfig);
            const shiftMatch = (shiftKeyConfig === undefined) ? true : (event.shiftKey === shiftKeyConfig);
            const metaMatch = (metaKeyConfig === undefined) ? true : (event.metaKey === metaKeyConfig);

            if (ctrlMatch && altMatch && shiftMatch && metaMatch) {
                return true;
            }
        }
        return false;
    }


    private filterByContext(source$: Observable<KeyboardEvent>, context: string | null | undefined, strict: boolean): Observable<KeyboardEvent> {
        return source$.pipe(
            withLatestFrom(this.activeContext$),
            filter(([/* event */, activeCtx]) => {
                if (context == null) {
                    if (strict) {
                        return activeCtx == null;
                    } else {
                        return true;
                    }
                } else {
                    return context === activeCtx;
                }
            }),
            map(([event, /* _activeCtx */]) => event),
        );
    }

    private _registerShortcut(
        config: ShortcutConfig,
        terminator$: Subject<void>,
        type: ShortcutTypes,
        detailsForLog: string
    ): void {
        const existingShortcut = this.activeShortcuts.get(config.id);
        if (existingShortcut) {
            console.warn(`${Hotkeys.LOG_PREFIX} Shortcut with ID "${config.id}" already exists. The old instance will be terminated and overwritten.`);
            existingShortcut.terminator$.next();
            existingShortcut.terminator$.complete();
        }
        this.activeShortcuts.set(config.id, { id: config.id, config, terminator$ });
        if (this.debugMode) {
            console.log(`${Hotkeys.LOG_PREFIX} ${type} shortcut "${config.id}" added. ${detailsForLog}, Context: ${config.context ?? "any"}`);
        }
    }

    /**
     * Parses a single key trigger definition (either shorthand StandardKey or an object with modifiers)
     * into its constituent parts: main key and modifier states.
     * @param keyInput - The KeyCombinationTrigger to parse.
     * @param shortcutId - The ID of the shortcut this key trigger belongs to (for logging).
     * @returns An object containing configuredMainKey and modifier states, or null if parsing fails.
     */
    private _parseKeyTrigger(keyInput: KeyCombinationTrigger, shortcutId: string): {
        configuredMainKey: StandardKey;
        ctrlKeyConfig?: boolean;
        altKeyConfig?: boolean;
        shiftKeyConfig?: boolean;
        metaKeyConfig?: boolean;
        logDetails: string;
    } | null {
        if (typeof keyInput === "string") {
            if ((keyInput as string) === "") {
                console.warn(`${Hotkeys.LOG_PREFIX} Invalid key (shorthand) in shortcut "${shortcutId}". Key string must not be empty.`);
                return null;
            }
            return {
                configuredMainKey: keyInput,
                ctrlKeyConfig: false,
                altKeyConfig: false,
                shiftKeyConfig: false,
                metaKeyConfig: false,
                logDetails: `key: "${keyInput}" (no mods)`,
            };
        } else {
            if (!keyInput.key || typeof keyInput.key !== "string" || (keyInput.key as string) === "") {
                console.warn(`${Hotkeys.LOG_PREFIX} Invalid "key" property in shortcut "${shortcutId}". Key must be a non-empty string value from Keys.`);
                return null;
            }
            const logDetails = `key: "${keyInput.key}"` +
                (keyInput.ctrlKey !== undefined ? `, ctrl: ${keyInput.ctrlKey}` : "") +
                (keyInput.altKey !== undefined ? `, alt: ${keyInput.altKey}` : "") +
                (keyInput.shiftKey !== undefined ? `, shift: ${keyInput.shiftKey}` : "") +
                (keyInput.metaKey !== undefined ? `, meta: ${keyInput.metaKey}` : "");
            return {
                configuredMainKey: keyInput.key,
                ctrlKeyConfig: keyInput.ctrlKey,
                altKeyConfig: keyInput.altKey,
                shiftKeyConfig: keyInput.shiftKey,
                metaKeyConfig: keyInput.metaKey,
                logDetails,
            };
        }
    }

    /**
     * Registers a key combination shortcut (e.g., Ctrl+S, Shift+Enter, or a single key like Escape)
     * and returns an Observable that emits the `KeyboardEvent` when the combination is triggered.
     * @param config - Configuration object for the key combination.
     * See {@link KeyCombinationConfig} for details.
     * The `key` property (or the direct `StandardKey` if using shorthand) must be a value from the `Keys` object.
     * @returns An `Observable<KeyboardEvent>` that you can subscribe to. The stream will be automatically
     * completed if the shortcut is removed via `remove(id)` or `destroy()`, or if it's overwritten.
     * If the configuration is invalid, an empty Observable is returned and a warning is logged.
     * @example
     * ```typescript
     * import { Keys } from "./keys";
     * // For Ctrl+S
     * const save$ = keyManager.addCombination({
     * id: "saveFile",
     * keys: { key: Keys.S, ctrlKey: true },
     * context: "editor"
     * });
     * save$.subscribe(event => console.log("File saved!", event));
     *
     * // For just the Escape key, or Ctrl+Space
     * const close$ = keyManager.addCombination({
     * id: "closeModal",
     * keys: [Keys.Escape, {key: Keys.Space, ctrlKey: true}],
     * });
     * close$.subscribe(() => console.log("Modal closed!"));
     * ```
     */
    public addCombination(config: KeyCombinationConfig): Observable<KeyboardEvent> {
        const { keys, context, preventDefault = false, id, strict = false } = config;

        if (config.callback) {
            console.warn(`${Hotkeys.LOG_PREFIX} Shortcut "${id}" was provided a callback, but 'addCombination' now returns an Observable. The callback will be ignored. Please subscribe to the returned Observable instead.`);
        }

        if (context != null && strict) {
            console.warn(`${Hotkeys.LOG_PREFIX} Shortcut "${id}" has both a context(${context}) and the 'strict' flag. The 'strict' flag will be ignored.`);
        }

        const keyTriggers = Array.isArray(keys) ? keys : [keys];

        if (keyTriggers.length === 0) {
            console.warn(`${Hotkeys.LOG_PREFIX} "keys" array for combination shortcut "${id}" is empty. Shortcut not added.`);
            return EMPTY;
        }

        const observables: Observable<KeyboardEvent>[] = [];
        const logParts: string[] = [];

        for (const keyInput of keyTriggers) {
            const parsedTrigger = this._parseKeyTrigger(keyInput, id);
            if (!parsedTrigger) {
                // Error already logged by _parseKeyTrigger
                return EMPTY;
            }

            const { configuredMainKey, ctrlKeyConfig, altKeyConfig, shiftKeyConfig, metaKeyConfig, logDetails } = parsedTrigger;
            logParts.push(`{ ${logDetails} }`);

            const stream = this.filterByContext(this.keydown$, context, strict).pipe(
                filter(event => {
                    const ctrlMatch = (ctrlKeyConfig === undefined) ? true : (event.ctrlKey === ctrlKeyConfig);
                    const altMatch = (altKeyConfig === undefined) ? true : (event.altKey === altKeyConfig);
                    const shiftMatch = (shiftKeyConfig === undefined) ? true : (event.shiftKey === shiftKeyConfig);
                    const metaMatch = (metaKeyConfig === undefined) ? true : (event.metaKey === metaKeyConfig);
                    return ctrlMatch && altMatch && shiftMatch && metaMatch;
                }),
                filter(event => compareKey(event.key, configuredMainKey)),
                // New filter for priority: Specific context > Global context
                filter(event => {
                    if (context != null || strict) { // This shortcut is NOT global or strict
                        return true;
                    }
                    // This shortcut IS global. Check for specific overrides.
                    const currentSpecificContext = this.activeContext$.getValue();
                    if (currentSpecificContext == null) { // No specific context active
                        return true;
                    }

                    for (const [, otherAS] of this.activeShortcuts) {
                        if (otherAS.config.id !== id &&
                            'keys' in otherAS.config &&
                            otherAS.config.context === currentSpecificContext &&
                            this._shortcutMatchesEvent(otherAS.config, event)) {
                            if (this.debugMode) {
                                console.log(`${Hotkeys.LOG_PREFIX} Global shortcut "${id}" (key: "${event.key}") suppressed by specific context shortcut "${otherAS.config.id}".`);
                            }
                            return false; // Suppress global
                        }
                    }
                    return true; // Global can proceed
                })
            );
            observables.push(stream);
        }

        if (observables.length === 0) {
             // Should be caught by keyTriggers.length === 0, but as a safeguard.
            console.warn(`${Hotkeys.LOG_PREFIX} No valid key triggers for combination shortcut "${id}". Shortcut not added.`);
            return EMPTY;
        }

        const terminator$ = new Subject<void>();
        const finalShortcut$ = merge(...observables);
        const overallLogDetails = Array.isArray(keys) ? `Triggers: [ ${logParts.join(", ")} ]` : logParts[0];

        this._registerShortcut(config, terminator$, ShortcutTypes.Combination, overallLogDetails);

        return finalShortcut$.pipe(
            tap(event => {
                if (this.debugMode) {
                    const preventAction = preventDefault ? ", preventing default" : "";
                    console.log(`${Hotkeys.LOG_PREFIX} Combination "${id}" triggered by key "${event.key}" ${preventAction}.`);
                }
                if (preventDefault) event.preventDefault();
            }),
            catchError(err => {
                console.error(`${Hotkeys.LOG_PREFIX} Error in combination stream for shortcut "${id}":`, err);
                return EMPTY;
            }),
            takeUntil(terminator$)
        );
    }

    /**
     * Registers a key sequence shortcut (e.g., g -> i, or ArrowUp -> ArrowUp -> ArrowDown)
     * and returns an Observable that emits the final `KeyboardEvent` of the sequence when it's completed.
     * An optional timeout can be specified for the time allowed between key presses in the sequence.
     * @param config - Configuration object for the key sequence.
     * See {@link KeySequenceConfig} for details.
     * Each key in the `sequence` array must be a value from the `Keys` object.
     * @returns An `Observable<KeyboardEvent>` that you can subscribe to. The stream will be automatically
     * completed if the shortcut is removed via `remove(id)` or `destroy()`, or if it's overwritten.
     * If the configuration is invalid, an empty Observable is returned and a warning is logged.
     * @example
     * ```typescript
     * import { Keys } from "./keys";
     * const konami$ = keyManager.addSequence({
     * id: "konamiCode",
     * sequence: [Keys.ArrowUp, Keys.ArrowUp, Keys.ArrowDown, Keys.ArrowDown, Keys.A, Keys.B],
     * sequenceTimeoutMs: 2000 // 2 seconds between keys
     * });
     * konami$.subscribe(event => console.log("Konami!", event));
     * ```
     */
    public addSequence(config: KeySequenceConfig): Observable<KeyboardEvent> {
        const { sequence, context, preventDefault = false, id, sequenceTimeoutMs, strict = false } = config;

        if (config.callback) {
            console.warn(`${Hotkeys.LOG_PREFIX} Shortcut "${id}" was provided a callback, but 'addSequence' now returns an Observable. The callback will be ignored. Please subscribe to the returned Observable instead.`);
        }

        if (!Array.isArray(sequence) || sequence.length === 0) {
            console.warn(`${Hotkeys.LOG_PREFIX} Sequence for shortcut "${id}" is empty or invalid. Shortcut not added.`);
            return EMPTY;
        }
        // Corrected validation: Check for actual empty string, not a string that trims to empty.
        if (sequence.some(key => typeof key !== "string" || (key as string) === "")) { // StandardKey type should prevent empty strings.
            console.warn(`${Hotkeys.LOG_PREFIX} Invalid key in sequence for shortcut "${id}". All keys must be non-empty string values from Keys. Shortcut not added.`);
            return EMPTY;
        }
        if (context && strict) {
             console.warn(`${Hotkeys.LOG_PREFIX} Shortcut "${id}" has both a context and the 'strict' flag. The 'strict' flag will be ignored.`);
        }

        const configuredSequence = sequence;
        const sequenceLength = configuredSequence.length;
        let shortcut$: Observable<KeyboardEvent[]>;
        const baseKeydownStream$ = this.filterByContext(this.keydown$, context, strict);

        if (sequenceTimeoutMs && sequenceTimeoutMs > 0) {
            shortcut$ = baseKeydownStream$.pipe(
                scan<KeyboardEvent, SequenceScanState>(
                    (acc, event) => {
                        let { matchedEvents, lastEventTime } = acc;
                        const currentTime = performance.now();

                        if (acc.emitState === EmitStates.Emit) {
                            matchedEvents = [];
                            lastEventTime = 0;
                        }

                        if (matchedEvents.length > 0 && (currentTime - lastEventTime > sequenceTimeoutMs)) {
                            if (this.debugMode) {
                                console.log(`${Hotkeys.LOG_PREFIX} Sequence "${id}" (timeout: ${sequenceTimeoutMs}ms) attempt timed out. Matched: ${matchedEvents.map(e=>e.key).join(",")}. Resetting.`);
                            }
                            matchedEvents = [];
                        }

                        const nextExpectedKeyIndex = matchedEvents.length;

                        if (nextExpectedKeyIndex >= sequenceLength) {
                            // Sequence was already emitted or buffer is too long (should not happen if reset correctly)
                            // Start new sequence if current key matches the first key of the sequence
                            if (sequenceLength > 0 && compareKey(event.key, configuredSequence[0])) {
                                return { matchedEvents: [event], lastEventTime: currentTime, emitState: EmitStates.InProgress };
                            }
                            return { matchedEvents: [], lastEventTime: 0, emitState: EmitStates.Ignore };
                        }

                        if (compareKey(event.key, configuredSequence[nextExpectedKeyIndex])) {
                            const newMatchedEvents = [...matchedEvents, event];
                            if (newMatchedEvents.length === sequenceLength) {
                                if (this.debugMode && acc.emitState !== EmitStates.Emit) console.log(`${Hotkeys.LOG_PREFIX} Sequence "${id}" (timeout: ${sequenceTimeoutMs}ms) matched.`);
                                return { matchedEvents: newMatchedEvents, lastEventTime: currentTime, emitState: EmitStates.Emit };
                            } else {
                                return { matchedEvents: newMatchedEvents, lastEventTime: currentTime, emitState: EmitStates.InProgress };
                            }
                        } else {
                             // If current key breaks sequence, check if it starts a new sequence
                            if (matchedEvents.length > 0 && this.debugMode) {
                                 console.log(`${Hotkeys.LOG_PREFIX} Sequence "${id}" (timeout: ${sequenceTimeoutMs}ms) broken by key "${event.key}". Matched: ${matchedEvents.map(e=>e.key).join(",")}. Resetting.`);
                            }
                            if (sequenceLength > 0 && compareKey(event.key, configuredSequence[0])) {
                                return { matchedEvents: [event], lastEventTime: currentTime, emitState: EmitStates.InProgress };
                            } else {
                                return { matchedEvents: [], lastEventTime: 0, emitState: EmitStates.Ignore };
                            }
                        }
                    },
                    { matchedEvents: [], lastEventTime: 0, emitState: EmitStates.Ignore }
                ),
                filter(state => state.emitState === EmitStates.Emit),
                map(state => state.matchedEvents)
            );
        } else {
            // No timeout logic: simple buffer-based matching
            shortcut$ = baseKeydownStream$.pipe(
                bufferCount(sequenceLength, 1),
                filter((events: KeyboardEvent[]) => {
                    if (events.length < sequenceLength) return false;
                    return events.every((event, index) => compareKey(event.key, configuredSequence[index]));
                })
            );
        }

        const terminator$ = new Subject<void>();
        const finalShortcutWithPriority$ = shortcut$.pipe(
            filter((completedEvents: KeyboardEvent[]) => {
                if (context != null || strict) { // This sequence is NOT global or strict
                    return true;
                }
                // This sequence IS global. Check for specific overrides.
                const currentSpecificContext = this.activeContext$.getValue();
                if (currentSpecificContext == null) { // No specific context active
                    return true;
                }
                for (const [, otherAS] of this.activeShortcuts) {
                    if (otherAS.config.id !== id &&
                        "sequence" in otherAS.config &&
                        otherAS.config.context === currentSpecificContext &&
                        this._areSequencesIdentical(sequence, otherAS.config.sequence)) {
                        if (this.debugMode) {
                            console.log(`${Hotkeys.LOG_PREFIX} Global sequence shortcut "${id}" suppressed by identical specific-context shortcut "${otherAS.config.id}".`);
                        }
                        return false; // Suppress global
                    }
                }
                return true; // Global sequence can proceed
            }),
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

        const logDetails = `Sequence: ${sequence.join(" -> ")}${sequenceTimeoutMs && sequenceTimeoutMs > 0 ? ` (timeout: ${sequenceTimeoutMs}ms)` : ""}`;
        this._registerShortcut(config, terminator$, ShortcutTypes.Sequence, logDetails);

        return finalShortcutWithPriority$.pipe(
            map((events: KeyboardEvent[]) => events[events.length - 1]),
            takeUntil(terminator$)
        );
    }

    /**
     * Removes a registered shortcut by its ID.
     * This will complete the corresponding Observable stream for any subscribers.
     * @param id - The unique ID of the shortcut to remove.
     * @returns True if the shortcut was found and removed, false otherwise.
     * A warning is logged to the console if no shortcut with the given ID is found.
     */
    public remove(id: string): boolean {
        const shortcut = this.activeShortcuts.get(id);
        if (shortcut) {
            shortcut.terminator$.next();
            shortcut.terminator$.complete();
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
     * and `type` (from `ShortcutTypes` enum).
     */
    public getActiveShortcuts(): {id: string; description?: string; context?: string | null; type: ShortcutTypes}[] {
        const shortcuts: Array<{id: string; description?: string; context?: string | null; type: ShortcutTypes}> = [];
        for (const [id, activeShortcut] of this.activeShortcuts.entries()) {
            shortcuts.push({
                id,
                description: activeShortcut.config.description,
                context: activeShortcut.config.context,
                type: ("sequence" in activeShortcut.config) ? ShortcutTypes.Sequence : ShortcutTypes.Combination
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
        if (this.debugMode) console.log(`${Hotkeys.LOG_PREFIX} Destroying library instance and terminating all shortcut streams.`);
        this.activeShortcuts.forEach(shortcut => {
            shortcut.terminator$.next();
            shortcut.terminator$.complete();
        });
        this.activeShortcuts.clear();
        this.activeContext$.complete();
        if (this.debugMode) console.log(`${Hotkeys.LOG_PREFIX} Library destroyed.`);
    }
}
