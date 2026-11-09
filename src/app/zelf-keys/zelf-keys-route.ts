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

    const onStart = path === "/zelf-keys" || path.endsWith("/zelf-keys/start");

    if (onStart) return "/zelf-keys/vault";

    return null;
}
