# rx-hotkeys: Advanced Keyboard Shortcut Management with RxJS

rx-hotkeys is a powerful and flexible TypeScript library for managing keyboard shortcuts in web applications. It leverages the full power of RxJS to handle keyboard events, allowing for the registration of simple key combinations (e.g., `Ctrl+S`), complex key sequences (e.g., `g` -> `i` for "go to inbox"), and much more. It supports contexts for enabling/disabling shortcuts based on application state, element-scoped listeners, and provides a type-safe API for defining shortcuts.

## ✨ Features

* **Official React Hooks**: Provides an official wrapper (`HotkeysProvider`, `useHotkeys`, `useScopedHotkeysContext`) for seamless, idiomatic integration with React.
* **Fully Observable API**: Returns an RxJS `Observable` for each shortcut, allowing for powerful stream manipulation like chaining, filtering, debouncing, and merging with other streams.
* **Flexible Shortcut Definitions**: Define shortcuts using simple, intuitive strings (e.g., `"ctrl+s"` or `"g -> i"`) in addition to the classic object-based configuration.
* **Element-Scoped Listeners**: Attach shortcuts to specific DOM elements, so they are only active within a certain component or area, not just on the global `document`.
* **`keyup` Event Support**: Trigger actions on key release (`keyup`) in addition to the default key press (`keydown`).
* **Key Combinations & Sequences**: Supports both simultaneous key presses (`Ctrl+S`) and ordered key sequences (`g` -> `c`).
* **Context Management**: Activate or deactivate groups of shortcuts based on the application's current state (e.g., "editor", "modal", "global").
* **Stack-Based Context Management**: Natively handles nested contexts with an `enter`/`leave` API, perfect for hierarchical UIs like pages, modals, and dropdowns.
* **Temporary Context Override**: Safely override all contexts with a high-priority temporary context, ideal for global application states like "saving" or "loading".
* **Strict Global Shortcuts**: Option to register global shortcuts that *only* fire when no other context is active.
* **Type-Safe Key Definitions**: Uses an exported `Keys` object based on standard `KeyboardEvent.key` values for a superior developer experience and fewer errors.
* **Sequence Timeouts**: Optional timeout between key presses in a sequence to prevent accidental triggers.
* **Debug Mode**: Optional, detailed console logging for easier development and troubleshooting.

## Installation

```bash
npm install rxjs rx-hotkeys
```

## ⚠️ Breaking Changes (v4.0+)

Starting with v4.0, the context management API has been fundamentally redesigned into a more powerful and robust dual-mode system.

* The old `setContext` method (which returned a boolean) has been replaced.
* The library now offers two distinct ways to manage contexts:
    1.  **Context Stack (`enterContext`/`leaveContext`)**: For hierarchical UI states.
    2.  **Context Override (`setContext` returns a `restore` function)**: For temporary, global state overrides.
* `getContext` method rename to `getActiveContext`.

Please review the "Context Management" section below for details.

## Basic Usage

First, ensure you have the `Hotkeys` class and its helper `Keys` object imported:

```typescript
import { Hotkeys, Keys } from "rx-hotkeys";
```

### 1. Initialize Hotkeys

Create an instance of the `Hotkeys` class. You can optionally provide an initial context and enable debug mode.

```typescript
const keyManager = new Hotkeys(); // No initial context, debug mode off

// Or with an initial context and debug mode enabled:
// const keyManager = new Hotkeys("editor", true);
```

### 2. Add a Key Combination

Register a shortcut for a key combination, like `Ctrl+S`, by subscribing to the returned Observable.

```typescript
const save$ = keyManager.addCombination({
  id: "saveFile", // Unique ID for this shortcut
  keys: { key: Keys.S, ctrlKey: true }, // Use Keys.S for "s" key
  preventDefault: true, // Prevent browser's default save action
  description: "Save the current file."
});

const saveSubscription = save$.subscribe((event) => {
  console.log("Ctrl+S pressed: Save file action triggered!", event);
});
```

### 3. Define Shortcuts with Strings (New)

You can also use more concise strings to define shortcuts.

