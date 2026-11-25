import { of } from "rxjs";

import { PasswordShareRequestError } from "./password-share.service";
import { PasswordShareIdentityService } from "./password-share-identity.service";

describe("PasswordShareIdentityService", () => {
    const identityError = new PasswordShareRequestError("ERR_ZELF_IDENTITY_REQUIRED");

    function setup(wallet: Record<string, unknown> = { publicData: { tagName: "demo", domain: "zelf" }, hasPassword: false }) {
        const openSheet = jasmine.createSpy("openSheet").and.returnValue({
            afterDismissed: () => of({ faceBase64: "encrypted-face" }),
        });
        const openDialog = jasmine.createSpy("openDialog").and.returnValue({
            afterClosed: () => of("secret-password"),
        });
        const decryptTag = jasmine.createSpy("decryptTag").and.resolveTo({ ok: true });
        const encryptMessage = jasmine.createSpy("encryptMessage").and.resolveTo("pgp:secret-password");
        const translate = jasmine.createSpy("translate").and.callFake((key: string) => key);
        const service = new PasswordShareIdentityService(
            { open: openSheet } as any,
            { open: openDialog } as any,
            { encryptMessage } as any,
            { decryptTag } as any,
            { translate } as any,
            { getCurrentWallet: async () => wallet } as any
        );

        return { service, openSheet, openDialog, decryptTag, encryptMessage };
    }

    it("retries the share once after the face check stamps the session", async () => {
        const { service, decryptTag } = setup();
        const work = jasmine.createSpy("work").and.returnValues(Promise.reject(identityError), Promise.resolve("created"));

        await expectAsync(service.run(work)).toBeResolvedTo("created");
        expect(work).toHaveBeenCalledTimes(2);
        expect(decryptTag).toHaveBeenCalledWith(
            jasmine.objectContaining({
                faceBase64: "encrypted-face",
                tagName: "demo",
                domain: "zelf",
                os: "DESKTOP",
            })
        );
        expect(decryptTag.calls.mostRecent().args[0].password).toBeUndefined();
        expect(decryptTag.calls.mostRecent().args[0].owner).toBeUndefined();
        expect(decryptTag.calls.mostRecent().args[0].name).toBeUndefined();
    });

    it("does not retry when the face check is cancelled", async () => {
        const { service, openSheet } = setup();
        openSheet.and.returnValue({ afterDismissed: () => of(undefined) });
        const work = jasmine.createSpy("work").and.rejectWith(identityError);

        await expectAsync(service.run(work)).toBeRejectedWith(identityError);
        expect(work).toHaveBeenCalledTimes(1);
    });

    it("does not open a face check for other errors", async () => {
        const { service, openSheet } = setup();
        const other = new PasswordShareRequestError("SHARE_FORBIDDEN");
        const work = jasmine.createSpy("work").and.rejectWith(other);

        await expectAsync(service.run(work)).toBeRejectedWith(other);
        expect(openSheet).not.toHaveBeenCalled();
    });

    it("asks for the Zelf ID password before the face check when the wallet has one", async () => {
        const { service, openDialog, decryptTag, encryptMessage } = setup({
            hasPassword: true,
            publicData: { tagName: "demo.zelf", domain: "zelf" },
        });

        const grant = await service.grant();

        expect(grant.ok).toBeTrue();
        expect(openDialog).toHaveBeenCalled();
        expect(encryptMessage).toHaveBeenCalledWith("secret-password");
        expect(decryptTag).toHaveBeenCalledWith(jasmine.objectContaining({ tagName: "demo", password: "pgp:secret-password" }));
    });
});
