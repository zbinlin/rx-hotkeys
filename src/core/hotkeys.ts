import {
    fromEvent, BehaviorSubject, EMPTY, Observable,
    filter, map, bufferCount, withLatestFrom, tap, catchError, scan, merge, Subject, takeUntil, share, distinctUntilChanged, combineLatest,
} from "rxjs";
import { type StandardKey, Keys, KeyAliases } from "./keys.js";

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

interface SequenceScanState {
    matchedEvents: KeyboardEvent[];
    lastEventTime: number;
    emitState: EmitStates;
}

interface ShortcutConfigBase {
    id: string;
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
    /**
     * The DOM element to which the event listener for this shortcut will be attached.
     * If not provided, the listener will be attached to the `document`.
     * Useful for creating shortcuts that are only active within a specific component or area.
     * @default document
     */
    target?: HTMLElement;
    /**
     * The type of keyboard event to listen for.
     * Use "keydown" for actions that should happen immediately upon pressing a key.
     * Use "keyup" for actions that should happen upon releasing a key.
     * @default "keydown"
     */
    event?: "keydown" | "keyup";
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
     * Can be a single trigger, an array of triggers, or a string representation.
     *
     * **Object/Array:** Each trigger can be an object specifying the main `key` (from `StandardKey`) and optional
     * modifiers (`ctrlKey`, `altKey`, `shiftKey`, `metaKey`).
     * Example: `{ key: Keys.S, ctrlKey: true }` for Ctrl+S.
     *
     * **Shorthand:** For a simple key press without modifiers, a trigger can be a `StandardKey` directly.
     * Example: `Keys.Escape` for the Escape key.
     *
     * **String:** A human-readable string like `"ctrl+s"` or `"shift+alt+k"`. Modifiers are joined by `+`.
     * Example: `"meta+k"`, `"ctrl+shift+?"`
     *
     * To define multiple triggers for the same action:
     * Example: `keys: [Keys.Enter, { key: Keys.Space, ctrlKey: true }]`
     */
    keys: KeyCombinationTrigger | KeyCombinationTrigger[] | string;
}

export interface KeySequenceConfig extends ShortcutConfigBase {
    /**
     * An array of keys or a string defining the sequence.
     *
     * **Array:** Each key in the sequence MUST be a value from `Keys`.
     * Example: `[Keys.G, Keys.I]`
     *
     * **String:** A string where keys are separated by `->`.
     * Example: `"g -> i"`, `"up -> up -> down -> down"`
     */
    sequence: StandardKey[] | string;
    /**
     * Optional: Timeout in milliseconds between consecutive key presses in the sequence.
     * If the time between two keys in the sequence exceeds this value, the sequence attempt is reset.
     * Set to 0 or undefined to disable inter-key timeout behavior (uses simpler buffer-based matching).
     */
    sequenceTimeoutMs?: number;
}

type ShortcutConfig = KeyCombinationConfig | KeySequenceConfig;

export interface ActiveShortcut {
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

/**
 * Normalizes a string representation of a key into a canonical StandardKey.
 * Handles case-insensitivity, aliases, and special characters.
 * @param key The raw key string to normalize.
 * @returns A StandardKey if valid, otherwise null.
 */
function normalizeKey(key: string): StandardKey | null {
    // 1. Handle spacebar explicitly to avoid trimming
    if (key === Keys.Space) {
        return Keys.Space;
    }

    // 2. Trim and convert to lower case for consistent matching
    const normalizedStr = key.trim().toLowerCase();
    if (normalizedStr === "") {
        return null;
    }

    // 3. Look up in aliases, then in standard key values, then check for single char
    const finalKey = KeyAliases[normalizedStr] ||
                     (Object.values(Keys) as string[]).find(k => k.toLowerCase() === normalizedStr) as StandardKey ||
                     (normalizedStr.length === 1 ? normalizedStr.toUpperCase() as StandardKey : undefined);

    return finalKey || null;
}


// --- Hotkeys Library ---

/**
 * Manages keyboard shortcuts for web applications.
 * Allows registration of single key combinations (e.g., Ctrl+S) and key sequences (e.g., g -> i).
 * Supports contexts to enable/disable shortcuts based on application state.
 */
export class Hotkeys {
    private static readonly KEYDOWN_EVENT = "keydown";
    private static readonly KEYUP_EVENT = "keyup";
    private static readonly LOG_PREFIX = "Hotkeys:";