```typescript
// Combination
const open$ = keyManager.addCombination({ id: "openFile", keys: "ctrl+o" });
open$.subscribe(() => console.log("Opening file..."));

// Sequence
const command$ = keyManager.addSequence({ id: "showCommandPalette", sequence: "cmd+k" }); // Note: "cmd+k" is a combination, not a sequence. Let's fix this example.
const command$ = keyManager.addSequence({ id: "goToInbox", sequence: "g -> i" });
command$.subscribe(() => console.log("Navigating to Inbox..."));
```

### 4. Add a Key Sequence

Register a shortcut for a sequence of keys, like the Konami code.

```typescript
const konami$ = keyManager.addSequence({
  id: "konamiCode",
  sequence: "up -> up -> down -> down -> left -> right -> left -> right -> b -> a",
  sequenceTimeoutMs: 3000, // User has 3 seconds between each key press
  description: "Unlock special features."
});

konami$.subscribe((event) => { // The last KeyboardEvent of the sequence is emitted
  console.log("Konami code entered!");
});
```

### 5. Advanced Usage: Scopes and `keyup`

You can scope a shortcut to a specific element and trigger it on `keyup`.

```typescript
const myInputField = document.getElementById("my-input");

const submit$ = keyManager.addCombination({
    id: "submitOnEnter",
    keys: Keys.Enter,
    target: myInputField, // Only active on this element
    event: "keyup", // Trigger on key release
    preventDefault: true
});

submit$.subscribe(() => console.log("Form submitted on Enter keyup!"));
```

### 6. Context Management

You now have two powerful tools for managing contexts.

#### A) Context Stack (`enterContext` / `leaveContext`)

Use this for nested UI scopes that follow a clear hierarchy.

```typescript
// A shortcut with context: "editor" will NOT be active here.
console.log(keyManager.getActiveContext()); // null

// Activate the "editor" context
keyManager.enterContext("editor");
// Now, pressing Ctrl+S will trigger the "saveFile" shortcut.
console.log(keyManager.getActiveContext()); // 'editor'

// Imagine opening a dropdown menu inside the editor
keyManager.enterContext("dropdown-menu");
console.log(keyManager.getActiveContext()); // 'dropdown-menu'

// When the dropdown closes, leave its context
keyManager.leaveContext();
console.log(keyManager.getActiveContext()); // 'editor' (restored automatically)
```

#### B) Context Override (`setContext` and `restore`)

Use this for temporary, high-priority states that should override everything else.

```typescript
async function performSave() {
  // Set a temporary "saving" context that overrides the stack.
  const restore = keyManager.setContext('saving');

  // Any shortcuts with context: 'saving' are now active.
  // All other shortcuts (editor, etc.) are inactive.
  console.log(keyManager.getActiveContext()); // 'saving'

  try {
    await someAsyncSaveOperation();
  } finally {
    // No matter what happens, call restore() to clear the override
    // and return control to the context stack.
    restore();
  }

  console.log(keyManager.getActiveContext()); // e.g., 'editor' (restored from the stack)
}
```

### 7. Clean Up

When the Hotkeys instance is no longer needed (e.g., component unmount), call `destroy()` to clean up all internal streams and listeners, preventing memory leaks. This will also `complete` all active shortcut Observables.

```typescript
// In a component lifecycle cleanup method or similar:
keyManager.destroy();
```

---

## Usage with React

The library provides a dedicated React wrapper for the best developer experience.

### Step 1: Wrap Your App with `HotkeysProvider`

First, import `HotkeysProvider` and wrap your root application component with it. This creates a single, shared instance of the hotkeys manager for your entire app.

```jsx
// In your main App.js or index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HotkeysProvider } from 'rx-hotkeys/react';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <HotkeysProvider debugMode={true}>
      <App />
    </HotkeysProvider>
  </React.StrictMode>
);
```

### Step 2: Use the `useHotkeys` Hook in Your Components

Now, you can use the `useHotkeys` and `useSequence` hooks anywhere in your component tree. The hook automatically handles registration, cleanup, and stale closures. You no longer need to provide a dependency array for your callback.

