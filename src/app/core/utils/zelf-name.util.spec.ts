import { normalizeZelfName, withNormalizedZelfTag } from "./zelf-name.util";

describe("normalizeZelfName", () => {
    it("lowercases and keeps a single .zelf suffix", () => {
        expect(normalizeZelfName("JimBot", "zelf")).toEqual({ tagName: "jimbot", domain: "zelf", zelfName: "jimbot.zelf" });
        expect(normalizeZelfName("Jimbot.Zelf", "zelf").zelfName).toBe("jimbot.zelf");
        expect(normalizeZelfName("Jimbot.Zelf.zelf", "Zelf").zelfName).toBe("jimbot.zelf");
    });

    it("uses the wallet domain when it is not zelf", () => {
        expect(normalizeZelfName("Alice.Hold", "hold").zelfName).toBe("alice.hold");
    });

    it("rewrites the tag name on an outbound request", () => {
        expect(withNormalizedZelfTag({ tagName: "JimBot.Zelf", domain: "Zelf", faceBase64: "face" })).toEqual({
            tagName: "jimbot.zelf",
            domain: "zelf",
            faceBase64: "face",
        });
        expect(withNormalizedZelfTag({ faceBase64: "face" })).toEqual({ faceBase64: "face" });
    });
});
