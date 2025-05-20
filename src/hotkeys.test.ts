import { describe, it, before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
// Importing main library components
import { Hotkeys, type KeyCombinationConfig, type KeySequenceConfig } from "./hotkeys.js";
// Importing Keys and StandardKey from the separate keys.js file
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
    if (typeof global.performance === 'undefined') {
        // @ts-ignore
        global.performance = {};
    }
    // @ts-ignore
    originalPerformanceNow = global.performance.now;
    // @ts-ignore
    if (typeof global.performance.now !== 'function') {
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

    describe("Initialization and Basic Context", () => {
        it("should initialize without errors", () => {
            assert(keyManager instanceof Hotkeys);
        });

        it("should initialize with a null context by default", () => {
            assert.strictEqual(keyManager.getContext(), null);
        });

        it("should initialize with a given initial context", () => {
            const manager = new Hotkeys("editor");
            assert.strictEqual(manager.getContext(), "editor");
            manager.destroy();
        });

        it("should set and get context", () => {
            keyManager.setContext("modal");
            assert.strictEqual(keyManager.getContext(), "modal");
            keyManager.setContext(null);
            assert.strictEqual(keyManager.getContext(), null);
        });

        it("should toggle debug mode and log appropriately", () => {
            const consoleLogMock = mock.method(console, "log");
            keyManager.setDebugMode(true);
            keyManager.setContext("debug_test");
            assert.ok(consoleLogMock.mock.calls.some(call => call.arguments[0].includes('Context changed to "debug_test"')));
            consoleLogMock.mock.resetCalls();
            keyManager.setDebugMode(false);
            keyManager.setContext("no_debug_test");
            assert.ok(!consoleLogMock.mock.calls.some(call => call.arguments[0].includes('Context changed to "no_debug_test"')));
            consoleLogMock.mock.restore();
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

        it("should return undefined and warn if keys.key is null or undefined (runtime check)", () => {
            // This test checks runtime robustness if `any` is used to bypass StandardKey
            const config: KeyCombinationConfig = { id: "nullKey", keys: { key: null as any }, callback: mockCallback };
            const result = keyManager.addCombination(config);
            assert.strictEqual(result, undefined, "Should return undefined for null key");
            assert.strictEqual(consoleWarnMock.mock.calls.length, 1);
            assert.ok(consoleWarnMock.mock.calls[0].arguments[0].includes('Invalid \'keys.key\' for combination shortcut "nullKey"'));
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

        it("should trigger for special keys like Escape", () => {
            const config: KeyCombinationConfig = { id: "escapeKey", keys: { key: Keys.Escape }, callback: mockCallback };
            keyManager.addCombination(config);
            dispatchKeyEvent("Escape"); // Event key matches Keys.Escape
            assert.strictEqual(mockCallback.calledCount, 1);
        });


        it("should handle preventDefault correctly", () => {
            const config: KeyCombinationConfig = { id: "preventA", keys: { key: Keys.A }, callback: mockCallback, preventDefault: true };
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
            assert.ok(consoleErrorMock.mock.calls[0].arguments[0].includes('Error in user callback for combination shortcut "errorCombo"'));

            dispatchKeyEvent("w");
            assert.strictEqual(workingCallback.calledCount, 1);
        });
    });

    describe("addSequence", () => {
        it("should trigger callback for a simple key sequence", () => {
            const config: KeySequenceConfig = { id: "seqGI", sequence: [Keys.G, Keys.I], callback: mockCallback };
            const result = keyManager.addSequence(config);
            assert.strictEqual(result, "seqGI");
            dispatchKeyEvent("g"); // Dispatch 'g' (lowercase)
            dispatchKeyEvent("i"); // Dispatch 'i' (lowercase)
            assert.strictEqual(mockCallback.calledCount, 1);
        });

        it("should trigger callback for Konami code using Keys", () => {
            const konamiSequence: StandardKey[] = [
                Keys.ArrowUp, Keys.ArrowUp, Keys.ArrowDown, Keys.ArrowDown,
                Keys.ArrowLeft, Keys.ArrowRight, Keys.ArrowLeft, Keys.ArrowRight,
                Keys.B, Keys.A // Using 'B' and 'A' from Keys
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
            assert.ok(consoleErrorMock.mock.calls[0].arguments[0].includes('Error in user callback for sequence shortcut "errorSeq"'));
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
        it("should return active combination and sequence shortcuts", () => {
            keyManager.addCombination({ id: "combo1", keys: { key: Keys.A }, callback: createMockFn(), description: "Test A" });
            keyManager.addSequence({ id: "seq1", sequence: [Keys.B, Keys.C], callback: createMockFn(), context: "modal", description: "Test BC" });

            const active = keyManager.getActiveShortcuts();
            assert.strictEqual(active.length, 2);
            const combo = active.find(s => s.id === "combo1");
            assert.ok(combo);
            assert.strictEqual(combo.type, "combination");
            const seq = active.find(s => s.id === "seq1");
            assert.ok(seq);
            assert.strictEqual(seq.type, "sequence");
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
            assert.strictEqual(keyManager['activeShortcuts'].size, 2);
            keyManager.destroy();
            // @ts-ignore
            assert.strictEqual(keyManager['activeShortcuts'].size, 0);
            dispatchKeyEvent(Keys.D);
            dispatchKeyEvent(Keys.X); dispatchKeyEvent(Keys.Y);
            assert.strictEqual(mockCallback.calledCount, 0);
        });
    });
});
