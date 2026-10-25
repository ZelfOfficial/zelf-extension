import { zelfKeysRouteAfterList } from "./zelf-keys-route";

describe("zelfKeysRouteAfterList", () => {
    it("opens the vault to re-verify instead of the empty start screen", () => {
        expect(
            zelfKeysRouteAfterList({
                path: "/zelf-keys/start",
                passwordCount: 0,
                paymentCardCount: 0,
                needsReverify: true,
            })
        ).toBe("/zelf-keys/vault");

        expect(
            zelfKeysRouteAfterList({
                path: "/zelf-keys/vault",
                passwordCount: 0,
                paymentCardCount: 0,
                needsReverify: true,
            })
        ).toBeNull();
    });

    it("still sends a genuinely empty vault to the start screen", () => {
        expect(
            zelfKeysRouteAfterList({
                path: "/zelf-keys/vault",
                passwordCount: 0,
                paymentCardCount: 0,
                needsReverify: false,
            })
        ).toBe("/zelf-keys/start");
    });
});
