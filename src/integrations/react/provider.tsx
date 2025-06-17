import { createContext, useState, useContext, useEffect } from "react";
import {
    type StandardKey,
    Keys,
    Hotkeys,
} from "../../core/index.js";

export { Keys, type StandardKey };

export type HotkeysContextType = string | null;

// Context for the Hotkeys manager instance
const HotkeysManagerContext = createContext<Hotkeys | null>(null);

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
    // 1. Initialize manager state as `null`. It will remain `null` during server-side rendering.
    const [manager, setManager] = useState<Hotkeys | null>(null);

    // 2. Use `useEffect` to create the Hotkeys instance only on the client-side.
    useEffect(() => {
        // This effect runs only after the component has mounted in the browser.
        const hotkeysManagerInstance = new Hotkeys(initialContext, debugMode);
        setManager(hotkeysManagerInstance);

        if (debugMode) {
            console.log("[HotkeysProvider] Hotkeys manager instance created. Initial Context:", hotkeysManagerInstance.getActiveContext());
        }

        // 3. The cleanup function will be called when the provider unmounts.
        return () => {
            if (debugMode) {
                console.log("[HotkeysProvider] Destroying hotkeys manager instance.");
            }
            hotkeysManagerInstance.destroy();
        };
    // The dependency array ensures this effect only re-runs if critical props change,
    // which would necessitate re-creating the manager instance.
    }, [initialContext, debugMode]);

    return (
        <HotkeysManagerContext.Provider value={manager}>
            {children}
        </HotkeysManagerContext.Provider>
    );
}

/**
 * Hook to get the Hotkeys manager instance.
 * Returns `null` during server-side rendering and initial client render.
 */
export function useHotkeysManager(): Hotkeys | null {
    return useContext(HotkeysManagerContext);
}

/**
 * A hook to apply a specific hotkey context for the lifecycle of the component using it.
 * When the component mounts, it pushes the `scopedContext` onto the manager's context stack.
 * When the component unmounts, the context is popped from the stack.
 *
 * @param {HotkeysContextType} scopedContext - The context to apply for this scope.
 * - Pass a string to set a specific context (e.g., 'modal').
 * - Pass `null` to set the context to global/base.
 * @param {boolean} [enabled=true] - Optional. If set to false, the hook will not apply or remove the context.
 */
export function useScopedHotkeysContext(scopedContext: HotkeysContextType, enabled: boolean = true): HotkeysContextType | undefined {
    const manager = useHotkeysManager();

    useEffect(() => {
        // Guard against running when manager is not yet created or disabled.
        if (!manager || !enabled) {
            return;
        }

        manager.enterContext(scopedContext);
        return () => {
            // Check for manager existence in cleanup as well, just in case.
            if(manager) {
                manager.leaveContext();
            }
        };
    }, [manager, scopedContext, enabled]);

    // This part of the hook could also return the currently active context
    // by subscribing to manager.activeContext$ if needed.
    const [activeContext, setActiveContext] = useState(() => {
        return manager?.getActiveContext();
    });
    useEffect(() => {
        if (!manager) return;
        const sub = manager.onContextChange$.subscribe(setActiveContext);
        return () => sub.unsubscribe();
    }, [manager]);

    return activeContext;
}
