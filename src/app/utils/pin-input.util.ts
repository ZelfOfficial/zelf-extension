/**
 * Spread the characters typed/pasted into PIN box `index` across the 6 boxes, starting at `index`.
 * Mutates `digits` and returns the box that should receive focus next (null when nothing to move to).
 */
export function spreadPinInput(digits: string[], index: number, rawValue: string, length: number = 6): number | null {
    const value = (rawValue || "").replace(/\s/g, "");

    if (!value) {
        digits[index] = "";
        return null;
    }

    // Full PIN pasted: fill every box from the start.
    if (value.length >= length) {
        value.slice(0, length).split("").forEach((char, i) => (digits[i] = char));
        return length - 1;
    }

    // Box already held a character and the user typed another: keep only the new trailing characters.
    const previous = digits[index] || "";
    const keepsPrevious = !!previous && value.length > 1 && value.startsWith(previous);
    const chars = (keepsPrevious ? value.slice(previous.length) : value).split("");

    let cursor = keepsPrevious ? index + 1 : index;

    for (const char of chars) {
        if (cursor >= length) break;
        digits[cursor] = char;
        cursor += 1;
    }

    return cursor < length ? cursor : length - 1;
}
