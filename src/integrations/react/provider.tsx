import { createContext, useState, useCallback, useContext, useEffect } from "react";
import {
    type StandardKey,
    Keys,
    Hotkeys,
} from "../../core/index.js";

export { Keys, type StandardKey };

export type HotkeysContextType = string | null;

// Context for the Hotkeys manager instance
const HotkeysManagerContext = createContext<Hotkeys | null>(null);

// Context for the context stack and its setter
type HotkeysStackContextValue = [HotkeysContextType[], React.Dispatch<React.SetStateAction<HotkeysContextType[]>>];
const HotkeysContextStackContext = createContext<HotkeysStackContextValue | undefined>(undefined);

export interface HotkeysProviderProps {
    children: React.ReactNode;
    initialContext?: HotkeysContextType;
    debugMode?: boolean;
}

/**
 * Provides the Hotkeys manager instance and context stack management to its children.
 * It initializes and destroys the Hotkeys manager.
 * @param {HotkeysProviderProps} props - The provider's props.
 * @param {ReactNode} props.children - The child components.
 * @param {string | null} [props.initialContext=null] - The initial hotkey context for the manager.
 * If this prop changes after the initial mount, the Hotkeys manager will be re-initialized.
 * @param {boolean} [props.debugMode=false] - Whether to enable debug logging for the Hotkeys manager
 * itself and for the provider's initialization.
 */
export function HotkeysProvider({ children, initialContext = null, debugMode = false }: HotkeysProviderProps) {
    const [manager, setManager] = useState<Hotkeys | null>(null);
    // Initialize stack with initialContext. If initialContext is null, stack starts with [null] for global.
    const [contextStack, setContextStack] = useState<HotkeysContextType[]>(() => [initialContext]);

    useEffect(() => {
        const hotkeysManagerInstance = new Hotkeys(initialContext, debugMode);
        setManager(hotkeysManagerInstance);

        if (debugMode) {
            console.log("[HotkeysProvider] Initialized. Initial Context on Manager:", hotkeysManagerInstance.getContext(), "Initial Stack:", [...contextStack]);
        }

        return () => {
            hotkeysManagerInstance.destroy();
        };
    // initialContext is used to set the initial stack state, debugMode for manager.
    // contextStack itself should not be a dep here to avoid re-initializing manager on stack changes.
    // If initialContext or debugMode props change, the manager will be re-initialized.
    }, [initialContext, debugMode]);

    return (
        <HotkeysManagerContext.Provider value={manager}>
            <HotkeysContextStackContext.Provider value={[contextStack, setContextStack]}>
                {children}
            </HotkeysContextStackContext.Provider>
        </HotkeysManagerContext.Provider>
    );
}

export function useHotkeysManager(): Hotkeys | null {
    return useContext(HotkeysManagerContext);
}

export function useHotkeysContextStack(): HotkeysStackContextValue {
    const context = useContext(HotkeysContextStackContext);
    if (context === undefined) {
        throw new Error("useHotkeysContextStack must be used within a HotkeysProvider");
    }
    return context;
}

export function useHotkeysContextAPI() {
    const manager = useHotkeysManager();
    const [contextStack, setContextStack] = useHotkeysContextStack();
    // internalCurrentContext is kept in sync with the manager's actual context via onContextChange$
    const [internalCurrentContext, setInternalCurrentContext] = useState<HotkeysContextType>(() => manager?.getContext() ?? null);

    const setContext = useCallback((contextNameOrUndefined: HotkeysContextType | undefined) => {
        // This function now only updates the React state (contextStack).
        // The side effect of updating the manager is handled by the useEffect below.
        if (contextNameOrUndefined !== undefined) { // Pushing a new context
            // console.log(`[useHotkeysContextAPI] Queuing push context: ${contextNameOrUndefined}`);
            setContextStack(prevStack => [...prevStack, contextNameOrUndefined]);
        } else { // Popping context (undefined means restore previous)
            // console.log(`[useHotkeysContextAPI] Queuing pop context.`);
            setContextStack(prevStack => {
                if (prevStack.length > 1) { // Always keep at least one context (the initial/global one)
                    return prevStack.slice(0, -1);
                }
                return prevStack; // Don't pop if only one context is left
            });
        }
    }, [setContextStack]); // manager is not needed here as side effect is separate

    // Effect to synchronize the Hotkeys manager with the top of the contextStack
    useEffect(() => {
        if (manager) {
            const topOfStack = contextStack.length > 0 ? contextStack[contextStack.length - 1] : null;
            if (manager.getContext() !== topOfStack) {
                // console.log(`[useHotkeysContextAPI EFFECT] Syncing manager to top of stack: ${topOfStack}. Current stack:`, [...contextStack]);
                manager.setContext(topOfStack);
            }
        }
    }, [manager, contextStack]); // Runs when manager is available or stack changes

    // Subscribe to onContextChange$ from the manager
    useEffect(() => {
        if (manager) {
            // console.log(`[useHotkeysContextAPI] Subscribing to onContextChange$. Initial manager context: ${currentManagerContext}`);
            setInternalCurrentContext(manager.getContext());

            const subscription = manager.onContextChange$.subscribe(newContext => {
                // console.log(`[useHotkeysContextAPI] Context changed via observable to: ${newContext}`);
                setInternalCurrentContext(newContext);
                // Potentially sync stack if observable changes context not managed by stack?
                // For now, assume stack is the source of truth for manager.setContext.
            });
            return () => {
                // console.log(`[useHotkeysContextAPI] Unsubscribing from onContextChange$.`);
                subscription.unsubscribe();
            };
        }
    }, [manager]);

    return {
        currentContext: internalCurrentContext,
        setContext,
    };
}

/**
 * A hook to apply a specific hotkey context for the lifecycle of the component using it.
 * When the component mounts or `scopedContext` changes to a defined value (string or null),
 * it pushes the `scopedContext` onto the context stack.
 * When the component unmounts or `scopedContext` changes, the previously applied context is popped.
 *
 * @param {HotkeysContextType | undefined} scopedContext - The context to apply for this scope.
 * - Pass a string to set a specific context.
 * - Pass `null` to set the context to global/base (pushes `null` onto the stack).
 * - If `scopedContext` becomes `undefined` (e.g., due to conditional logic), the hook
 * will ensure any previously pushed context by this instance is popped, then becomes a no-op
 * for context setting until `scopedContext` is defined again.
 * @returns {HotkeysContextType | undefined} The current actual hotkey context active in the manager.
 */
export function useScopedHotkeysContext(scopedContext: HotkeysContextType | undefined): HotkeysContextType | undefined {
    const { setContext, currentContext } = useHotkeysContextAPI();

    useEffect(() => {
        // Only act if scopedContext is explicitly provided (not undefined initially if that's the intent)
        // If scopedContext is null, it means "set to global/base".
        // If scopedContext is a string, it means "set to this specific context".
        // If scopedContext becomes undefined, the hook effectively becomes a no-op for setting context.
        if (scopedContext !== undefined) {
            // console.log(`[useScopedHotkeysContext] Applying scope: ${scopedContext}`);
            setContext(scopedContext); // Push onto stack (or set if it's null)

            return () => {
                // console.log(`[useScopedHotkeysContext] Removing scope: ${scopedContext}, restoring previous.`);
                setContext(undefined); // Pop from stack
            };
        }
    // setContext from useHotkeysContextAPI should now be stable.
    }, [scopedContext, setContext]);

    return currentContext;
}
