import { describe, it, before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { Hotkeys, type KeyCombinationConfig, type KeySequenceConfig, ShortcutTypes } from "./hotkeys.js";
import { Keys, type StandardKey } from "./keys.js";
import { fromEvent, BehaviorSubject } from "rxjs";
import { createMockFn, dispatchKeyEvent } from "./testutils.js";
import { JSDOM } from "jsdom";

// --- JSDOM and RxJS setup for Node.js tests ---
let dom: any;
let window: any;
let document: any;
let originalPerformanceNow: any;

before(() => {
    dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
        url: "http://localhost",
    });
    window = dom.window;
    document = window.document;
    // @ts-ignore
    global.document = document;
    // @ts-ignore
    global.KeyboardEvent = window.KeyboardEvent;
    // @ts-ignore
    global.BehaviorSubject = BehaviorSubject;
    // @ts-ignore
    global.fromEvent = fromEvent;

    // @ts-ignore
    if (typeof global.performance === "undefined") {
        // @ts-ignore
        global.performance = {};
    }
    // @ts-ignore
    originalPerformanceNow = global.performance.now;
    // @ts-ignore
    if (typeof global.performance.now !== "function") {
        // @ts-ignore
        global.performance.now = (() => {
            const start = Date.now();
            return () => Date.now() - start;
        })();
    }
});

