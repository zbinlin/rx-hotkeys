/**
 * Provides a set of common, standard string values for `KeyboardEvent.key`.
 * Using these values can help avoid typos and ensure consistency.
 * These are based on the MDN documentation:
 * https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values
 *
 * All shortcut configurations should use values from this object.
 */
export const Keys = {
    // Special Values
    Unidentified: "Unidentified",

    // Modifier Keys
    Alt: "Alt",
    AltGraph: "AltGraph",
    CapsLock: "CapsLock",
    Control: "Control",
    Fn: "Fn",
    FnLock: "FnLock",
    Hyper: "Hyper",
    Meta: "Meta", // Command key on Mac, Windows key on Windows
    NumLock: "NumLock",
    ScrollLock: "ScrollLock",
    Shift: "Shift",
    Super: "Super",
    Symbol: "Symbol",
    SymbolLock: "SymbolLock",

    // Whitespace Keys
    Enter: "Enter",
    Tab: "Tab",
    Space: " ", // Standard value for Space Bar

    // Navigation Keys
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    ArrowUp: "ArrowUp",
    End: "End",
    Home: "Home",
    PageDown: "PageDown",
    PageUp: "PageUp",

    // Editing Keys
    Backspace: "Backspace",
    Clear: "Clear",
    Copy: "Copy",
    CrSel: "CrSel", // Cursor Select
    Cut: "Cut",
    Delete: "Delete",
    EraseEof: "EraseEof", // Erase to End of Field
    ExSel: "ExSel", // Extend Selection
    Insert: "Insert",
    Paste: "Paste",
    Redo: "Redo",
    Undo: "Undo",

    // UI Keys
    Accept: "Accept",
    Again: "Again",
    Attn: "Attn", // Attention
    Cancel: "Cancel",
    ContextMenu: "ContextMenu", // Application key
    Escape: "Escape",
    Execute: "Execute",
    Find: "Find",
    Finish: "Finish",
    Help: "Help",
    Pause: "Pause",
    Play: "Play",
    Props: "Props", // Properties
    Select: "Select",
    ZoomIn: "ZoomIn",
    ZoomOut: "ZoomOut",

    // Device Keys
    BrightnessDown: "BrightnessDown",
    BrightnessUp: "BrightnessUp",
    Eject: "Eject",
    LogOff: "LogOff",
    Power: "Power",
    PowerOff: "PowerOff",
    PrintScreen: "PrintScreen",
    Hibernate: "Hibernate",
    Standby: "Standby", // Suspend or Sleep
    WakeUp: "WakeUp",

    // Function Keys
    F1: "F1", F2: "F2", F3: "F3", F4: "F4",
    F5: "F5", F6: "F6", F7: "F7", F8: "F8",
    F9: "F9", F10: "F10", F11: "F11", F12: "F12",
    F13: "F13", F14: "F14", F15: "F15", F16: "F16",
    F17: "F17", F18: "F18", F19: "F19", F20: "F20",

    // Phone Keys (selection)
    AppSwitch: "AppSwitch",
    Call: "Call",
    Camera: "Camera",
    EndCall: "EndCall",
    GoBack: "GoBack",
    GoHome: "GoHome",
    HeadsetHook: "HeadsetHook",

    // Multimedia Keys (selection)
    MediaPlayPause: "MediaPlayPause",
    MediaStop: "MediaStop",
    MediaTrackNext: "MediaTrackNext",
    MediaTrackPrevious: "MediaTrackPrevious",
    AudioVolumeDown: "AudioVolumeDown",
    AudioVolumeUp: "AudioVolumeUp",
    AudioVolumeMute: "AudioVolumeMute",

    // Numeric Keypad (special characters, numbers 0-9 are via KeyValues.DigitN)
    Decimal: ".", // This is the character for the decimal point
    KeypadMultiply: "*",
    KeypadAdd: "+",
    KeypadSubtract: "-",
    KeypadDivide: "/",

    // Character Keys (Uppercase A-Z for configuration via KeyValues)
    // The library handles case-insensitivity for these when matching browser events.
    A: "A", B: "B", C: "C", D: "D", E: "E", F: "F", G: "G", H: "H", I: "I",
    J: "J", K: "K", L: "L", M: "M", N: "N", O: "O", P: "P", Q: "Q", R: "R",
    S: "S", T: "T", U: "U", V: "V", W: "W", X: "X", Y: "Y", Z: "Z",

    // Digit Keys (0-9 for configuration via KeyValues)
    Digit0: "0", Digit1: "1", Digit2: "2", Digit3: "3", Digit4: "4",
    Digit5: "5", Digit6: "6", Digit7: "7", Digit8: "8", Digit9: "9",

} as const;

/**
 * Represents the set of allowed string literal values for keys, derived from the KeyValues object.
 * This ensures type safety when configuring shortcuts.
 */
export type StandardKey = typeof Keys[keyof typeof Keys];