    // --- Sentinel value for no override ---
    private static readonly NO_OVERRIDE = Symbol("No Hotkey Override");

    private keydownStreams: WeakMap<EventTarget, Observable<KeyboardEvent>>;
    private keyupStreams: WeakMap<EventTarget, Observable<KeyboardEvent>>;
    private activeShortcuts: Map<string, ActiveShortcut>;
    private debugMode: boolean;

    // --- Separate states for stack and override ---
    private contextStack$: BehaviorSubject<Array<string | null>>;
    private overrideContext$: BehaviorSubject<string | null | typeof Hotkeys.NO_OVERRIDE>;

    /**
     * An Observable that emits the new active context name (or null) whenever it changes.
     * The active context is the override context if one is set, otherwise it's the context
     * from the top of the stack.
     */
    private readonly activeContext$: Observable<string | null>;

    /**
     * Creates an instance of Hotkeys.
     * @param initialContext - Optional initial context name. This forms the base of the context stack.
     * @param debugMode - Optional. If true, debug messages will be logged to the console. Defaults to false.
     * @throws Error if not in a browser environment (i.e., `document` or `performance` is undefined).
     */
    constructor(initialContext: string | null = null, debugMode: boolean = false) {
        this.debugMode = debugMode;

        if (typeof document === "undefined" || typeof performance === "undefined") {
            throw new Error(`${Hotkeys.LOG_PREFIX} Hotkeys can only be used in a browser environment.`);
        }
        this.keydownStreams = new WeakMap();
        this.keyupStreams = new WeakMap();
        this.activeShortcuts = new Map();

        // The context stack is the source of truth for the active context.
        this.contextStack$ = new BehaviorSubject<Array<string | null>>([initialContext]);
        this.overrideContext$ = new BehaviorSubject<string | null | typeof Hotkeys.NO_OVERRIDE>(Hotkeys.NO_OVERRIDE);

        // The public activeContext$ now correctly handles the sentinel value.
        this.activeContext$ = combineLatest([
            this.overrideContext$,
            this.contextStack$.pipe(map(stack => stack.length > 0 ? stack[stack.length - 1] : null))
        ]).pipe(
            map(([overrideCtx, stackCtx]) => this._resolveActiveContext(overrideCtx, stackCtx)),
            distinctUntilChanged(),
        );

        if (this.debugMode) {
            console.log(`${Hotkeys.LOG_PREFIX} Library initialized. Initial context: "${initialContext}". Debug mode: ${debugMode}.`);
            // Optional: Log context changes for debugging
            this.activeContext$.subscribe(newContext => {
                 console.log(`${Hotkeys.LOG_PREFIX} Active context changed to: ${newContext}`);
            });
        }
    }

    /**
     * Helper method to determine the active context based on override and stack.
     */
    private _resolveActiveContext(overrideCtx: string | null | typeof Hotkeys.NO_OVERRIDE, stackCtx: string | null): string | null {
        return overrideCtx !== Hotkeys.NO_OVERRIDE ? overrideCtx : stackCtx;
    }

    /**
     * Gets or creates a shared event stream for a given event type and target.
     * @param eventType The type of event ("keydown" or "keyup").
     * @param target The DOM element to attach the listener to.
     * @returns A shared Observable for the specified event.
     */
    private _getEventStream(eventType: "keydown" | "keyup", target: EventTarget): Observable<KeyboardEvent> {
        const streamCache = eventType === "keydown" ? this.keydownStreams : this.keyupStreams;
        if (!streamCache.has(target)) {
            const newStream = fromEvent<KeyboardEvent>(target, eventType).pipe(share());
            streamCache.set(target, newStream);
            if (this.debugMode) {
                const targetName = target === document ? "document" : `element "${(target as HTMLElement).id || (target as HTMLElement).tagName}"`;
                console.log(`${Hotkeys.LOG_PREFIX} Created new shared listener for "${eventType}" on ${targetName}.`);
            }
        }
        return streamCache.get(target)!;
    }

