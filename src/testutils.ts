export function createMockFn() {
    const fn = (...args: any[]) => {
        fn.calledCount++;
        fn.calls.push(args);
        fn.lastArgs = args;
    };
    fn.calledCount = 0;
    fn.calls = [] as any[];
    fn.lastArgs = [] as any[];
    fn.mockClear = () => {
        fn.calledCount = 0;
        fn.calls = [];
        fn.lastArgs = [];
    };
    return fn;
}

/**
 * Dispatches a KeyboardEvent to the document (JSDOM).
 * @param key - The key value, e.g., "a", "Escape", "ArrowUp"
 * @param modifiers - Optional modifier keys
 */
export function dispatchKeyEvent(
    key: string,
    modifiers: Partial<KeyboardEventInit> = {}
): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...modifiers,
    });
    document.dispatchEvent(event);
    return event;
}
