import { PasswordShareSheetComponent, PasswordShareSheetData } from "./password-share-sheet.component";

describe("PasswordShareSheetComponent", () => {
    const data: PasswordShareSheetData = {
        title: "Example Mail",
        username: "demo.user@example.com",
        password: "synthetic-password",
        url: "https://example.com",
        notes: "Synthetic QA note",
    };

    function setup(sheetData: PasswordShareSheetData = data) {
        const createShare = jasmine.createSpy("createShare").and.resolveTo({
            id: "share123",
            expiresAt: "2026-11-18T12:00:00.000Z",
            maxViews: 1,
            link: "https://zelf.world/share/share123#fragment",
        });
        const translateError = jasmine.createSpy("translateError").and.returnValue("Mapped error");
        const dismiss = jasmine.createSpy("dismiss");
        const navigate = jasmine.createSpy("navigate").and.resolveTo(true);
        const component = new PasswordShareSheetComponent(
            sheetData,
            { dismiss } as any,
            { detectChanges() {} } as any,
            { createShare, translateError } as any,
            { navigate } as any,
            {} as any,
            { open() {} } as any,
            { translate: (key: string) => key } as any
        );

        return { component, createShare, translateError, dismiss, navigate };
    }

    it("defaults to 7 days, one view, and the optional login fields", () => {
        const { component } = setup();

        expect(component.expiration).toBe("7d");
        expect(component.maxViews).toBe(1);
        expect(component.includeUsername).toBeTrue();
        expect(component.includeWebsite).toBeTrue();
        expect(component.includeNotes).toBeFalse();
        expect(component.label).toBe("Example Mail");
    });

    it("creates a link against the share service and shows the result", async () => {
        const { component, createShare } = setup();
        component.includeNotes = true;
        component.label = "  ";
        component.maxViews = 2;

        await component.createLink();

        expect(createShare).toHaveBeenCalledWith({
            title: "Example Mail",
            password: "synthetic-password",
            username: "demo.user@example.com",
            url: "https://example.com",
            notes: "Synthetic QA note",
            expiresIn: "7d",
            maxViews: 2,
            label: "  ",
        });
        expect(component.view).toBe("result");
        expect(component.link).toBe("https://zelf.world/share/share123#fragment");
        expect(component.errorMessage).toBe("");
    });

    it("leaves username, website, and notes out when those fields are off", async () => {
        const { component, createShare } = setup();
        component.includeUsername = false;
        component.includeWebsite = false;

        await component.createLink();

        expect(createShare).toHaveBeenCalledWith(
            jasmine.objectContaining({
                username: undefined,
                url: undefined,
                notes: undefined,
            })
        );
    });

    it("shows the translated API error and stays on the form", async () => {
        const { component, createShare, translateError } = setup();
        const failure = { code: "SHARE_TOO_LARGE" };
        createShare.and.rejectWith(failure);

        await component.createLink();

        expect(translateError).toHaveBeenCalledWith(failure);
        expect(component.view).toBe("form");
        expect(component.errorMessage).toBe("Mapped error");
        expect(component.creating).toBeFalse();
    });

    it("keeps views between 1 and 10", () => {
        const { component } = setup();

        component.decreaseViews();
        expect(component.maxViews).toBe(1);
        component.maxViews = 10;
        component.increaseViews();
        expect(component.maxViews).toBe(10);
        component.decreaseViews();
        expect(component.maxViews).toBe(9);
    });
});