describe("Hotkeys Library (Node.js Test Runner)", () => {
    let keyManager: Hotkeys;
    let mockCallback: ReturnType<typeof createMockFn>;
    let consoleWarnMock: any;
    let consoleErrorMock: any;
    let performanceNowMock: any; // To mock global.performance.now specifically for sequence tests

    beforeEach(() => {
        keyManager = new Hotkeys(null, false);
        mockCallback = createMockFn();
        consoleWarnMock = mock.method(console, "warn");
        consoleErrorMock = mock.method(console, "error");
    });

    afterEach(() => {
        if (keyManager) {
            keyManager.destroy();
        }
        mockCallback.mockClear();

        mock.reset();

        if (consoleWarnMock && consoleWarnMock.mock) consoleWarnMock.mock.restore();
        if (consoleErrorMock && consoleErrorMock.mock) consoleErrorMock.mock.restore();

        // @ts-ignore
        if (global.performance && global.performance.now !== originalPerformanceNow) {
             // @ts-ignore
            global.performance.now = originalPerformanceNow;
        }
    });

    // ... (Initialization and Basic Context tests remain the same) ...
    describe("Initialization and Context Management", () => {
        it("should initialize without errors", () => {
            assert(keyManager instanceof Hotkeys);
            assert.strictEqual(keyManager.getContext(), null); // Default initial context
        });

        it("should initialize with a null context by default", () => {
            assert.strictEqual(keyManager.getContext(), null);
        });

        it("should initialize with a given initial context (debug off)", () => {
            const manager = new Hotkeys("editor", false);
            assert.strictEqual(manager.getContext(), "editor");
            manager.destroy();
        });

        it("should log library initialization with context in debug mode", () => {
            const consoleLogMock = mock.method(console, "log");
            const manager = new Hotkeys("debugInitCtx", true);
            const initLog = consoleLogMock.mock.calls.find(call => call.arguments[0].includes(`Library initialized. Initial context: "debugInitCtx"`));
            assert.ok(initLog, "Library initialization log not found or incorrect.");
            manager.destroy();
            consoleLogMock.mock.restore();
        });

        it("should set and get context correctly", () => {
            keyManager.setContext("modal");
            assert.strictEqual(keyManager.getContext(), "modal");
            keyManager.setContext(null);
            assert.strictEqual(keyManager.getContext(), null);
        });

        it("should log context change correctly when context is different (debug mode on)", () => {
            const consoleLogMock = mock.method(console, "log");
            keyManager.setDebugMode(true);
            // Initial context is null for keyManager
            consoleLogMock.mock.resetCalls(); // Clear "Debug mode enabled" log

            keyManager.setContext("debug_test");
            assert.ok(consoleLogMock.mock.calls.some(call => call.arguments[0].includes(`Context changed from "null" to "debug_test"`)), "Log for context change from null incorrect.");
            assert.strictEqual(keyManager.getContext(), "debug_test");
            consoleLogMock.mock.resetCalls();

            keyManager.setContext("another_test");
            assert.ok(consoleLogMock.mock.calls.some(call => call.arguments[0].includes(`Context changed from "debug_test" to "another_test"`)), "Log for context change between non-null incorrect.");
            assert.strictEqual(keyManager.getContext(), "another_test");

            consoleLogMock.mock.restore();
        });

        it("should log context change from non-null to null (debug mode on)", () => {
            const consoleLogMock = mock.method(console, "log");
            keyManager.setContext("fromCtx"); // Initial context
            keyManager.setDebugMode(true);
            consoleLogMock.mock.resetCalls();

            keyManager.setContext(null);
            const logCall = consoleLogMock.mock.calls.find(call => call.arguments[0].includes(`Context changed from "fromCtx" to "null"`));
            assert.ok(logCall, "Context change to null log not found or incorrect.");
            assert.strictEqual(keyManager.getContext(), null);
            consoleLogMock.mock.restore();
        });

        it(`should not call activeContext$.next and log "no change" if context is set to the same value (debug mode on)`, () => {
            keyManager.setContext("sameCtx"); // Set initial context

            const consoleLogMock = mock.method(console, "log");
            keyManager.setDebugMode(true); // Enable debug for this test
            consoleLogMock.mock.resetCalls(); // Clear "Debug mode enabled" log

            // @ts-ignore: Accessing private member for test
            const activeContextNextSpy = mock.method(keyManager["activeContext$"], "next");

            keyManager.setContext("sameCtx"); // Attempt to set the same context

            const noChangeLogCall = consoleLogMock.mock.calls.find(call => call.arguments[0].includes(`setContext called with the same context "sameCtx". No change made.`));
            assert.ok(noChangeLogCall, "No-change log not found or incorrect for same context.");

            const changedLogCall = consoleLogMock.mock.calls.find(call => call.arguments[0].includes(`Context changed from`));
            assert.strictEqual(changedLogCall, undefined, "Context changed log should not appear for same context.");

            assert.strictEqual(keyManager.getContext(), "sameCtx");
            assert.strictEqual(activeContextNextSpy.mock.callCount(), 0, "activeContext$.next should not have been called.");

            activeContextNextSpy.mock.restore();
            consoleLogMock.mock.restore();
        });

        it("should not log or call next if context is set to the same value (debug mode off)", () => {
            keyManager.setContext("sameCtxNoDebug"); // Set initial context
            keyManager.setDebugMode(false);
            // Ensure debug is off

            const consoleLogMock = mock.method(console, "log");
            // @ts-ignore: Accessing private member for test
            const activeContextNextSpy = mock.method(keyManager["activeContext$"], "next");

            keyManager.setContext("sameCtxNoDebug"); // Attempt to set the same context

            assert.strictEqual(consoleLogMock.mock.callCount(), 0, "Console.log should not have been called with debug mode off.");
            assert.strictEqual(activeContextNextSpy.mock.callCount(), 0, "activeContext$.next should not have been called.");
            assert.strictEqual(keyManager.getContext(), "sameCtxNoDebug");

            activeContextNextSpy.mock.restore();
            consoleLogMock.mock.restore();
        });

        it(`should log "no change" if context is set to the same value (debug mode on)`, () => {
            keyManager.setContext("sameCtx"); // Set initial context
            const consoleLogMock = mock.method(console, "log");
            keyManager.setDebugMode(true);
            consoleLogMock.mock.resetCalls(); // Clear previous logs

            keyManager.setContext("sameCtx"); // Attempt to set the same context

            const noChangeLogCall = consoleLogMock.mock.calls.find(call => call.arguments[0].includes(`setContext called with the same context "sameCtx". No change made.`));
            assert.ok(noChangeLogCall, "No-change log not found or incorrect for same context.");
            const changedLogCall = consoleLogMock.mock.calls.find(call => call.arguments[0].includes("Context changed from"));
            assert.strictEqual(changedLogCall, undefined, "Context changed log should not appear for same context.");
            consoleLogMock.mock.restore();
        });

        it("should toggle debug mode and log its state", () => {
            const consoleLogMock = mock.method(console, "log");
            keyManager.setDebugMode(true);
            assert.ok(consoleLogMock.mock.calls.some(call => call.arguments[0].includes("Debug mode enabled")));
            consoleLogMock.mock.resetCalls();

            keyManager.setDebugMode(false);
            assert.ok(consoleLogMock.mock.calls.some(call => call.arguments[0].includes("Debug mode disabled")));

            consoleLogMock.mock.restore();
        });

        describe("setContext return value", () => {
            it("should return true when context is changed from null to a new value", () => {
                assert.strictEqual(keyManager.getContext(), null, "Initial context should be null");
                const result = keyManager.setContext("newContext");
                assert.strictEqual(result, true, "setContext should return true for a change from null");
                assert.strictEqual(keyManager.getContext(), "newContext");
            });

            it("should return true when context is changed from one value to another", () => {
                keyManager.setContext("initialContext"); // Set a non-null initial context
                const result = keyManager.setContext("changedContext");
                assert.strictEqual(result, true, "setContext should return true for a value-to-value change");
                assert.strictEqual(keyManager.getContext(), "changedContext");
            });

            it("should return false when context is set to the same value (non-null)", () => {
                keyManager.setContext("sameContext");
                const result = keyManager.setContext("sameContext");
                assert.strictEqual(result, false, "setContext should return false for no change (non-null)");
                assert.strictEqual(keyManager.getContext(), "sameContext");
            });

            it("should return true when context is changed from a value to null", () => {
                keyManager.setContext("initialContext");
                const result = keyManager.setContext(null);
                assert.strictEqual(result, true, "setContext should return true for a change to null");
                assert.strictEqual(keyManager.getContext(), null);
            });

            it("should return false when context is set to null and already null", () => {
                keyManager.setContext(null); // Ensure context is null
                const result = keyManager.setContext(null);
                assert.strictEqual(result, false, "setContext should return false for no change (already null)");
                assert.strictEqual(keyManager.getContext(), null);
            });
        });

        describe("onContextChange$ observable", () => {
            it("should emit initial context to new subscriber", () => {
                const manager = new Hotkeys("initial", false);
                const spy = createMockFn();
                const sub = manager.onContextChange$.subscribe(spy);
                assert.strictEqual(spy.calledCount, 1);
                assert.strictEqual(spy.lastArgs[0], "initial");
                sub.unsubscribe();
                manager.destroy();
            });

            it("should emit when context changes", () => {
                const spy = createMockFn();
                const sub = keyManager.onContextChange$.subscribe(spy); // Subscribes, gets initial null
                spy.mockClear(); // Clear initial emission

                assert.ok(keyManager.setContext("newContext"), "setContext should have returned true for change");
                assert.strictEqual(spy.calledCount, 1, "onContextChange$ did not emit on first change");
                assert.strictEqual(spy.lastArgs[0], "newContext");

                assert.ok(keyManager.setContext("anotherContext"), "setContext should have returned true for second change");
                assert.strictEqual(spy.calledCount, 2, "onContextChange$ did not emit on second change");
                assert.strictEqual(spy.lastArgs[0], "anotherContext");

                assert.ok(keyManager.setContext(null), "setContext should have returned true for change to null");
                assert.strictEqual(spy.calledCount, 3, "onContextChange$ did not emit on change to null");
                assert.strictEqual(spy.lastArgs[0], null);
                sub.unsubscribe();
            });

            it("should not emit if context is set to the same value", () => {
                keyManager.setContext("testContext");
                const spy = createMockFn();
                const sub = keyManager.onContextChange$.subscribe(spy); // Subscribes, gets "testContext"
                spy.mockClear(); // Clear initial emission

                assert.strictEqual(keyManager.setContext("testContext"), false, "setContext should have returned false for no change"); // Set same context
                assert.strictEqual(spy.calledCount, 0, "Observable should not emit if context value is the same.");
                sub.unsubscribe();
            });
        });
    });

    describe("addCombination", () => {
        it("should trigger callback for a simple key combination (e.g., 'A')", () => {
            const config: KeyCombinationConfig = { id: "simpleA", keys: { key: Keys.A }, callback: mockCallback };
            const result = keyManager.addCombination(config);
            assert.strictEqual(result, "simpleA");
            dispatchKeyEvent("a");
            assert.strictEqual(mockCallback.calledCount, 1, "Callback for 'a' not called");
            mockCallback.mockClear();
            dispatchKeyEvent("A");
            assert.strictEqual(mockCallback.calledCount, 1, "Callback for 'A' not called");
        });

        it("should return undefined and warn if keys.key is null or undefined (runtime check in object form)", () => {
            const config: KeyCombinationConfig = { id: "nullKey", keys: { key: null as any }, callback: mockCallback };
            const result = keyManager.addCombination(config);
            assert.strictEqual(result, undefined, "Should return undefined for null key");
            assert.strictEqual(consoleWarnMock.mock.calls.length, 1);
            assert.ok(consoleWarnMock.mock.calls[0].arguments[0].includes(`Invalid "keys.key" for combination shortcut "nullKey"`));
        });


        it("should pass the KeyboardEvent to the callback", () => {
            const config: KeyCombinationConfig = { id: "eventPass", keys: { key: Keys.E }, callback: mockCallback };
            keyManager.addCombination(config);
            const event = dispatchKeyEvent("e");
            assert.strictEqual(mockCallback.calledCount, 1);
            assert.deepStrictEqual(mockCallback.lastArgs, [event]);
        });

        it("should trigger callback for a combination with Ctrl key", () => {
            const config: KeyCombinationConfig = { id: "ctrlS", keys: { key: Keys.S, ctrlKey: true }, callback: mockCallback };
            keyManager.addCombination(config);
            dispatchKeyEvent("s", { ctrlKey: true });
            assert.strictEqual(mockCallback.calledCount, 1);
        });

        it("should NOT trigger callback if specified modifier key (ctrlKey: false) is false and event has it true", () => {
            const config: KeyCombinationConfig = { id: "noCtrlA", keys: { key: Keys.A, ctrlKey: false }, callback: mockCallback };
            keyManager.addCombination(config);
            dispatchKeyEvent("a", { ctrlKey: true });
            assert.strictEqual(mockCallback.calledCount, 0);
            dispatchKeyEvent("a", { ctrlKey: false });
            assert.strictEqual(mockCallback.calledCount, 1);
        });

        it("should trigger for special keys like Escape (object form)", () => {
            const config: KeyCombinationConfig = { id: "escapeKeyObj", keys: { key: Keys.Escape }, callback: mockCallback };
            keyManager.addCombination(config);
            dispatchKeyEvent("Escape"); // Event key matches Keys.Escape
            assert.strictEqual(mockCallback.calledCount, 1);
        });


        it("should handle preventDefault correctly (object form)", () => {
            const config: KeyCombinationConfig = { id: "preventAObj", keys: { key: Keys.A }, callback: mockCallback, preventDefault: true };
            keyManager.addCombination(config);
            const event = dispatchKeyEvent("a");
            assert.strictEqual(mockCallback.calledCount, 1);
            assert.strictEqual(event.defaultPrevented, true);
        });

        it("should overwrite an existing combination with the same ID and warn", () => {
            const firstCallback = createMockFn();
            const secondCallback = createMockFn();
            keyManager.addCombination({ id: "combo1", keys: { key: Keys.K }, callback: firstCallback });
            consoleWarnMock.mock.resetCalls();
            keyManager.addCombination({ id: "combo1", keys: { key: Keys.K, ctrlKey: true }, callback: secondCallback });

            assert.strictEqual(consoleWarnMock.mock.calls.length, 1);
            assert.ok(consoleWarnMock.mock.calls[0].arguments[0].includes(`Shortcut with ID "combo1" already exists`));

            dispatchKeyEvent("k");
            assert.strictEqual(firstCallback.calledCount, 0);
            dispatchKeyEvent("k", { ctrlKey: true });
            assert.strictEqual(secondCallback.calledCount, 1);
        });

        it("should log an error via console.error if callback throws, and not affect other shortcuts", () => {
            const errorCallback = () => { throw new Error("Test callback error"); };
            const workingCallback = createMockFn();

            keyManager.addCombination({ id: "errorCombo", keys: { key: Keys.E }, callback: errorCallback });
            keyManager.addCombination({ id: "workingCombo", keys: { key: Keys.W }, callback: workingCallback });

            dispatchKeyEvent("e");
            assert.strictEqual(consoleErrorMock.mock.calls.length, 1);
            assert.ok(consoleErrorMock.mock.calls[0].arguments[0].includes(`Error in user callback for combination shortcut "errorCombo"`));

            dispatchKeyEvent("w");
            assert.strictEqual(workingCallback.calledCount, 1);
        });

        describe("addCombination - Shorthand Syntax", () => {
            it("should trigger callback for a simple key using shorthand (e.g., Keys.X)", () => {
                const config: KeyCombinationConfig = { id: "shorthandX", keys: Keys.X, callback: mockCallback };
                keyManager.addCombination(config);
                dispatchKeyEvent(Keys.X.toLowerCase());
                assert.strictEqual(mockCallback.calledCount, 1, "Callback for 'x' (shorthand) not called");
                mockCallback.mockClear();
                dispatchKeyEvent(Keys.X);
                assert.strictEqual(mockCallback.calledCount, 1, "Callback for 'X' (shorthand) not called");
            });

            it("should NOT trigger callback for shorthand if modifier is pressed", () => {
                const config: KeyCombinationConfig = { id: "shorthandY", keys: Keys.Y, callback: mockCallback };
                keyManager.addCombination(config);
                dispatchKeyEvent(Keys.Y, { ctrlKey: true });
                assert.strictEqual(mockCallback.calledCount, 0, "Callback for 'y' (shorthand) should not be called with Ctrl");
                 mockCallback.mockClear();
                dispatchKeyEvent(Keys.Y, { altKey: true });
                assert.strictEqual(mockCallback.calledCount, 0, "Callback for 'y' (shorthand) should not be called with Alt");
                 mockCallback.mockClear();
                dispatchKeyEvent(Keys.Y, { shiftKey: true });
                assert.strictEqual(mockCallback.calledCount, 0, "Callback for 'y' (shorthand) should not be called with Shift");
                 mockCallback.mockClear();
                dispatchKeyEvent(Keys.Y, { metaKey: true });
                assert.strictEqual(mockCallback.calledCount, 0, "Callback for 'y' (shorthand) should not be called with Meta");
            });

            it("should trigger callback for shorthand if ONLY the key is pressed (no modifiers)", () => {
                const config: KeyCombinationConfig = { id: "shorthandZ", keys: Keys.Z, callback: mockCallback };
                keyManager.addCombination(config);
                dispatchKeyEvent(Keys.Z, { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
                assert.strictEqual(mockCallback.calledCount, 1);
            });

            it("should handle preventDefault correctly for shorthand", () => {
                const config: KeyCombinationConfig = { id: "shorthandPrevent", keys: Keys.P, callback: mockCallback, preventDefault: true };
                keyManager.addCombination(config);
                const event = dispatchKeyEvent(Keys.P.toLowerCase());
                assert.strictEqual(mockCallback.calledCount, 1);
                assert.strictEqual(event.defaultPrevented, true);
            });

            it("should respect context for shorthand", () => {
                const config: KeyCombinationConfig = { id: "shorthandContext", keys: Keys.C, callback: mockCallback, context: "editor" };
                keyManager.addCombination(config);

                keyManager.setContext("other");
                dispatchKeyEvent(Keys.C.toLowerCase());
                assert.strictEqual(mockCallback.calledCount, 0);

                keyManager.setContext("editor");
                dispatchKeyEvent(Keys.C.toLowerCase());
                assert.strictEqual(mockCallback.calledCount, 1);
            });

            it("should return undefined and warn if shorthand key is an empty string", () => {
                const config: KeyCombinationConfig = { id: "emptyShorthand", keys: "" as StandardKey, callback: mockCallback };
                const result = keyManager.addCombination(config);
                assert.strictEqual(result, undefined);
                assert.strictEqual(consoleWarnMock.mock.calls.length, 1);
                assert.ok(consoleWarnMock.mock.calls[0].arguments[0].includes(`Invalid "keys" (shorthand) for combination shortcut "emptyShorthand"`));
            });

            it("should correctly log shorthand key details in debug mode", () => {
                const consoleLogMock = mock.method(console, "log");
                keyManager.setDebugMode(true);
                const config: KeyCombinationConfig = { id: "debugShorthand", keys: Keys.D, callback: mockCallback };
                keyManager.addCombination(config);

                const logMessage = consoleLogMock.mock.calls.find(call => call.arguments[0].includes(`combination shortcut "debugShorthand" added`));
                assert.ok(logMessage, "Debug log for adding shortcut not found");
                assert.ok(logMessage.arguments[0].includes(`Keys: { key: "D" (no modifiers implied) }`), `Log message content mismatch: ${logMessage.arguments[0]}`);
                consoleLogMock.mock.restore();
                keyManager.setDebugMode(false);
            });

            it("should trigger callback for Keys.Space using shorthand", () => {
                const config: KeyCombinationConfig = { id: "spaceShorthand", keys: Keys.Space, callback: mockCallback };
                keyManager.addCombination(config);
                dispatchKeyEvent(" "); // Event key for space is " "
                assert.strictEqual(mockCallback.calledCount, 1, "Callback for Keys.Space (shorthand) not called");
            });

            it("should trigger callback for Keys.Space using object form", () => {
                const config: KeyCombinationConfig = { id: "spaceObject", keys: { key: Keys.Space }, callback: mockCallback };
                keyManager.addCombination(config);
                dispatchKeyEvent(" ");
                assert.strictEqual(mockCallback.calledCount, 1, "Callback for Keys.Space (object form) not called");
            });
        });
    });

    describe("addSequence", () => {
        it("should trigger callback for a simple key sequence", () => {
            const config: KeySequenceConfig = { id: "seqGI", sequence: [Keys.G, Keys.I], callback: mockCallback };
            const result = keyManager.addSequence(config);
            assert.strictEqual(result, "seqGI");
            dispatchKeyEvent("g"); // Dispatch "g" (lowercase)
            dispatchKeyEvent("i"); // Dispatch "i" (lowercase)
            assert.strictEqual(mockCallback.calledCount, 1);
        });

        it("should trigger callback for Konami code using Keys", () => {
            const konamiSequence: StandardKey[] = [
                Keys.ArrowUp, Keys.ArrowUp, Keys.ArrowDown, Keys.ArrowDown,
                Keys.ArrowLeft, Keys.ArrowRight, Keys.ArrowLeft, Keys.ArrowRight,
                Keys.B, Keys.A // Using "B" and "A" from Keys
            ];
            const config: KeySequenceConfig = { id: "konami", sequence: konamiSequence, callback: mockCallback };
            keyManager.addSequence(config);
            // Dispatch events using the string values that browser events would produce
            ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"].forEach(key => dispatchKeyEvent(key));
            assert.strictEqual(mockCallback.calledCount, 1, "Konami sequence callback not triggered");
        });


        it("should return undefined and warn if sequence is empty", () => {
            const config: KeySequenceConfig = { id: "emptySeq", sequence: [], callback: mockCallback };
            const result = keyManager.addSequence(config);
            assert.strictEqual(result, undefined);
            assert.strictEqual(consoleWarnMock.mock.calls.length, 1);
            assert.ok(consoleWarnMock.mock.calls[0].arguments[0].includes(`Sequence for shortcut "emptySeq" is empty`));
        });

        it("should return undefined and warn if sequence contains an invalid key (runtime check with 'as any')", () => {
            // This test checks runtime robustness if `any` is used to bypass StandardKey[]
            const config: KeySequenceConfig = { id: "invalidKeyInSeq", sequence: [Keys.A, "" as any, Keys.C], callback: mockCallback };
            const result = keyManager.addSequence(config);
            assert.strictEqual(result, undefined, "addSequence should return undefined for sequence with empty string");
            assert.strictEqual(consoleWarnMock.mock.calls.length, 1, "console.warn was not called for invalid key in sequence");
            assert.ok(consoleWarnMock.mock.calls[0].arguments[0].includes(`Invalid key in sequence for shortcut "invalidKeyInSeq"`));
        });


        it("should pass the last KeyboardEvent of the sequence to the callback", () => {
            const config: KeySequenceConfig = { id: "seqEventPass", sequence: [Keys.X, Keys.Y], callback: mockCallback };
            keyManager.addSequence(config);
            dispatchKeyEvent("x");
            const lastEvent = dispatchKeyEvent("y");
            assert.strictEqual(mockCallback.calledCount, 1);
            assert.deepStrictEqual(mockCallback.lastArgs, [lastEvent]);
        });

        it("should prevent default for the last key event in the sequence when preventDefault is true", () => {
            const config: KeySequenceConfig = { id: "seqPrevent", sequence: [Keys.M, Keys.N], callback: mockCallback, preventDefault: true };
            keyManager.addSequence(config);
            dispatchKeyEvent("m");
            const eventN = dispatchKeyEvent("n");
            assert.strictEqual(mockCallback.calledCount, 1);
            assert.strictEqual(eventN.defaultPrevented, true);
        });

        it("should log an error via console.error if sequence callback throws", () => {
            const errorCallback = () => { throw new Error("Test sequence callback error"); };
            keyManager.addSequence({ id: "errorSeq", sequence: [Keys.E, Keys.S], callback: errorCallback });

            dispatchKeyEvent("e");
            dispatchKeyEvent("s");
            assert.strictEqual(consoleErrorMock.mock.calls.length, 1);
            assert.ok(consoleErrorMock.mock.calls[0].arguments[0].includes(`Error in user callback for sequence shortcut "errorSeq"`));
        });

        it("should trigger callback for a sequence including Keys.Space", () => {
            const config: KeySequenceConfig = {
                id: "seqWithSpace",
                sequence: [Keys.G, Keys.Space, Keys.I],
                callback: mockCallback
            };
            keyManager.addSequence(config);
            dispatchKeyEvent(Keys.G);
            dispatchKeyEvent(Keys.Space); // Dispatch " " for space
            dispatchKeyEvent(Keys.I);
            assert.strictEqual(mockCallback.calledCount, 1, "Callback for sequence with Keys.Space not called");
        });

        it("should trigger callback for a sequence starting or ending with Keys.Space", () => {
            const config: KeySequenceConfig = {
                id: "seqStartSpace",
                sequence: [Keys.Space, Keys.A],
                callback: mockCallback
            };
            keyManager.addSequence(config);
            dispatchKeyEvent(Keys.Space);
            dispatchKeyEvent(Keys.A);
            assert.strictEqual(mockCallback.calledCount, 1, "Callback for sequence starting with Keys.Space not called");
        });

        describe("Sequence Contextual Triggering", () => {
            let editorSequenceConfig: KeySequenceConfig;
            beforeEach(() => {
                editorSequenceConfig = {
                    id: "sequenceInEditor",
                    sequence: [Keys.C, Keys.O, Keys.D, Keys.E],
                    callback: mockCallback,
                    context: "editor",
                };
            });

            it("should trigger sequence in matching context", () => {
                keyManager.addSequence(editorSequenceConfig);
                keyManager.setContext("editor");
                [Keys.C, Keys.O, Keys.D, Keys.E].forEach(k => dispatchKeyEvent(k));
                assert.strictEqual(mockCallback.calledCount, 1);
            });
        });

        describe("Sequence Timeouts", () => {
            const TIMEOUT_MS = 100;
            let originalPerformanceNowForSuite: any;

            beforeEach(() => {
                mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"] as any[], now: 0 });
                // @ts-ignore
                if (!originalPerformanceNowForSuite && global.performance && global.performance.now) {
                    // @ts-ignore
                    originalPerformanceNowForSuite = global.performance.now;
                }
                // @ts-ignore
                performanceNowMock = mock.method(global.performance, "now", () => Date.now());
            });

            afterEach(() => {
                if (performanceNowMock && performanceNowMock.mock) {
                    performanceNowMock.mock.restore();
                } else if (originalPerformanceNowForSuite) {
                     // @ts-ignore
                    global.performance.now = originalPerformanceNowForSuite;
                }
                mock.timers.reset();
            });

            it("should trigger sequence if keys are pressed within specified timeout", () => {
                const config: KeySequenceConfig = { id: "seqTimeoutOk", sequence: [Keys.T, Keys.O, Keys.K], callback: mockCallback, sequenceTimeoutMs: TIMEOUT_MS };
                keyManager.addSequence(config);
                dispatchKeyEvent(Keys.T);
                mock.timers.tick(TIMEOUT_MS / 2);
                dispatchKeyEvent(Keys.O);
                mock.timers.tick(TIMEOUT_MS / 2);
                const lastEvent = dispatchKeyEvent(Keys.K);
                assert.strictEqual(mockCallback.calledCount, 1);
                assert.deepStrictEqual(mockCallback.lastArgs, [lastEvent]);
            });

            it("should NOT trigger sequence if a key press is delayed beyond timeout", () => {
                const config: KeySequenceConfig = { id: "seqTimeoutFail", sequence: [Keys.D, Keys.E, Keys.L], callback: mockCallback, sequenceTimeoutMs: TIMEOUT_MS };
                keyManager.addSequence(config);
                dispatchKeyEvent(Keys.D);
                mock.timers.tick(TIMEOUT_MS / 2);
                dispatchKeyEvent(Keys.E);
                mock.timers.tick(TIMEOUT_MS + 1);
                dispatchKeyEvent(Keys.L);
                assert.strictEqual(mockCallback.calledCount, 0);
            });
        });
    });

    describe("remove", () => {
        it("should remove a combination shortcut", () => {
            keyManager.addCombination({ id: "remA", keys: { key: Keys.A }, callback: mockCallback });
            assert.strictEqual(keyManager.remove("remA"), true);
            dispatchKeyEvent(Keys.A);
            assert.strictEqual(mockCallback.calledCount, 0);
        });

        it("should remove a sequence shortcut", () => {
            keyManager.addSequence({ id: "remSeq", sequence: [Keys.A, Keys.B], callback: mockCallback });
            assert.strictEqual(keyManager.remove("remSeq"), true);
            dispatchKeyEvent(Keys.A);
            dispatchKeyEvent(Keys.B);
            assert.strictEqual(mockCallback.calledCount, 0);
        });
    });

    describe("getActiveShortcuts", () => {
        it("should return active combination and sequence shortcuts with enum types", () => {
            keyManager.addCombination({ id: "combo1", keys: { key: Keys.A }, callback: createMockFn(), description: "Test A" });
            keyManager.addSequence({ id: "seq1", sequence: [Keys.B, Keys.C], callback: createMockFn(), context: "modal", description: "Test BC" });

            const active = keyManager.getActiveShortcuts();
            assert.strictEqual(active.length, 2);
            const combo = active.find(s => s.id === "combo1");
            assert.ok(combo);
            assert.strictEqual(combo.type, ShortcutTypes.Combination); // Use Enum for comparison
            const seq = active.find(s => s.id === "seq1");
            assert.ok(seq);
            assert.strictEqual(seq.type, ShortcutTypes.Sequence); // Use Enum for comparison
        });
    });

    describe("hasShortcut", () => {
        it("should return true for an existing combination shortcut", () => {
            keyManager.addCombination({ id: "existsCombo", keys: { key: Keys.E }, callback: mockCallback });
            assert.strictEqual(keyManager.hasShortcut("existsCombo"), true);
        });

        it("should return false for a shortcut that failed to add (e.g. invalid key object)", () => {
            // This test now relies on the runtime check for !keys.key, as TS would catch `key: null` directly.
            const config = { id: "invalidKeyCombo", keys: { key: null as any }, callback: mockCallback };
            keyManager.addCombination(config as KeyCombinationConfig);
            assert.strictEqual(keyManager.hasShortcut("invalidKeyCombo"), false);
        });
    });

    describe("destroy", () => {
        it("should clear active shortcuts and prevent further triggers", () => {
            keyManager.addCombination({ id: "destroyTestCombo", keys: { key: Keys.D }, callback: mockCallback });
            keyManager.addSequence({ id: "destroyTestSeq", sequence: [Keys.X, Keys.Y], callback: mockCallback });
            // @ts-ignore
            assert.strictEqual(keyManager["activeShortcuts"].size, 2);
            keyManager.destroy();
            // @ts-ignore
            assert.strictEqual(keyManager["activeShortcuts"].size, 0);
            dispatchKeyEvent(Keys.D);
            dispatchKeyEvent(Keys.X); dispatchKeyEvent(Keys.Y);
            assert.strictEqual(mockCallback.calledCount, 0);
        });
    });
});
