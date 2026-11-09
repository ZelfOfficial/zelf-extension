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

    it("keeps an empty vault on /zelf-keys/vault so the Android empty state renders in-place", () => {
        expect(
            zelfKeysRouteAfterList({
                path: "/zelf-keys/vault",
                passwordCount: 0,
                paymentCardCount: 0,
                needsReverify: false,
            })
        ).toBeNull();

        expect(
            zelfKeysRouteAfterList({
                path: "/zelf-keys/start",
                passwordCount: 0,
                paymentCardCount: 0,
                needsReverify: false,
            })
        ).toBe("/zelf-keys/vault");
    });
});
