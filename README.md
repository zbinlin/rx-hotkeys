# rx-hotkeys: Advanced Keyboard Shortcut Management using rxjs

rx-hotkeys is a powerful and flexible TypeScript library for managing keyboard shortcuts in web applications. It leverages RxJS to handle keyboard events, allowing for the registration of simple key combinations (e.g., `Ctrl+S`) and complex key sequences (e.g., `g` -> `i` for "go to inbox"). It supports contexts for enabling/disabling shortcuts based on application state, and provides a type-safe way to define keys using standard `KeyboardEvent.key` values.

## Features

* **Key Combinations:** Define shortcuts that trigger when a specific key and modifier keys (Ctrl, Alt, Shift, Meta) are pressed simultaneously.
* **Key Sequences:** Define shortcuts that trigger when a series of keys are pressed in a specific order.
* **Sequence Timeouts:** Optional timeout between key presses in a sequence to prevent accidental triggers or indefinite waiting.
* **Context Management:** Activate or deactivate groups of shortcuts based on the application's current state (e.g., "editor", "modal", "global").
* **Type-Safe Key Definitions:** Uses an exported `Keys` object based on standard `KeyboardEvent.key` values for improved developer experience and fewer errors.
* **RxJS Powered:** Built on RxJS for robust and efficient event handling.
* **Prevent Default:** Option to prevent the default browser action for a triggered shortcut.
* **Debug Mode:** Optional logging for easier development and troubleshooting.
* **Clean API:** Simple and intuitive methods for adding, removing, and managing shortcuts.

## Installation

```bash
npm install rxjs rx-hotkeys
```


## Basic Usage

First, ensure you have the `rx-hotkeys` library and its helper Keys imported:

```typescript
import { Hotkeys, Keys, KeyCombinationConfig, KeySequenceConfig } from 'rx-hotkeys';
```

1. Initialize Hotkeys

Create an instance of the `Hotkeys` class. You can optionally provide an initial context and enable debug mode.

```typescript
const keyManager = new Hotkeys(); // No initial context, debug mode off

// With an initial context and debug mode enabled:
// const keyManager = new Hotkeys('editor', true);
```

2. Add a Key Combination

Register a shortcut for a key combination, like Ctrl+S.

```typescript
const saveConfig: KeyCombinationConfig = {
  id: "saveFile", // Unique ID for this shortcut
  keys: { key: Keys.S, ctrlKey: true }, // Use Keys.S for 's' key
  callback: () => {
    console.log("Ctrl+S pressed: Save file action triggered!");
  },
  preventDefault: true, // Prevent browser's default save action
  description: "Save the current file."
};

keyManager.addCombination(saveConfig);
```

3. Add a Key SequenceRegister a shortcut for a sequence of keys, like the Konami code.

```typescript
const konamiConfig: KeySequenceConfig = {
  id: "konamiCode",
  sequence: [
    Keys.ArrowUp, Keys.ArrowUp,
    Keys.ArrowDown, Keys.ArrowDown,
    Keys.ArrowLeft, Keys.ArrowRight,
    Keys.ArrowLeft, Keys.ArrowRight,
    Keys.B, Keys.A // 'B' and 'A' from Keys
  ],
  callback: (event) => { // The last KeyboardEvent of the sequence is passed
    console.log("Konami code entered!");
    // event.preventDefault(); // Can also be done here if not set in config
  },
  sequenceTimeoutMs: 3000, // User has 3 seconds between each key press
  description: "Unlock special features."
};

keyManager.addSequence(konamiConfig);
```

4. Manage ContextsControl which shortcuts are active by setting the context.

```typescript
// Assuming some shortcuts are configured with context: "editor"
keyManager.setContext("editor"); // Activates "editor" shortcuts and global shortcuts

// To activate only global shortcuts (those with no context or context: null)
keyManager.setContext(null);
```

5. Clean Up

When the Hotkeys instance is no longer needed (e.g., component unmount), call `destroy()` to clean up subscriptions and prevent memory leaks.

```typescript
// In a component lifecycle cleanup method or similar:
keyManager.destroy();
```


## API Reference

### `Keys` Object & `StandardKey` Type

