/** Where the hub should go after a vault list. `null` leaves the current route. */
export function zelfKeysRouteAfterList(input: {
    path: string;
    passwordCount: number;
    paymentCardCount: number;
    needsReverify: boolean;
}): "/zelf-keys/vault" | "/zelf-keys/start" | null {
    const path = input.path.split("?")[0];

    if (input.needsReverify) {
        return path.includes("/zelf-keys/vault") ? null : "/zelf-keys/vault";
    }

    const hasAnyItems = input.passwordCount > 0 || input.paymentCardCount > 0;
    const onStart = path === "/zelf-keys" || path.endsWith("/zelf-keys/start");
    const onVault = path.includes("/zelf-keys/vault");

    if (hasAnyItems && onStart) return "/zelf-keys/vault";

    if (!hasAnyItems && onVault) return "/zelf-keys/start";

    return null;
}