```jsx
// src/components/Counter.jsx
import React, { useState } from 'react';
import { useHotkeys, useSequence } from 'rx-hotkeys/react';

export function Counter() {
  const [count, setCount] = useState(0);

  // The callback can safely use the latest component state (like `count`)
  // without you needing to worry about stale closures or dependency arrays.
  const handleIncrement = () => {
    console.log(`Incrementing from ${count}...`);
    setCount(count + 1);
  };

  // Register '+' key to increment.
  useHotkeys('+', handleIncrement);

  // Register 'c' key to increment, with options.
  useHotkeys('c', handleIncrement, { preventDefault: true });

  // Register a sequence to reset the counter.
  useSequence('r -> e -> s -> e -> t', () => {
    console.log('Resetting counter!');
    setCount(0);
  });

  return (
    <div>
      <h2>Count: {count}</h2>
      <p>Press '+' or 'c' to increment. Type 'reset' to reset.</p>
    </div>
  );
}
```

### Step 3: Manage Context with `useScopedHotkeysContext`

This hook allows a component (like a modal) to activate a specific context only while it is mounted.

```jsx
// src/components/MyModal.jsx
import { useHotkeys, useScopedHotkeysContext } from 'rx-hotkeys/react';

export function MyModal({ onClose }) {
  // This activates the 'modal' context for all children of this component.
  // When MyModal unmounts, this context is automatically removed from the stack.
  useScopedHotkeysContext('modal');

  // This hotkey will only be active when the 'modal' context is active.
  useHotkeys('escape', onClose, { context: 'modal' });

  return (
    <div className="modal">
      <p>This is a modal. Press ESC to close.</p>
      {/* ... other modal content ... */}
    </div>
  );
}
```

---

## API Reference

### `Keys` Object & `StandardKey` Type

* `Keys`: An exported constant object containing standard `KeyboardEvent.key` string values (e.g., `Keys.Enter`, `Keys.ArrowUp`, `Keys.A`). It's highly recommended to use these for type safety and to avoid typos.
* `StandardKey`: A TypeScript type representing any valid key string from the `Keys` object.

### `Hotkeys` Class (Core)

`constructor(initialContext?: string | null, debugMode?: boolean)`

Creates a new Hotkeys instance.

`addCombination(config: KeyCombinationConfig): Observable<KeyboardEvent>`

Registers a key combination shortcut.
* `config`: The `KeyCombinationConfig` object.
* Returns an `Observable<KeyboardEvent>` that emits when the shortcut is triggered.

`addSequence(config: KeySequenceConfig): Observable<KeyboardEvent>`

Registers a key sequence shortcut.
* `config`: The `KeySequenceConfig` object.
* Returns an `Observable<KeyboardEvent>` that emits the final `KeyboardEvent` when the sequence is completed.

`enterContext(contextName: string | null): void`

Pushes a context onto the **context stack**. It becomes active if no override is set.

`leaveContext(): string | null | undefined`

Pops a context from the **context stack**, returning the context that was left.

`setContext(contextName: string | null): () => void`

Sets a temporary **override context**. Returns a `restore` function to clear the override.

`getActiveContext(): string | null`

Returns the current active context (checks for an override first, then the stack top).

`onContextChange$: Observable<string | null>`

A public `Observable` property that emits the active context whenever it changes.

`remove(id: string): boolean`

Removes a registered shortcut by its ID. This will cause the corresponding Observable to complete.
* Returns `true` if found and removed, `false` otherwise.

`hasShortcut(id: string): boolean`

Checks if a shortcut with the given ID is registered.
* Returns `true` if it exists, `false` otherwise.

`getActiveShortcuts(): { id: string; description?: string; context?: string | null; type: "combination" | "sequence" }[]`

Returns an array of all currently registered shortcuts with their basic information.

`setDebugMode(enable: boolean): void`

Enables or disables console logging for debug purposes.

`destroy(): void`

Cleans up all subscriptions and resources. Essential to call to prevent memory leaks.

### React Hooks (`rx-hotkeys/react`)