* `Keys`: An exported constant object containing standard KeyboardEvent.key string values (e.g., Keys.Enter, Keys.ArrowUp, Keys.A). It's highly recommended to use these when defining key in `KeyCombinationConfig` or keys in the sequence array of `KeySequenceConfig`.
* `StandardKey`: A TypeScript type representing any valid key string from the Keys object.

### `Hotkeys` Class

`constructor(initialContext?: string | null, debugMode?: boolean)`

Creates a new Hotkeys instance.

`addCombination(config: KeyCombinationConfig): string | undefined`

Registers a key combination shortcut.

* `config`: The KeyCombinationConfig object.
* Returns the shortcut ID if successful, undefined otherwise.

`addSequence(config: KeySequenceConfig): string | undefined`

Registers a key sequence shortcut.

* `config`: The KeySequenceConfig object.
* Returns the shortcut ID if successful, undefined otherwise.

`setContext(contextName: string | null): boolean`

Sets the active context. Only shortcuts matching this context or global shortcuts (no context) will trigger.

`getContext(): string | null`

Returns the current active context name, or null.

`remove(id: string): boolean`

Removes a registered shortcut by its ID.

* Returns true if found and removed, false otherwise.

`hasShortcut(id: string): boolean`

Checks if a shortcut with the given ID is registered.

* Returns true if it exists, false otherwise.

`getActiveShortcuts(): { id: string; description?: string; context?: string | null; type: "combination" | "sequence" }[]`

Returns an array of all currently registered shortcuts with their basic information.

`setDebugMode(enable: boolean): void`

Enables or disables console logging for debug purposes.

`destroy(): void`

Cleans up all subscriptions and resources. Essential to call to prevent memory leaks.

### Configuration Interfaces

`KeyCombinationConfig`

* `id: string` (required): Unique identifier for the shortcut.
* `keys: { key: StandardKey; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean; } | StandardKey | Array<{ key: StandardKey; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean; } | StandardKey>` (required): Defines the main key (from Keys) and optional modifier keys.
* `callback: (event: KeyboardEvent) => void` (required): Function to execute when the shortcut is triggered. The triggering `KeyboardEvent` is passed as an argument.
* `context?: string | null`: Specifies the context in which this shortcut is active. If `null` or `undefined`, it's a global shortcut.
* `preventDefault?: boolean`: If true, `event.preventDefault()` will be called when the shortcut triggers. Defaults to `false`.
* `description?: string`: An optional description for the shortcut (e.g., for help menus).

`KeySequenceConfig`

* `id: string` (required): Unique identifier.
* `sequence: StandardKey[]` (required): An array of `StandardKey` values (from `Keys`) representing the key sequence.
* `callback: (event: KeyboardEvent) => void` (required): Function to execute. The last `KeyboardEvent` of the sequence is passed.
* `context?: string | null`: Context for activation.
* `preventDefault?: boolean`: If true, `event.preventDefault()` is called for the last event in the sequence. Defaults to `false`.
* `description?: string`: Optional description.
* `sequenceTimeoutMs?: number`: Optional. Maximum time (in milliseconds) allowed between consecutive key presses in the sequence. If exceeded, the sequence resets. If `0` or `undefined`, no inter-key timeout is applied (uses simpler buffer-based matching).


## Key Matching Logic

* Single Character Keys (e.g., `Keys.A`, `Keys.Digit7`): When you configure a shortcut with a single character key from `Keys`, the library matches it case-insensitively against the `event.key` from the browser. For example, if you configure `Keys.A`, it will trigger for both "a" and "A" key presses (assuming Shift isn't a required modifier).
* Special Keys (e.g., `Keys.Enter`, `Keys.ArrowUp`, `Keys.Escape`): These are multi-character `event.key` values. The library matches these case-sensitively against the `event.key`. Using the `Keys` object ensures you provide the correct, standard case-sensitive string.


## Contributing

Contributions are welcome! Please feel free to submit issues, fork the repository, and create pull requests.

## Development Setup

1. Clone the repository.
2. Install dependencies: `npm install`.
3. Run tests: `npm test`.

# License

This project is licensed under the MIT License.

Powered by AI
