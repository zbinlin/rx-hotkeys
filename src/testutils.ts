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
 * Dispatches a KeyboardEvent to a specified target element (or document).
 * @param target - The EventTarget to dispatch the event on (e.g., document or an HTMLElement).
 * @param key - The key value, e.g., "a", "Escape", "ArrowUp".
 * @param eventType - The type of event to dispatch, 'keydown' or 'keyup'.
 * @param modifiers - Optional modifier keys for the event.
 * @returns The dispatched KeyboardEvent.
 */
export function dispatchKeyEvent(
    target: EventTarget,
    key: string,
    eventType: 'keydown' | 'keyup' = 'keydown',
    modifiers: Partial<KeyboardEventInit> = {}
): KeyboardEvent {
    const event = new KeyboardEvent(eventType, {
        key,
        bubbles: true,
        cancelable: true,
        ...modifiers,
    });
    target.dispatchEvent(event);
    return event;
}
