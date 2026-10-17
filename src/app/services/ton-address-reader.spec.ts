import { readPublicDataTonAddress, TagModel } from "@shared/types/tag.types";

describe("readPublicDataTonAddress", () => {
    const addr = "UQBqbh4fWUq_9-i9JF0FGxwYT4K7ydVYn0QPrqjg7dmiQG9d";

    it("reads the top-level tonAddress", () => {
        expect(readPublicDataTonAddress({ tonAddress: ` ${addr} ` })).toBe(addr);
    });

    it("falls back to the packed `ton` key inside an addresses chunk", () => {
        expect(readPublicDataTonAddress({ addresses2: JSON.stringify({ dot: "1abc", ton: addr }) })).toBe(addr);
    });

    it("returns empty when there is no TON address", () => {
        expect(readPublicDataTonAddress(null)).toBe("");
        expect(readPublicDataTonAddress({ ethAddress: "0x1" })).toBe("");
    });

    it("TagModel exposes the chunked TON address on publicData and displayTonAddress", () => {
        const tag = new TagModel({ tagName: "qa.zelf", publicData: { addresses2: JSON.stringify({ ton: addr }) } } as any);
        expect(tag.publicData.tonAddress).toBe(addr);
        expect(tag.displayTonAddress).toBeTruthy();
    });
});