`HotkeysProvider({ children, initialContext?, debugMode? })`

A React component that provides the Hotkeys instance to its children.

`useHotkeys(keys, callback, options?)`

A React hook to register a key combination.
* `keys: string | string[]`: The shortcut definition (e.g., `'ctrl+s'`).
* `callback: (event: KeyboardEvent) => void`: The function to execute.
* `options?: HotkeyHookOptions`: Optional config for `preventDefault`, `context`, `target`, etc.

`useSequence(sequence, callback, options?)`

A React hook to register a key sequence.
* `sequence: string | string[]`: The sequence definition (e.g., `'g -> i'`).
* `callback: (event: KeyboardEvent) => void`: The function to execute.
* `options?: SequenceHookOptions`: Optional config for `preventDefault`, `context`, etc.

`useScopedHotkeysContext(context, enabled: boolean = true)`

A React hook to apply a specific context for the lifetime of the component.

`useHotkeysManager(): Hotkeys`
A hook to get direct access to the `Hotkeys` manager instance.

### Configuration Interfaces

#### `KeyCombinationConfig`

* `id: string` (required): Unique identifier for the shortcut.
* `keys: string | KeyCombinationTrigger | KeyCombinationTrigger[]` (required): Defines the key(s). Can be a string (`"ctrl+s"`), a shorthand `StandardKey` (`Keys.Escape`), an object (`{ key: Keys.S, ctrlKey: true }`), or an array of these.
* `context?: string | null`: Specifies the context in which this shortcut is active. If `null` or `undefined`, it's a global shortcut.
* `preventDefault?: boolean`: If `true`, `event.preventDefault()` will be called when the shortcut triggers. Defaults to `false`.
* `description?: string`: An optional description for the shortcut (e.g., for help menus).
* `strict?: boolean` (optional): If `true` and the shortcut has no `context`, it will only fire when no other context is active. Defaults to `false`.
* `target?: HTMLElement` (optional): The DOM element to attach the listener to. Defaults to `document`.
* `event?: "keydown" | "keyup"` (optional): The keyboard event to listen for. Defaults to `"keydown"`.
* `callback?: (event: KeyboardEvent) => void` (**@deprecated**): This property is deprecated. Subscribe to the `Observable` returned by `addCombination` instead.

#### `KeySequenceConfig`

* `id: string` (required): Unique identifier.
* `sequence: string | StandardKey[]` (required): An array of `StandardKey` values or a string representation (e.g., `"g -> i"`).
* `context?: string | null`: Context for activation.
* `preventDefault?: boolean`: If `true`, `event.preventDefault()` is called for the last event in the sequence. Defaults to `false`.
* `description?: string`: Optional description.
* `sequenceTimeoutMs?: number`: Optional. Maximum time (in milliseconds) allowed between consecutive key presses in the sequence.
* `strict?: boolean` (optional): If `true` and the shortcut has no `context`, it will only fire when no other context is active.
* `target?: HTMLElement` (optional): The DOM element to attach the listener to. Defaults to `document`.
* `event?: "keydown" | "keyup"` (optional): The keyboard event to listen for. Defaults to `"keydown"`.
* `callback?: (event: KeyboardEvent) => void` (**@deprecated**): This property is deprecated. Subscribe to the `Observable` returned by `addSequence` instead.

## Key Matching & Normalization

* **Case Insensitivity**: The library automatically handles case for you. `keys: "a"` will match both "a" and "A" presses. `keys: "escape"` will match an event where `event.key` is `"Escape"`.
* **Aliases**: Common aliases are supported in string definitions, such as `cmd` for `Meta`, `option` for `Alt`, and `esc` for `Escape`.
* **Special Keys**: For full type-safety, it is recommended to use the exported `Keys` object (e.g., `Keys.Enter`, `Keys.ArrowUp`).

---

## Contributing

Contributions are welcome! Please feel free to submit issues, fork the repository, and create pull requests.

## Development Setup

1.  Clone the repository.
2.  Install dependencies: `npm install`.
3.  Run tests: `npm test`.

## License

This project is licensed under the MIT License.
