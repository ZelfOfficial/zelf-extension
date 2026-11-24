/**
 * Seed-phrase import already collected a Zelf ID earlier in the session.
 * The next step is the master password. Face capture stays behind that screen.
 * A missing name still goes to the name form so the user can assign an identifier.
 */

export type SeedImportStack = "zelfid" | "legacy";

export function bareOnboardingName(value: string | null | undefined): string {
    const trimmed = String(value || "")
        .trim()
        .toLowerCase();

    if (!trimmed) return "";

    return trimmed.split(".")[0];
}

/** Prefer the name chosen for this import. A saved wallet name is not an input. */
export function givenOnboardingName(newName?: string | null, storedName?: string | null): string {
    return bareOnboardingName(newName) || bareOnboardingName(storedName);
}

export function seedImportPasswordPath(stack: SeedImportStack): string {
    return stack === "zelfid" ? "/security-zelfid/password" : "/security/password";
}

export function seedImportNamePath(stack: SeedImportStack): string {
    return stack === "zelfid" ? "/welcome-zelfid/find-import-claim" : "/welcome/find-import-claim";
}

export function seedImportNextPath(stack: SeedImportStack, givenName: string | null | undefined): string {
    return bareOnboardingName(givenName) ? seedImportPasswordPath(stack) : seedImportNamePath(stack);
}
