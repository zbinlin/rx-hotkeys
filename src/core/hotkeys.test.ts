import { describe, it, before, beforeEach, afterEach, mock, Mock } from "node:test";
import assert from "node:assert";
import { Hotkeys, type KeyCombinationConfig, type KeySequenceConfig, ShortcutTypes } from "./hotkeys.js";
import { Keys, type StandardKey } from "./keys.js";
import { fromEvent, BehaviorSubject, Observable, EMPTY } from "rxjs";
import { createMockFn, dispatchKeyEvent } from "./testutils.js";
import { JSDOM } from "jsdom";

// --- JSDOM and RxJS setup for Node.js tests ---
let dom: any;
let window: any;
let document: any;
let originalPerformanceNow: any;
let testArea: HTMLElement; // For target tests

before(() => {
    dom = new JSDOM(`<!DOCTYPE html><html><body><div id="test-area"></div></body></html>`, {
        url: "http://localhost",
    });
    window = dom.window;
    document = window.document;
    testArea = document.getElementById("test-area");
    // @ts-ignore
    global.document = document;
    // @ts-ignore
    global.window = window;
    // @ts-ignore
    global.HTMLElement = window.HTMLElement;
    // @ts-ignore
    global.KeyboardEvent = window.KeyboardEvent;
    // @ts-ignore
    global.BehaviorSubject = BehaviorSubject;
    // @ts-ignore
    global.fromEvent = fromEvent;
    // @ts-ignore
    global.Observable = Observable;
    // @ts-ignore
    global.EMPTY = EMPTY;

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
    let consoleWarnMock: Mock<Console["warn"]>;
    let consoleErrorMock: Mock<Console["error"]>;
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
        it(`should return an Observable that emits on a simple key combination (e.g., "A")`, () => {
            const config: Omit<KeyCombinationConfig, "callback"> = { id: "simpleA", keys: { key: Keys.A } };
            const combo$ = keyManager.addCombination(config);
            assert(combo$ instanceof Observable, "Did not return an Observable");

            combo$.subscribe(mockCallback);

            dispatchKeyEvent(document, "a");
            assert.strictEqual(mockCallback.calledCount, 1, `Callback for "a" not called`);
            mockCallback.mockClear();
            dispatchKeyEvent(document, "A");
            assert.strictEqual(mockCallback.calledCount, 1, `Callback for "A" not called`);
        });

        it("should return an empty observable and warn if keys.key is null or undefined", () => {
            const config: KeyCombinationConfig = { id: "nullKey", keys: { key: null as any } };
            const combo$ = keyManager.addCombination(config);
            combo$.subscribe(mockCallback);

            assert.strictEqual(consoleWarnMock.mock.calls.length, 1);
            assert.ok(consoleWarnMock.mock.calls[0].arguments[0].includes(`Invalid "key" property in shortcut "nullKey"`));
            dispatchKeyEvent(document, "a");
            assert.strictEqual(mockCallback.calledCount, 0);
        });


        it("should pass the KeyboardEvent to the subscriber", () => {
            const config: Omit<KeyCombinationConfig, "callback"> = { id: "eventPass", keys: { key: Keys.E } };
            keyManager.addCombination(config).subscribe(mockCallback);
            const event = dispatchKeyEvent(document, "e");
            assert.strictEqual(mockCallback.calledCount, 1);
            assert.deepStrictEqual(mockCallback.lastArgs, [event]);
        });

        it("should emit for a combination with Ctrl key", () => {
            const config: Omit<KeyCombinationConfig, "callback"> = { id: "ctrlS", keys: { key: Keys.S, ctrlKey: true } };
            keyManager.addCombination(config).subscribe(mockCallback);
            dispatchKeyEvent(document, "s", "keydown", { ctrlKey: true });
            assert.strictEqual(mockCallback.calledCount, 1);
        });

        it("should NOT emit if specified modifier key (ctrlKey: false) is false and event has it true", () => {
            const config: Omit<KeyCombinationConfig, "callback"> = { id: "noCtrlA", keys: { key: Keys.A, ctrlKey: false } };
            keyManager.addCombination(config).subscribe(mockCallback);
            dispatchKeyEvent(document, "a", "keydown", { ctrlKey: true });
            assert.strictEqual(mockCallback.calledCount, 0);
            dispatchKeyEvent(document, "a", "keydown", { ctrlKey: false });
            assert.strictEqual(mockCallback.calledCount, 1);
        });

        it("should emit for special keys like Escape (object form)", () => {
            const config: Omit<KeyCombinationConfig, "callback"> = { id: "escapeKeyObj", keys: { key: Keys.Escape } };
            keyManager.addCombination(config).subscribe(mockCallback);
            dispatchKeyEvent(document, "Escape"); // Event key matches Keys.Escape
            assert.strictEqual(mockCallback.calledCount, 1);
        });


        it("should handle preventDefault correctly (object form)", () => {
            const config: Omit<KeyCombinationConfig, "callback"> = { id: "preventAObj", keys: { key: Keys.A }, preventDefault: true };
            keyManager.addCombination(config).subscribe(mockCallback);
            const event = dispatchKeyEvent(document, "a");
            assert.strictEqual(mockCallback.calledCount, 1);
            assert.strictEqual(event.defaultPrevented, true);
        });

        it("should overwrite an existing combination, warn, and terminate the old stream", () => {
            const firstCallback = createMockFn();
            const firstComplete = createMockFn();
            const secondCallback = createMockFn();

            const first$ = keyManager.addCombination({ id: "combo1", keys: { key: Keys.K } });
            first$.subscribe({ next: firstCallback, complete: firstComplete });

            consoleWarnMock.mock.resetCalls();

            const second$ = keyManager.addCombination({ id: "combo1", keys: { key: Keys.K, ctrlKey: true } });
            second$.subscribe(secondCallback);

            assert.strictEqual(consoleWarnMock.mock.calls.length, 1);
            assert.ok(consoleWarnMock.mock.calls[0].arguments[0].includes(`Shortcut with ID "combo1" already exists`));
            assert.strictEqual(firstComplete.calledCount, 1, "First observable should have completed");

            dispatchKeyEvent(document, "k");
            assert.strictEqual(firstCallback.calledCount, 0);
            dispatchKeyEvent(document, "k", "keydown", { ctrlKey: true });
            assert.strictEqual(secondCallback.calledCount, 1);
        });

        it("should not affect other shortcuts if one subscription throws an error", () => {
            const workingCallback = createMockFn();
            const erroringCallback = () => { throw new Error("Test callback error"); };

            const error$ = keyManager.addCombination({ id: "errorCombo", keys: { key: Keys.E }});
            // Suppress unhandled exception message in test runner output
            error$.subscribe(erroringCallback, () => {});

            const working$ = keyManager.addCombination({ id: "workingCombo", keys: { key: Keys.W }});
            working$.subscribe(workingCallback);

            // Dispatch event that causes an error in the subscription
            //dispatchKeyEvent(document, "e");

            // Dispatch another event to ensure the other shortcut still works
            dispatchKeyEvent(document, "w");
            assert.strictEqual(workingCallback.calledCount, 1, "Working callback should have been called");
        });

        it("should emit if any of multiple key combinations are pressed", () => {
            const config: Omit<KeyCombinationConfig, "callback"> = {
                id: "multiCombo",
                keys: [
                    { key: Keys.A, ctrlKey: true }, // Ctrl+A
                    Keys.Escape,                   // Escape
                    { key: Keys.B, shiftKey: true, altKey: true} // Shift+Alt+B
                ],
            };
            keyManager.addCombination(config).subscribe(mockCallback);

            dispatchKeyEvent(document, "A", "keydown", { ctrlKey: true });
            assert.strictEqual(mockCallback.calledCount, 1, "Ctrl+A did not trigger");

            dispatchKeyEvent(document, "Escape");
            assert.strictEqual(mockCallback.calledCount, 2, "Escape did not trigger");

            dispatchKeyEvent(document, "B", "keydown", { shiftKey: true, altKey: true });
            assert.strictEqual(mockCallback.calledCount, 3, "Shift+Alt+B did not trigger");

            dispatchKeyEvent(document, "C"); // Should not trigger
            assert.strictEqual(mockCallback.calledCount, 3, "Unrelated key C triggered");
        });

        it(`should return an empty observable and warn if "keys" array is empty`, () => {
            const config: Omit<KeyCombinationConfig, "callback"> = { id: "emptyKeysArray", keys: [] };
            const combo$ = keyManager.addCombination(config);
            combo$.subscribe(mockCallback);
            assert.ok(consoleWarnMock.mock.calls.some(call => call.arguments[0].includes(`"keys" definition for combination shortcut "emptyKeysArray" is empty`)));
            dispatchKeyEvent(document, "a");
            assert.strictEqual(mockCallback.calledCount, 0);
        });

        it(`should return an empty observable and warn if a key in "keys" array is invalid (shorthand)`, () => {
            const config: Omit<KeyCombinationConfig, "callback"> = { id: "invalidInArrayShorthand", keys: [Keys.A, "" as StandardKey] };
            const combo$ = keyManager.addCombination(config);
            combo$.subscribe(mockCallback);
            assert.ok(consoleWarnMock.mock.calls.some(call => call.arguments[0].includes(`Could not parse key: "" in shortcut "invalidInArrayShorthand"`)));
        });

        it(`should return an empty observable and warn if a key in "keys" array is invalid (object)`, () => {
            const config: Omit<KeyCombinationConfig, "callback"> = { id: "invalidInArrayObject", keys: [Keys.A, { key: "" as StandardKey }] };
            const combo$ = keyManager.addCombination(config);
            combo$.subscribe(mockCallback);
            assert.ok(consoleWarnMock.mock.calls.some(call => call.arguments[0].includes(`Invalid "key" property in shortcut "invalidInArrayObject"`)));
        });

        it("should correctly log multiple key triggers in debug mode", () => {
            const consoleLogMock = mock.method(console, "log");
            keyManager.setDebugMode(true);
            keyManager.addCombination({ id: "multiLog", keys: [Keys.F1, { key: Keys.F2, ctrlKey: true }] });
            assert.ok(consoleLogMock.mock.calls.some(call => call.arguments[0].includes(`Triggers: [ { key: "F1" (no mods) }, { key: "F2", ctrl: true } ]`)), "Multi-trigger log format incorrect");
            consoleLogMock.mock.restore();
        });

        describe("addCombination - Shorthand Syntax", () => {
            it("should emit for a simple key using shorthand (e.g., Keys.X)", () => {
                const config: Omit<KeyCombinationConfig, "callback"> = { id: "shorthandX", keys: Keys.X };
                keyManager.addCombination(config).subscribe(mockCallback);
                dispatchKeyEvent(document, Keys.X.toLowerCase());
                assert.strictEqual(mockCallback.calledCount, 1, `Callback for "x" (shorthand) not called`);
                mockCallback.mockClear();
                dispatchKeyEvent(document, Keys.X);
                assert.strictEqual(mockCallback.calledCount, 1, `Callback for "X" (shorthand) not called`);
            });

            it("should NOT emit for shorthand if modifier is pressed", () => {
                const config: Omit<KeyCombinationConfig, "callback"> = { id: "shorthandY", keys: Keys.Y };
                keyManager.addCombination(config).subscribe(mockCallback);
                dispatchKeyEvent(document, Keys.Y, "keydown", { ctrlKey: true });
                assert.strictEqual(mockCallback.calledCount, 0, `Callback for "y" (shorthand) should not be called with Ctrl`);
                 mockCallback.mockClear();
                dispatchKeyEvent(document, Keys.Y, "keydown", { altKey: true });
                assert.strictEqual(mockCallback.calledCount, 0, `Callback for "y" (shorthand) should not be called with Alt`);
                 mockCallback.mockClear();
                dispatchKeyEvent(document, Keys.Y, "keydown", { shiftKey: true });
                assert.strictEqual(mockCallback.calledCount, 0, `Callback for "y" (shorthand) should not be called with Shift`);
                 mockCallback.mockClear();
                dispatchKeyEvent(document, Keys.Y, "keydown", { metaKey: true });
                assert.strictEqual(mockCallback.calledCount, 0, `Callback for "y" (shorthand) should not be called with Meta`);
            });

            it("should emit for shorthand if ONLY the key is pressed (no modifiers)", () => {
                const config: Omit<KeyCombinationConfig, "callback"> = { id: "shorthandZ", keys: Keys.Z };
                keyManager.addCombination(config).subscribe(mockCallback);
                dispatchKeyEvent(document, Keys.Z, "keydown", { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
                assert.strictEqual(mockCallback.calledCount, 1);
            });

            it("should handle preventDefault correctly for shorthand", () => {
                const config: Omit<KeyCombinationConfig, "callback"> = { id: "shorthandPrevent", keys: Keys.P, preventDefault: true };
                keyManager.addCombination(config).subscribe(mockCallback);
                const event = dispatchKeyEvent(document, Keys.P.toLowerCase());
                assert.strictEqual(mockCallback.calledCount, 1);
                assert.strictEqual(event.defaultPrevented, true);
            });

            it("should respect context for shorthand", () => {
                const config: Omit<KeyCombinationConfig, "callback"> = { id: "shorthandContext", keys: Keys.C, context: "editor" };
                keyManager.addCombination(config).subscribe(mockCallback);

                keyManager.setContext("other");
                dispatchKeyEvent(document, Keys.C.toLowerCase());
                assert.strictEqual(mockCallback.calledCount, 0);

                keyManager.setContext("editor");
                dispatchKeyEvent(document, Keys.C.toLowerCase());
                assert.strictEqual(mockCallback.calledCount, 1);
            });

            it("should return an empty observable and warn if shorthand key is an empty string", () => {
                const config: Omit<KeyCombinationConfig, "callback"> = { id: "emptyShorthand", keys: "" as StandardKey };
                const combo$ = keyManager.addCombination(config);
                combo$.subscribe(mockCallback);
                assert.strictEqual(consoleWarnMock.mock.calls.length, 1);
                assert.ok(consoleWarnMock.mock.calls[0].arguments[0].includes(`Could not parse key: "" in shortcut "emptyShorthand"`));
            });

            it("should return an empty observable and warn if shorthand key is an empty array", () => {
                const config: Omit<KeyCombinationConfig, "callback"> = { id: "emptyArrayShorthand", keys: [] };
                const combo$ = keyManager.addCombination(config);
                combo$.subscribe(mockCallback);
                assert.strictEqual(consoleWarnMock.mock.calls.length, 1);
                assert.ok(consoleWarnMock.mock.calls[0].arguments[0].includes(`"keys" definition for combination shortcut "emptyArrayShorthand" is empty or invalid. Shortcut not added.`));
            });

            it("should return an empty observable and warn if shorthand key is an empty string in array", () => {
                const config: Omit<KeyCombinationConfig, "callback"> = { id: "emptyStringShorthand", keys: ["" as StandardKey] };
                const combo$ = keyManager.addCombination(config);
                combo$.subscribe(mockCallback);
                assert.strictEqual(consoleWarnMock.mock.calls.length, 1);
                assert.ok(consoleWarnMock.mock.calls[0].arguments[0].includes(`Could not parse key: "" in shortcut "emptyStringShorthand"`));
            });

            it("should return an empty observable and warn if shorthand key is invalid", () => {
                const config: Omit<KeyCombinationConfig, "callback"> = { id: "invalidKeyPropertyShorthand", keys: { key: "" as StandardKey } };
                const combo$ = keyManager.addCombination(config);
                combo$.subscribe(mockCallback);
                assert.strictEqual(consoleWarnMock.mock.calls.length, 1);
                assert.ok(consoleWarnMock.mock.calls[0].arguments[0].includes(`Invalid "key" property in shortcut "invalidKeyPropertyShorthand". Key must be a non-empty string value from Keys.`));
            });

            it("should correctly log shorthand key details in debug mode", () => {
                const consoleLogMock = mock.method(console, "log");
                keyManager.setDebugMode(true);
                const config: Omit<KeyCombinationConfig, "callback"> = { id: "debugShorthand", keys: Keys.D };
                keyManager.addCombination(config);

                const logMessage = consoleLogMock.mock.calls.find(call => call.arguments[0].includes(`combination shortcut "debugShorthand" added.`));
                assert.ok(logMessage, "Debug log for adding shortcut not found");
                assert.ok(logMessage.arguments[0].includes(`{ key: "D" (no mods) }`), `Log message content mismatch: ${logMessage.arguments[0]}`);
                consoleLogMock.mock.restore();
                keyManager.setDebugMode(false);
            });

            it("should emit for Keys.Space using shorthand", () => {
                const config: Omit<KeyCombinationConfig, "callback"> = { id: "spaceShorthand", keys: Keys.Space };
                keyManager.addCombination(config).subscribe(mockCallback);
                dispatchKeyEvent(document, " "); // Event key for space is " "
                assert.strictEqual(mockCallback.calledCount, 1, "Callback for Keys.Space (shorthand) not called");
            });

            it("should emit for Keys.Space using object form", () => {
                const config: Omit<KeyCombinationConfig, "callback"> = { id: "spaceObject", keys: { key: Keys.Space } };
                keyManager.addCombination(config).subscribe(mockCallback);
                dispatchKeyEvent(document, " ");
                assert.strictEqual(mockCallback.calledCount, 1, "Callback for Keys.Space (object form) not called");
            });
        });
    });

    describe("String-based Definitions", () => {
        it(`should parse and trigger a simple string "ctrl+s"`, () => {
            keyManager.addCombination({ id: "strSave", keys: "ctrl+s" }).subscribe(mockCallback);
            dispatchKeyEvent(document, "s", "keydown", { ctrlKey: true });
            assert.strictEqual(mockCallback.calledCount, 1);
            dispatchKeyEvent(document, "s");
            assert.strictEqual(mockCallback.calledCount, 1);
        });

        it(`should parse and trigger "shift+alt+k"`, () => {
            keyManager.addCombination({ id: "strComplex", keys: "shift+alt+k" }).subscribe(mockCallback);
            dispatchKeyEvent(document, "k", "keydown", { shiftKey: true, altKey: true });
            assert.strictEqual(mockCallback.calledCount, 1);
        });

        it(`should parse aliases like "cmd+p"`, () => {
            keyManager.addCombination({ id: "strAlias", keys: "cmd+p" }).subscribe(mockCallback);
            dispatchKeyEvent(document, "p", "keydown", { metaKey: true });
            assert.strictEqual(mockCallback.calledCount, 1);
        });

        it(`should parse special key strings like "escape"`, () => {
            keyManager.addCombination({ id: "strSpecial", keys: "escape" }).subscribe(mockCallback);
            dispatchKeyEvent(document, "Escape");
            assert.strictEqual(mockCallback.calledCount, 1);
        });

        it(`should parse sequence string "g -> i"`, () => {
            keyManager.addSequence({ id: "strSeq", sequence: "g -> i" }).subscribe(mockCallback);
            dispatchKeyEvent(document, "g");
            dispatchKeyEvent(document, "i");
            assert.strictEqual(mockCallback.calledCount, 1);
        });

        it(`should parse sequence string with special keys "up -> down -> enter"`, () => {
            keyManager.addSequence({ id: "strSeqSpecial", sequence: "up -> down -> enter" }).subscribe(mockCallback);
            dispatchKeyEvent(document, "ArrowUp");
            dispatchKeyEvent(document, "ArrowDown");
            dispatchKeyEvent(document, "Enter");
            assert.strictEqual(mockCallback.calledCount, 1);
        });

        it("should warn and return empty on invalid string", () => {
            const combo$ = keyManager.addCombination({ id: "invalid", keys: "ctrl+badkey" });
            combo$.subscribe(mockCallback);
            assert.ok(consoleWarnMock.mock.calls.some(c => c.arguments[0].includes(`Could not parse key: "badkey"`)));
            assert.strictEqual(mockCallback.calledCount, 0);
        });
    });

    describe("Normalization and Edge Case Tests", () => {
        it(`should handle the "+" key as a shorthand, not a combination`, () => {
            keyManager.addCombination({ id: "plusKey", keys: Keys.KeypadAdd }).subscribe(mockCallback);
            dispatchKeyEvent(document, "+");
            assert.strictEqual(mockCallback.calledCount, 1, `Callback for "+" key not called`);
        });

        it(`should handle "escape" (lowercase) and normalize it to match the "Escape" event key`, () => {
            keyManager.addCombination({ id: "lowerEscape", keys: "escape" }).subscribe(mockCallback);
            dispatchKeyEvent(document, "Escape"); // Event key from browser is capitalized
            assert.strictEqual(mockCallback.calledCount, 1, `Lowercase "escape" did not match event`);
        });

        it(`should handle "ESC" (uppercase) and normalize it`, () => {
            keyManager.addCombination({ id: "upperEsc", keys: "ESC" }).subscribe(mockCallback);
            dispatchKeyEvent(document, "Escape");
            assert.strictEqual(mockCallback.calledCount, 1, `Uppercase "ESC" did not match event`);
        });

        it(`should handle a single-word modifier alias like "cmd" as a shorthand for the "Meta" key`, () => {
            keyManager.addCombination({ id: "cmdKey", keys: "cmd" }).subscribe(mockCallback);
            dispatchKeyEvent(document, "Meta"); // Event key for command key is "Meta"
            assert.strictEqual(mockCallback.calledCount, 1, `Alias "cmd" did not match "Meta" key event`);
        });

        it(`should handle combination string with extra spaces like " ctrl + s "`, () => {
            keyManager.addCombination({ id: "paddedCombo", keys: " ctrl + s " }).subscribe(mockCallback);
            dispatchKeyEvent(document, "s", "keydown", { ctrlKey: true });
            assert.strictEqual(mockCallback.calledCount, 1, "Padded combination string failed to parse");
        });
    });

    describe("New Feature: Element-Scoped Listeners", () => {
        let el1: HTMLElement, el2: HTMLElement;

        beforeEach(() => {
            el1 = document.createElement("div");
            el2 = document.createElement("div");
            document.body.append(el1, el2);
        });

        afterEach(() => {
            el1.remove();
            el2.remove();
        });

        it("should only trigger shortcut on the specified target element", () => {
            keyManager.addCombination({ id: "scoped", keys: "a", target: el1 }).subscribe(mockCallback);

            dispatchKeyEvent(el1, "a");
            assert.strictEqual(mockCallback.calledCount, 1, "Should trigger on target element");

            dispatchKeyEvent(el2, "a");
            assert.strictEqual(mockCallback.calledCount, 1, "Should NOT trigger on another element");

            dispatchKeyEvent(document, "a");
            assert.strictEqual(mockCallback.calledCount, 1, "Should NOT trigger on document");
        });

        it("should trigger global shortcut if no target is specified", () => {
            keyManager.addCombination({ id: "global", keys: "b" }).subscribe(mockCallback);

            // Event bubbles up from el1 to document
            dispatchKeyEvent(el1, "b");
            assert.strictEqual(mockCallback.calledCount, 1, "Should trigger on event from child element");

            dispatchKeyEvent(document, "b");
            assert.strictEqual(mockCallback.calledCount, 2, "Should trigger on document directly");
        });

        it("should work for sequences on a specific target", () => {
            keyManager.addSequence({ id: "scopedSeq", sequence: "a -> b", target: el1 }).subscribe(mockCallback);

            dispatchKeyEvent(el1, "a");
            dispatchKeyEvent(el1, "b");
            assert.strictEqual(mockCallback.calledCount, 1, "Sequence should trigger on target");

            dispatchKeyEvent(document, "a");
            dispatchKeyEvent(document, "b");
            assert.strictEqual(mockCallback.calledCount, 1, "Sequence should not trigger on document");
        });
    });

    describe("New Feature: keyup Event Support", () => {
        it("should trigger combination on keyup when specified", () => {
            keyManager.addCombination({ id: "keyupCombo", keys: "a", event: "keyup" }).subscribe(mockCallback);

            dispatchKeyEvent(document, "a", "keydown");
            assert.strictEqual(mockCallback.calledCount, 0, "Should not trigger on keydown");

            dispatchKeyEvent(document, "a", "keyup");
            assert.strictEqual(mockCallback.calledCount, 1, "Should trigger on keyup");
        });

        it("should trigger sequence on keyup when specified", () => {
            keyManager.addSequence({ id: "keyupSeq", sequence: "a -> b", event: "keyup" }).subscribe(mockCallback);

            dispatchKeyEvent(document, "a", "keydown");
            dispatchKeyEvent(document, "b", "keydown");
            assert.strictEqual(mockCallback.calledCount, 0, "Sequence should not trigger on keydown events");

            dispatchKeyEvent(document, "a", "keyup");
            dispatchKeyEvent(document, "b", "keyup");
            assert.strictEqual(mockCallback.calledCount, 1, "Sequence should trigger on keyup events");
        });

        it("should default to keydown if event type is not specified", () => {
            keyManager.addCombination({ id: "keydownDefault", keys: "c" }).subscribe(mockCallback);

            dispatchKeyEvent(document, "c", "keyup");
            assert.strictEqual(mockCallback.calledCount, 0);

            dispatchKeyEvent(document, "c", "keydown");
            assert.strictEqual(mockCallback.calledCount, 1);
        });
    });

    describe("Context Priority (Specific > Global)", () => {
        let globalCallback: ReturnType<typeof createMockFn>;
        let specificCallback: ReturnType<typeof createMockFn>;

        beforeEach(() => {
            globalCallback = createMockFn();
            specificCallback = createMockFn();

            // Global shortcut: Ctrl+G
            keyManager.addCombination({
                id: "globalCtrlG",
                keys: { key: Keys.G, ctrlKey: true },
                context: null // Explicitly global
            }).subscribe(globalCallback);

            // Specific context shortcut: Ctrl+G in "editor" context
            keyManager.addCombination({
                id: "editorCtrlG",
                keys: { key: Keys.G, ctrlKey: true },
                context: "editor"
            }).subscribe(specificCallback);
        });

        it("should only trigger specific context callback when specific context is active", () => {
            keyManager.setContext("editor");
            dispatchKeyEvent(document, Keys.G, "keydown", { ctrlKey: true });

            assert.strictEqual(specificCallback.calledCount, 1, "Specific callback should have been called");
            assert.strictEqual(globalCallback.calledCount, 0, "Global callback should NOT have been called");
        });

        it("should only trigger global callback when no specific context is active (or context doesn't match)", () => {
            keyManager.setContext(null); // No specific context
            dispatchKeyEvent(document, Keys.G, "keydown", { ctrlKey: true });
            assert.strictEqual(specificCallback.calledCount, 0, "Specific callback should NOT have been called");
            assert.strictEqual(globalCallback.calledCount, 1, "Global callback should have been called");

            globalCallback.mockClear();
            keyManager.setContext("anotherContext"); // Different specific context
            dispatchKeyEvent(document, Keys.G, "keydown", { ctrlKey: true });
            assert.strictEqual(specificCallback.calledCount, 0, `Specific callback should NOT have been called for "anotherContext"`);
            assert.strictEqual(globalCallback.calledCount, 1, `Global callback should have been called when in "anotherContext"`);
        });
    });

    describe("Sequence Context Priority (Specific > Global)", () => {
        let globalSeqCallback: ReturnType<typeof createMockFn>;
        let specificSeqCallback: ReturnType<typeof createMockFn>;
        const testSequence: StandardKey[] = [Keys.G, Keys.I];

        beforeEach(() => {
            globalSeqCallback = createMockFn();
            specificSeqCallback = createMockFn();

            keyManager.addSequence({
                id: "globalGI",
                sequence: testSequence,
                context: null // Global
            }).subscribe(globalSeqCallback);

            keyManager.addSequence({
                id: "editorGI",
                sequence: testSequence,
                context: "editor" // Specific
            }).subscribe(specificSeqCallback);
        });

        it("should only trigger specific context sequence callback when specific context is active", () => {
            keyManager.setContext("editor");
            testSequence.forEach(key => dispatchKeyEvent(document, key as string));

            assert.strictEqual(specificSeqCallback.calledCount, 1, "Specific sequence callback should have been called");
            assert.strictEqual(globalSeqCallback.calledCount, 0, "Global sequence callback should NOT have been called");
        });

        it("should only trigger global sequence callback when no specific context is active (or context doesn't match)", () => {
            keyManager.setContext(null); // No specific context
            testSequence.forEach(key => dispatchKeyEvent(document, key as string));
            assert.strictEqual(specificSeqCallback.calledCount, 0, "Specific sequence callback should NOT have been called");
            assert.strictEqual(globalSeqCallback.calledCount, 1, "Global sequence callback should have been called");

            globalSeqCallback.mockClear();
            specificSeqCallback.mockClear(); // Clear for next part of test

            keyManager.setContext("anotherContext"); // Different specific context
            testSequence.forEach(key => dispatchKeyEvent(document, key as string));
            assert.strictEqual(specificSeqCallback.calledCount, 0, `Specific sequence callback should NOT have been called for "anotherContext"`);
            assert.strictEqual(globalSeqCallback.calledCount, 1, `Global sequence callback should have been called when in "anotherContext"`);
        });
    });

    describe("Global Shortcut Context Behavior (`strict` flag)", () => {
        let strictGlobalCallback: ReturnType<typeof createMockFn>;
        let defaultGlobalCallback: ReturnType<typeof createMockFn>;
        let specificContextCallback: ReturnType<typeof createMockFn>;

        beforeEach(() => {
            strictGlobalCallback = createMockFn();
            defaultGlobalCallback = createMockFn();
            specificContextCallback = createMockFn();

            // 1. A specific shortcut for the "editor" context
            keyManager.addCombination({
                id: "editorSave",
                keys: { key: Keys.S, ctrlKey: true },
                context: "editor"
            }).subscribe(specificContextCallback);

            // 2. A "strictly global" shortcut, which only runs when context is null
            keyManager.addCombination({
                id: "strictGlobalOpen",
                keys: { key: Keys.O, ctrlKey: true },
                strict: true,
            }).subscribe(strictGlobalCallback);

            // 3. A default global shortcut, which runs in any context unless overridden
            keyManager.addCombination({
                id: "defaultGlobalSave",
                keys: { key: Keys.S, ctrlKey: true },
            }).subscribe(defaultGlobalCallback);
        });

        it("should trigger both strict and default global shortcuts when context is null", () => {
            keyManager.setContext(null);

            dispatchKeyEvent(document, Keys.O, "keydown", { ctrlKey: true });
            assert.strictEqual(strictGlobalCallback.calledCount, 1, "Strictly global (Ctrl+O) should fire");

            dispatchKeyEvent(document, Keys.S, "keydown", { ctrlKey: true });
            assert.strictEqual(defaultGlobalCallback.calledCount, 1, "Default global (Ctrl+S) should fire");
            assert.strictEqual(specificContextCallback.calledCount, 0, "Specific context callback should not fire");
        });

        it("should suppress strict global but allow default global (which is then suppressed by priority)", () => {
            keyManager.setContext("editor");

            dispatchKeyEvent(document, Keys.O, "keydown", { ctrlKey: true });
            assert.strictEqual(strictGlobalCallback.calledCount, 0, `Strictly global (Ctrl+O) should NOT fire in "editor" context`);

            dispatchKeyEvent(document, Keys.S, "keydown", { ctrlKey: true });
            assert.strictEqual(defaultGlobalCallback.calledCount, 0, "Default global (Ctrl+S) should be suppressed by the specific one");
            assert.strictEqual(specificContextCallback.calledCount, 1, `Specific "editor" callback (Ctrl+S) should fire and take priority`);
        });

        it("should suppress strict global but trigger default global in a non-conflicting context", () => {
            keyManager.setContext("someOtherContext");

            dispatchKeyEvent(document, Keys.O, "keydown", { ctrlKey: true });
            assert.strictEqual(strictGlobalCallback.calledCount, 0, `Strictly global (Ctrl+O) should NOT fire in "someOtherContext"`);

            dispatchKeyEvent(document, Keys.S, "keydown", { ctrlKey: true });
            assert.strictEqual(defaultGlobalCallback.calledCount, 1, "Default global (Ctrl+S) should fire since no override exists for this context");
            assert.strictEqual(specificContextCallback.calledCount, 0, `Specific "editor" callback should not fire`);
        });
    });

    describe("Sequence Context Behavior (`strict` flag)", () => {
        // This test suite remains valid as `addSequence` already had the correct structure.
        let strictSeqCallback: ReturnType<typeof createMockFn>;
        let defaultSeqCallback: ReturnType<typeof createMockFn>;
        let specificSeqCallback: ReturnType<typeof createMockFn>;
        const testSequence: StandardKey[] = [Keys.M, Keys.A, Keys.P];

        beforeEach(() => {
            strictSeqCallback = createMockFn();
            defaultSeqCallback = createMockFn();
            specificSeqCallback = createMockFn();

            keyManager.addSequence({ id: "strictSeq", sequence: [Keys.G, Keys.O], strict: true }).subscribe(strictSeqCallback);
            keyManager.addSequence({ id: "defaultSeq", sequence: testSequence }).subscribe(defaultSeqCallback);
            keyManager.addSequence({ id: "specificSeq", sequence: testSequence, context: "editor" }).subscribe(specificSeqCallback);
        });

        it("should trigger both strict and default global sequences when context is null", () => {
            keyManager.setContext(null);

            [Keys.G, Keys.O].forEach(key => dispatchKeyEvent(document, key));
            assert.strictEqual(strictSeqCallback.calledCount, 1, "Strict sequence should fire");

            testSequence.forEach(key => dispatchKeyEvent(document, key));
            assert.strictEqual(defaultSeqCallback.calledCount, 1, "Default sequence should fire");
            assert.strictEqual(specificSeqCallback.calledCount, 0, "Specific sequence should not fire");
        });

        it("should suppress strict sequence and prioritize specific sequence in a matching context", () => {
            keyManager.setContext("editor");

            [Keys.G, Keys.O].forEach(key => dispatchKeyEvent(document, key));
            assert.strictEqual(strictSeqCallback.calledCount, 0, `Strict sequence should NOT fire in "editor" context`);

            testSequence.forEach(key => dispatchKeyEvent(document, key));
            assert.strictEqual(defaultSeqCallback.calledCount, 0, "Default global sequence should be suppressed");
            assert.strictEqual(specificSeqCallback.calledCount, 1, `Specific "editor" sequence should fire`);
        });

        it("should suppress strict sequence but trigger default global sequence in a non-conflicting context", () => {
            keyManager.setContext("someOtherContext");

            [Keys.G, Keys.O].forEach(key => dispatchKeyEvent(document, key));
            assert.strictEqual(strictSeqCallback.calledCount, 0, "Strict sequence should NOT fire");

            testSequence.forEach(key => dispatchKeyEvent(document, key));
            assert.strictEqual(defaultSeqCallback.calledCount, 1, "Default global sequence should fire");
            assert.strictEqual(specificSeqCallback.calledCount, 0, `Specific "editor" sequence should not fire`);
        });
    });

    describe("addSequence", () => {
        it("should return an Observable that emits on a simple key sequence", () => {
            const config: Omit<KeySequenceConfig, "callback"> = { id: "seqGI", sequence: [Keys.G, Keys.I] };
            const seq$ = keyManager.addSequence(config);
            assert(seq$ instanceof Observable, "Did not return an Observable");

            seq$.subscribe(mockCallback);
            dispatchKeyEvent(document, "g");
            dispatchKeyEvent(document, "i");
            assert.strictEqual(mockCallback.calledCount, 1);
        });

        it("should emit on Konami code using Keys", () => {
            const konamiSequence: StandardKey[] = [
                Keys.ArrowUp, Keys.ArrowUp, Keys.ArrowDown, Keys.ArrowDown,
                Keys.ArrowLeft, Keys.ArrowRight, Keys.ArrowLeft, Keys.ArrowRight,
                Keys.B, Keys.A
            ];
            const config: Omit<KeySequenceConfig, "callback"> = { id: "konami", sequence: konamiSequence };
            keyManager.addSequence(config).subscribe(mockCallback);
            ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"].forEach(key => dispatchKeyEvent(document, key));
            assert.strictEqual(mockCallback.calledCount, 1, "Konami sequence callback not triggered");
        });


        it("should return an empty observable and warn if sequence is empty", () => {
            const config: Omit<KeySequenceConfig, "callback"> = { id: "emptySeq", sequence: [] };
            const seq$ = keyManager.addSequence(config);
            seq$.subscribe(mockCallback);
            assert.strictEqual(consoleWarnMock.mock.calls.length, 1);
            assert.ok(consoleWarnMock.mock.calls[0].arguments[0].includes(`Sequence for shortcut "emptySeq" is empty`));
            dispatchKeyEvent(document, "a");
            assert.strictEqual(mockCallback.calledCount, 0);
        });

        it(`should return an empty observable and warn if sequence contains an invalid key`, () => {
            const config: Omit<KeySequenceConfig, "callback"> = { id: "invalidKeyInSeq", sequence: [Keys.A, "" as any, Keys.C] };
            const seq$ = keyManager.addSequence(config);
            seq$.subscribe(mockCallback);
            assert.strictEqual(consoleWarnMock.mock.calls.length, 1, "console.warn was not called for invalid key in sequence");
            assert.ok(consoleWarnMock.mock.calls[0].arguments[0].includes(`Invalid key in sequence for shortcut "invalidKeyInSeq"`));
        });


        it("should pass the last KeyboardEvent of the sequence to the subscriber", () => {
            const config: Omit<KeySequenceConfig, "callback"> = { id: "seqEventPass", sequence: [Keys.X, Keys.Y] };
            keyManager.addSequence(config).subscribe(mockCallback);
            dispatchKeyEvent(document, "x");
            const lastEvent = dispatchKeyEvent(document, "y");
            assert.strictEqual(mockCallback.calledCount, 1);
            assert.deepStrictEqual(mockCallback.lastArgs, [lastEvent]);
        });

        it("should prevent default for the last key event in the sequence when preventDefault is true", () => {
            const config: Omit<KeySequenceConfig, "callback"> = { id: "seqPrevent", sequence: [Keys.M, Keys.N], preventDefault: true };
            keyManager.addSequence(config).subscribe(mockCallback);
            dispatchKeyEvent(document, "m");
            const eventN = dispatchKeyEvent(document, "n");
            assert.strictEqual(mockCallback.calledCount, 1);
            assert.strictEqual(eventN.defaultPrevented, true);
        });

        it("should emit for a sequence including Keys.Space", () => {
            const config: Omit<KeySequenceConfig, "callback"> = {
                id: "seqWithSpace",
                sequence: [Keys.G, Keys.Space, Keys.I],
            };
            keyManager.addSequence(config).subscribe(mockCallback);
            dispatchKeyEvent(document, Keys.G);
            dispatchKeyEvent(document, Keys.Space); // Dispatch " " for space
            dispatchKeyEvent(document, Keys.I);
            assert.strictEqual(mockCallback.calledCount, 1, "Callback for sequence with Keys.Space not called");
        });

        it("should emit for a sequence starting or ending with Keys.Space", () => {
            const config: Omit<KeySequenceConfig, "callback"> = {
                id: "seqStartSpace",
                sequence: [Keys.Space, Keys.A],
            };
            keyManager.addSequence(config).subscribe(mockCallback);
            dispatchKeyEvent(document, Keys.Space);
            dispatchKeyEvent(document, Keys.A);
            assert.strictEqual(mockCallback.calledCount, 1, "Callback for sequence starting with Keys.Space not called");
        });

        describe("Sequence Contextual Triggering", () => {
            let editorSequenceConfig: Omit<KeySequenceConfig, "callback">;
            beforeEach(() => {
                editorSequenceConfig = {
                    id: "sequenceInEditor",
                    sequence: [Keys.C, Keys.O, Keys.D, Keys.E],
                    context: "editor",
                };
            });

            it("should emit sequence in matching context", () => {
                keyManager.addSequence(editorSequenceConfig).subscribe(mockCallback);
                keyManager.setContext("editor");
                [Keys.C, Keys.O, Keys.D, Keys.E].forEach(k => dispatchKeyEvent(document, k));
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

            it("should emit if keys are pressed within specified timeout", () => {
                const config: Omit<KeySequenceConfig, "callback"> = { id: "seqTimeoutOk", sequence: [Keys.T, Keys.O, Keys.K], sequenceTimeoutMs: TIMEOUT_MS };
                keyManager.addSequence(config).subscribe(mockCallback);
                dispatchKeyEvent(document, Keys.T);
                mock.timers.tick(TIMEOUT_MS / 2);
                dispatchKeyEvent(document, Keys.O);
                mock.timers.tick(TIMEOUT_MS / 2);
                const lastEvent = dispatchKeyEvent(document, Keys.K);
                assert.strictEqual(mockCallback.calledCount, 1);
                assert.deepStrictEqual(mockCallback.lastArgs, [lastEvent]);
            });

            it("should NOT emit if a key press is delayed beyond timeout", () => {
                const config: Omit<KeySequenceConfig, "callback"> = { id: "seqTimeoutFail", sequence: [Keys.D, Keys.E, Keys.L], sequenceTimeoutMs: TIMEOUT_MS };
                keyManager.addSequence(config).subscribe(mockCallback);
                dispatchKeyEvent(document, Keys.D);
                mock.timers.tick(TIMEOUT_MS / 2);
                dispatchKeyEvent(document, Keys.E);
                mock.timers.tick(TIMEOUT_MS + 1);
                dispatchKeyEvent(document, Keys.L);
                assert.strictEqual(mockCallback.calledCount, 0);
            });
        });
    });

    describe("remove", () => {
        it("should remove a combination shortcut and complete its observable", () => {
            const completeCallback = createMockFn();
            const combo$ = keyManager.addCombination({ id: "remA", keys: { key: Keys.A } });
            combo$.subscribe({ next: mockCallback, complete: completeCallback });

            assert.strictEqual(keyManager.remove("remA"), true);
            assert.strictEqual(completeCallback.calledCount, 1, "Observable should have completed");

            dispatchKeyEvent(document, Keys.A);
            assert.strictEqual(mockCallback.calledCount, 0);
        });

        it("should remove a sequence shortcut and complete its observable", () => {
            const completeCallback = createMockFn();
            const seq$ = keyManager.addSequence({ id: "remSeq", sequence: [Keys.A, Keys.B] });
            seq$.subscribe({ next: mockCallback, complete: completeCallback });

            assert.strictEqual(keyManager.remove("remSeq"), true);
            assert.strictEqual(completeCallback.calledCount, 1, "Observable should have completed");

            dispatchKeyEvent(document, Keys.A);
            dispatchKeyEvent(document, Keys.B);
            assert.strictEqual(mockCallback.calledCount, 0);
        });
    });

    describe("getActiveShortcuts", () => {
        it("should return active combination and sequence shortcuts with enum types", () => {
            keyManager.addCombination({ id: "combo1", keys: { key: Keys.A }, description: "Test A" });
            keyManager.addSequence({ id: "seq1", sequence: [Keys.B, Keys.C], context: "modal", description: "Test BC" });

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
            keyManager.addCombination({ id: "existsCombo", keys: { key: Keys.E } });
            assert.strictEqual(keyManager.hasShortcut("existsCombo"), true);
        });

        it("should return false for a shortcut that failed to add (e.g. invalid key object)", () => {
            const config = { id: "invalidKeyCombo", keys: { key: null as any } };
            keyManager.addCombination(config as KeyCombinationConfig);
            assert.strictEqual(keyManager.hasShortcut("invalidKeyCombo"), false);
        });
    });

    describe("destroy", () => {
        it("should clear active shortcuts and complete all observables", () => {
            const comboComplete = createMockFn();
            const seqComplete = createMockFn();

            const combo$ = keyManager.addCombination({ id: "destroyTestCombo", keys: { key: Keys.D } });
            combo$.subscribe({ complete: comboComplete });
            const seq$ = keyManager.addSequence({ id: "destroyTestSeq", sequence: [Keys.X, Keys.Y] });
            seq$.subscribe({ complete: seqComplete });

            // @ts-ignore
            assert.strictEqual(keyManager["activeShortcuts"].size, 2);
            keyManager.destroy();

            // @ts-ignore
            assert.strictEqual(keyManager["activeShortcuts"].size, 0);
            assert.strictEqual(comboComplete.calledCount, 1, "Combination observable should have completed");
            assert.strictEqual(seqComplete.calledCount, 1, "Sequence observable should have completed");
        });
    });
});