    /**
     * Sets a temporary, high-priority override context that takes precedence over the context stack.
     * @param contextName The override context to activate (can be a string or `null`).
     * @returns A `restore` function that, when called, clears the override context, reverting to the stack.
     */
    public setContext(contextName: string | null): () => void {
        if (this.debugMode) {
            console.log(`${Hotkeys.LOG_PREFIX} Setting override context to: "${contextName}".`);
        }
        this.overrideContext$.next(contextName);

        const restore = () => {
            // Only clear the override if it's still the one we set.
            if (this.overrideContext$.getValue() === contextName) {
                if (this.debugMode) {
                    console.log(`${Hotkeys.LOG_PREFIX} Restoring/clearing override context from: "${contextName}".`);
                }
                // Restore now sets the special "NO_OVERRIDE" value.
                this.overrideContext$.next(Hotkeys.NO_OVERRIDE);
            }
        };
        return restore;
    }

    /**
     * @deprecated Rename to `getActiveContext`
     * Gets the current active context, considering any override.
     * @returns The current context name as a string, or `null` if no context is set.
     */
    public getContext(): string | null {
        console.warn(`${Hotkeys.LOG_PREFIX} "getContext" is deprecated. Use "getActiveContext()" or subscribe to "onContextChange$" instead.`);
        return this.getActiveContext();
    }

    /**
     * Gets the current active context, considering any override.
     * @returns The current context name as a string, or `null` if no context is set.
     */
    public getActiveContext(): string | null {
        const overrideCtx = this.overrideContext$.getValue();
        const stack = this.contextStack$.getValue();
        const stackCtx = stack.length > 0 ? stack[stack.length - 1] : null;
        // Also uses the abstracted helper method.
        return this._resolveActiveContext(overrideCtx, stackCtx);
    }

    /**
     * Pushes a new context onto the context stack. It will become active if no override context is set.
     * @param contextName The name of the context to enter (e.g., "modal", "editor").
     */
    public enterContext(contextName: string | null): void {
        const currentStack = this.contextStack$.getValue();
        const newStack = [...currentStack, contextName];
        if (this.debugMode) {
            console.log(`${Hotkeys.LOG_PREFIX} Entering context: "${contextName}". New stack: [${newStack.join(", ")}]`);
        }
        this.contextStack$.next(newStack);
    }

    /**
     * Pops the current context from the stack.
     * @returns The context that was just left from the stack, or `undefined` if at the base.
     */
    public leaveContext(): string | null | undefined {
        const currentStack = this.contextStack$.getValue();
        if (currentStack.length <= 1) {
            if (this.debugMode) {
                console.log(`${Hotkeys.LOG_PREFIX} Attempted to leave the base stack context. No change made.`);
            }
            return undefined; // Nothing was left
        }

        const leavingContext = currentStack[currentStack.length - 1];
        const newStack = currentStack.slice(0, -1);

        if (this.debugMode) {
            console.log(`${Hotkeys.LOG_PREFIX} Leaving context: "${leavingContext}". New stack: [${newStack.join(", ")}]`);
        }

        this.contextStack$.next(newStack);
        return leavingContext;
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
        return this.activeContext$;
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
        // Use the same robust heuristic here for consistency ---
        let keyTriggers: KeyCombinationTrigger[];
        const configKeys = shortcutConfig.keys;
        if (typeof configKeys === "string" && configKeys.length > 1 && configKeys.includes("+")) {
            keyTriggers = this._parseCombinationString(configKeys);
        } else {
            keyTriggers = Array.isArray(configKeys) ? configKeys : [configKeys as KeyCombinationTrigger];
        }

        for (const keyInput of keyTriggers) {
            let configuredMainKey: StandardKey;
            let ctrlKeyConfig: boolean | undefined;
            let altKeyConfig: boolean | undefined;
            let shiftKeyConfig: boolean | undefined;
            let metaKeyConfig: boolean | undefined;

            // This logic is now simplified because _parseKeyTrigger handles normalization
            const parsed = this._parseKeyTrigger(keyInput, shortcutConfig.id);
            if (!parsed) continue;

            configuredMainKey = parsed.configuredMainKey;
            ctrlKeyConfig = parsed.ctrlKeyConfig;
            altKeyConfig = parsed.altKeyConfig;
            shiftKeyConfig = parsed.shiftKeyConfig;
            metaKeyConfig = parsed.metaKeyConfig;

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
            const finalKey = normalizeKey(keyInput);
            if (!finalKey) {
                console.warn(`${Hotkeys.LOG_PREFIX} Could not parse key: "${keyInput}" in shortcut "${shortcutId}".`);
                return null;
            }
            return {
                configuredMainKey: finalKey,
                ctrlKeyConfig: false,
                altKeyConfig: false,
                shiftKeyConfig: false,
                metaKeyConfig: false,
                logDetails: `key: "${finalKey}" (no mods)`,
            };
        } else {
            if (!keyInput.key || typeof keyInput.key !== "string" || (keyInput.key as string) === "") {
                console.warn(`${Hotkeys.LOG_PREFIX} Invalid "key" property in shortcut "${shortcutId}". Key must be a non-empty string value from Keys.`);
                return null;
            }

            const hasModifiers = keyInput.ctrlKey || keyInput.altKey || keyInput.shiftKey || keyInput.metaKey;

            if (!hasModifiers) {
                 return {
                    configuredMainKey: keyInput.key,
                    ctrlKeyConfig: false,
                    altKeyConfig: false,
                    shiftKeyConfig: false,
                    metaKeyConfig: false,
                    logDetails: `key: "${keyInput.key}" (no mods)`,
                };
            }

            const logDetails = `key: "${keyInput.key}"` +
                (keyInput.ctrlKey ? `, ctrl: true` : "") +
                (keyInput.altKey ? `, alt: true` : "") +
                (keyInput.shiftKey ? `, shift: true` : "") +
                (keyInput.metaKey ? `, meta: true` : "");
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

    private _parseCombinationString(shortcut: string): KeyCombinationTrigger[] {
        const parts = shortcut.toLowerCase().split("+").map(p => p.trim());
        const mainKeyStr = parts.pop();

        if (!mainKeyStr) {
            console.warn(`${Hotkeys.LOG_PREFIX} Invalid shortcut string: "${shortcut}". No main key found.`);
            return [];
        }

        const trigger: { key: StandardKey, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean } = {
            key: "" as StandardKey,
            ctrlKey: false, altKey: false, shiftKey: false, metaKey: false
        };

        const finalKey = normalizeKey(mainKeyStr);
        if (!finalKey) {
             console.warn(`${Hotkeys.LOG_PREFIX} Could not parse key: "${mainKeyStr}" in shortcut string "${shortcut}".`);
            return [];
        }
        trigger.key = finalKey;

        for (const part of parts) {
            if (part === "ctrl" || part === "control") trigger.ctrlKey = true;
            else if (part === "alt" || part === "option") trigger.altKey = true;
            else if (part === "shift") trigger.shiftKey = true;
            else if (part === "meta" || part === "cmd" || part === "command" || part === "win") trigger.metaKey = true;
            else console.warn(`${Hotkeys.LOG_PREFIX} Unknown modifier: "${part}" in shortcut string "${shortcut}".`);
        }
        return [trigger];
    }

    private _parseSequenceString(sequence: string): StandardKey[] {
        const keyStrings = sequence.split("->").map(k => k.trim());
        const results: StandardKey[] = [];
        for (const keyStr of keyStrings) {
            const finalKey = normalizeKey(keyStr);
            if (finalKey) {
                results.push(finalKey);
            } else {
                console.warn(`${Hotkeys.LOG_PREFIX} Could not parse key: "${keyStr}" in sequence string "${sequence}".`);
                return []; // Fail fast
            }
        }
        return results;
    }

    /**
     * Registers a key combination shortcut (e.g., Ctrl+S, Shift+Enter, or a single key like Escape)
     * and returns an Observable that emits the `KeyboardEvent` when the combination is triggered.
     * @param config - Configuration object for the key combination.
     * See {@link KeyCombinationConfig} for details.
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
     * // For Ctrl+S using a string
     * const save$ = keyManager.addCombination({ id: "saveFile", keys: "ctrl+s" });
     * save$.subscribe(event => console.log("File saved!", event));
     *
     * // For just the Escape key, or Ctrl+Space
     * const close$ = keyManager.addCombination({
     * id: "closeModal",
     * keys: [Keys.Escape, {key: Keys.Space, ctrlKey: true}],
     * });
     * close$.subscribe(() => console.log("Modal closed!"));
     *
     * // For the Escape key on a specific element
     * const myModal = document.getElementById("my-modal");
     * const close$ = keyManager.addCombination({ id: "closeModal", keys: Keys.Escape, target: myModal });
     * close$.subscribe(() => console.log("Modal closed!"));
     * ```
     */
    public addCombination(config: KeyCombinationConfig): Observable<KeyboardEvent> {
        const { keys, context, preventDefault = false, id, strict = false, target = document, event: eventType = "keydown" } = config;

        if (context != null && strict) {
            console.warn(`${Hotkeys.LOG_PREFIX} Shortcut "${id}" has both a context(${context}) and the "strict" flag. The "strict" flag will be ignored.`);
        }

        let keyTriggers: KeyCombinationTrigger[];
        if (typeof keys === "string" && keys.length > 1 && keys.includes("+")) {
            keyTriggers = this._parseCombinationString(keys);
        } else {
            keyTriggers = Array.isArray(keys) ? keys : [keys as KeyCombinationTrigger];
        }

        if (keyTriggers.length === 0) {
            console.warn(`${Hotkeys.LOG_PREFIX} "keys" definition for combination shortcut "${id}" is empty or invalid. Shortcut not added.`);
            return EMPTY;
        }

        const sourceStream$ = this._getEventStream(eventType, target);
        const observables: Observable<KeyboardEvent>[] = [];
        const logParts: string[] = [];

        for (const keyInput of keyTriggers) {
            const parsedTrigger = this._parseKeyTrigger(keyInput, id);
            if (!parsedTrigger) {
                return EMPTY;
            }

            const { configuredMainKey, ctrlKeyConfig, altKeyConfig, shiftKeyConfig, metaKeyConfig, logDetails } = parsedTrigger;
            logParts.push(`{ ${logDetails} }`);

            const stream = this.filterByContext(sourceStream$, context, strict).pipe(
                filter(event => {
                    const ctrlMatch = (ctrlKeyConfig === undefined) ? true : (event.ctrlKey === ctrlKeyConfig);
                    const altMatch = (altKeyConfig === undefined) ? true : (event.altKey === altKeyConfig);
                    const shiftMatch = (shiftKeyConfig === undefined) ? true : (event.shiftKey === shiftKeyConfig);
                    const metaMatch = (metaKeyConfig === undefined) ? true : (event.metaKey === metaKeyConfig);
                    return ctrlMatch && altMatch && shiftMatch && metaMatch;
                }),
                filter(event => compareKey(event.key, configuredMainKey)),
                // New filter for priority: Specific context > Global context
                withLatestFrom(this.activeContext$),
                filter(([event, activeCtx]) => {
                    if (context != null || strict) { // This shortcut is NOT global or strict
                        return true;
                    }
                    // This shortcut IS global. Check for specific overrides.
                    if (activeCtx == null) { // No specific context active
                        return true;
                    }

                    for (const [, otherAS] of this.activeShortcuts) {
                        if (otherAS.config.id !== id &&
                            "keys" in otherAS.config &&
                            otherAS.config.context === activeCtx &&
                            this._shortcutMatchesEvent(otherAS.config, event)) {
                            if (this.debugMode) {
                                console.log(`${Hotkeys.LOG_PREFIX} Global shortcut "${id}" (key: "${event.key}") suppressed by specific context shortcut "${otherAS.config.id}".`);
                            }
                            return false; // Suppress global
                        }
                    }
                    return true; // Global can proceed
                }),
                map(([event]) => event)
            );
            observables.push(stream);
        }

        if (observables.length === 0) {
            // This path should now be much harder to hit, but remains a safeguard.
            console.warn(`${Hotkeys.LOG_PREFIX} No valid key triggers for combination shortcut "${id}". Shortcut not added.`);
            return EMPTY;
        }

        const terminator$ = new Subject<void>();
        const finalShortcut$ = merge(...observables);
        const overallLogDetails = `Triggers: [ ${logParts.join(", ")} ]`;

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
     * Or using string for `sequence`.
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
     * ```typescript
     * // Using a string for the sequence
     * const konami$ = keyManager.addSequence({
     * id: "konamiCode",
     * sequence: "up -> up -> down -> down -> a -> b",
     * sequenceTimeoutMs: 2000
     * });
     * konami$.subscribe(event => console.log("Konami!", event));
     * ```
     */
    public addSequence(config: KeySequenceConfig): Observable<KeyboardEvent> {
        const { sequence, context, preventDefault = false, id, sequenceTimeoutMs, strict = false, target = document, event: eventType = "keydown" } = config;

        let configuredSequence: StandardKey[];
        if (typeof sequence === "string") {
            configuredSequence = this._parseSequenceString(sequence);
        } else {
            configuredSequence = sequence;
        }

        if (!Array.isArray(configuredSequence) || configuredSequence.length === 0) {
            console.warn(`${Hotkeys.LOG_PREFIX} Sequence for shortcut "${id}" is empty or invalid. Shortcut not added.`);
            return EMPTY;
        }
        // Corrected validation: Check for actual empty string, not a string that trims to empty.
        if (configuredSequence.some(key => typeof key !== "string" || (key as string) === "")) { // StandardKey type should prevent empty strings.
            console.warn(`${Hotkeys.LOG_PREFIX} Invalid key in sequence for shortcut "${id}". All keys must be non-empty string values from Keys. Shortcut not added.`);
            return EMPTY;
        }
        if (context && strict) {
             console.warn(`${Hotkeys.LOG_PREFIX} Shortcut "${id}" has both a context and the "strict" flag. The "strict" flag will be ignored.`);
        }

        const sequenceLength = configuredSequence.length;
        let shortcut$: Observable<KeyboardEvent[]>;
        const sourceStream$ = this._getEventStream(eventType, target);
        const baseKeydownStream$ = this.filterByContext(sourceStream$, context, strict);

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
            withLatestFrom(this.activeContext$),
            filter(([_completedEvents, activeCtx]) => {
                if (context != null || strict) { // This sequence is NOT global or strict
                    return true;
                }
                // This sequence IS global. Check for specific overrides.
                if (activeCtx == null) { // No specific context active
                    return true;
                }
                for (const [, otherAS] of this.activeShortcuts) {
                    if (otherAS.config.id !== id &&
                        "sequence" in otherAS.config &&
                        otherAS.config.context === activeCtx &&
                        this._areSequencesIdentical(configuredSequence, typeof otherAS.config.sequence === "string" ? this._parseSequenceString(otherAS.config.sequence) : otherAS.config.sequence)) {
                        if (this.debugMode) {
                            console.log(`${Hotkeys.LOG_PREFIX} Global sequence shortcut "${id}" suppressed by identical specific-context shortcut "${otherAS.config.id}".`);
                        }
                        return false; // Suppress global
                    }
                }
                return true; // Global sequence can proceed
            }),
            map(([events]) => events),
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

        const logDetails = `Sequence: ${configuredSequence.join(" -> ")}${sequenceTimeoutMs && sequenceTimeoutMs > 0 ? ` (timeout: ${sequenceTimeoutMs}ms)` : ""}`;
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
        this.contextStack$.complete();
        if (this.debugMode) console.log(`${Hotkeys.LOG_PREFIX} Library destroyed.`);
    }
}
