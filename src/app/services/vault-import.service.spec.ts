import { TestBed } from "@angular/core/testing";
import { HttpWrapperService } from "../http-wrapper.service";
import { WalletService } from "../wallet.service";
import {
    APPLE_SAMPLE_CSV,
    BITWARDEN_SAMPLE_CSV,
    CHROME_SAMPLE_CSV,
    KEEPASSXC_SAMPLE_CSV,
    LASTPASS_SAMPLE_CSV,
    ONEPASSWORD_MINIMAL_SAMPLE_CSV,
    ONEPASSWORD_SAMPLE_CSV,
} from "./fixtures/vault-import-sample-exports";
import { VaultImportService, ImportableCredential } from "./vault-import.service";
import { ZelfKeysService } from "./zelf-keys.service";

describe("VaultImportService", () => {
    let service: VaultImportService;

    const mockWalletService = {
        getCurrentWallet: jasmine.createSpy("getCurrentWallet").and.returnValue(
            Promise.resolve({
                name: "test-wallet",
                zelfProof: "test-proof",
                hasPassword: false,
            })
        ),
    };

    const mockZelfKeysService = {
        storePasswordWithAuth: jasmine.createSpy("storePasswordWithAuth").and.returnValue(Promise.resolve({ success: true })),
        storePasswordsBulkWithAuth: jasmine
            .createSpy("storePasswordsBulkWithAuth")
            .and.returnValue(Promise.resolve({ data: { results: [{ success: true }] } })),
    };

    const mockHttpWrapperService = {
        encryptMessage: jasmine.createSpy("encryptMessage").and.callFake((data: string) => Promise.resolve(`encrypted:${data}`)),
    };

    beforeEach(() => {
        mockZelfKeysService.storePasswordWithAuth.calls.reset();
        mockZelfKeysService.storePasswordsBulkWithAuth.calls.reset();
        mockZelfKeysService.storePasswordsBulkWithAuth.and.returnValue(
            Promise.resolve({
                data: {
                    success: [{ index: 0 }],
                    failed: [],
                    total: 1,
                    successCount: 1,
                    failedCount: 0,
                    maxBatchSize: 100,
                },
            })
        );
        mockHttpWrapperService.encryptMessage.calls.reset();
        mockWalletService.getCurrentWallet.and.returnValue(
            Promise.resolve({
                name: "test-wallet",
                zelfProof: "test-proof",
                hasPassword: false,
            })
        );

        TestBed.configureTestingModule({
            providers: [
                VaultImportService,
                { provide: WalletService, useValue: mockWalletService },
                { provide: ZelfKeysService, useValue: mockZelfKeysService },
                { provide: HttpWrapperService, useValue: mockHttpWrapperService },
            ],
        });
        service = TestBed.inject(VaultImportService);
    });

    it("should be created", () => {
        expect(service).toBeTruthy();
    });

    describe("CSV Parsing (RFC 4180)", () => {
        it("handles quoted fields with commas and newlines", () => {
            const csv = 'url,username,password,notes\n"https://github.com","user@test.com","pass,word","note line 1\nline 2"';
            const rows = service.parseCsvRows(csv);
            expect(rows.length).toBe(2);
            expect(rows[1][0]).toBe("https://github.com");
            expect(rows[1][1]).toBe("user@test.com");
            expect(rows[1][2]).toBe("pass,word");
            expect(rows[1][3]).toBe("note line 1\nline 2");
        });

        it("handles doubled quotes inside quoted fields", () => {
            const csv = 'url,username,password\n"https://site.com","user","secret""quote"';
            const rows = service.parseCsvRows(csv);
            expect(rows[1][2]).toBe('secret"quote');
        });
    });

    describe("Provider Format Auto-Detection", () => {
        it("detects LastPass format", () => {
            const csv = "url,username,password,extra,name,grouping,fav\nhttps://github.com,user,pass,extra,GitHub,Work,1";
            expect(service.detectProvider(csv)).toBe("lastpass");
        });

        it("detects Bitwarden CSV format", () => {
            const csv = "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp";
            expect(service.detectProvider(csv)).toBe("bitwarden_csv");
        });

        it("detects Bitwarden JSON format", () => {
            const json = JSON.stringify({
                encrypted: false,
                folders: [],
                items: [{ type: 1, name: "GitHub", login: { uris: [{ uri: "https://github.com" }], username: "u", password: "p" } }],
            });
            expect(service.detectProvider(json)).toBe("bitwarden_json");
        });

        it("detects 1Password CSV format", () => {
            const csv = "Title,URL,Username,Password,Notes\nGitHub,https://github.com,user,pass,notes";
            expect(service.detectProvider(csv)).toBe("1password");
        });

        it("detects Google Chrome format", () => {
            const csv = "name,url,username,password,note\nGitHub,https://github.com,user,pass,notes";
            expect(service.detectProvider(csv)).toBe("chrome");
        });

        it("detects Apple Passwords format", () => {
            const csv = "Title,URL,Username,Password,Notes,OTPAuth\nGitHub,https://github.com,user,pass,notes,";
            expect(service.detectProvider(csv)).toBe("apple");
        });

        it("detects KeePassXC format", () => {
            const csv = '"Group","Title","Username","Password","URL","Notes"\n"Root/Work","GitHub","user","pass","https://github.com","notes"';
            expect(service.detectProvider(csv)).toBe("keepassxc");
        });
    });

    describe("Parsing credentials", () => {
        it("parses LastPass credentials properly", () => {
            const csv = "url,username,password,extra,name,grouping,fav\nhttps://github.com,user@test.com,pass123,my note,GitHub,Work,1";
            const result = service.parseContent(csv);
            expect(result.detectedProvider).toBe("lastpass");
            expect(result.credentials.length).toBe(1);
            expect(result.credentials[0].title).toBe("GitHub");
            expect(result.credentials[0].website).toBe("https://github.com");
            expect(result.credentials[0].username).toBe("user@test.com");
            expect(result.credentials[0].password).toBe("pass123");
            expect(result.credentials[0].notes).toBe("my note");
            expect(result.credentials[0].folder).toBe("Work");
        });

        it("parses Bitwarden JSON properly", () => {
            const json = JSON.stringify({
                encrypted: false,
                folders: [{ id: "f1", name: "Engineering" }],
                items: [
                    {
                        folderId: "f1",
                        type: 1,
                        name: "GitLab",
                        notes: "Important account",
                        login: {
                            uris: [{ uri: "https://gitlab.com" }],
                            username: "dev@verifik.co",
                            password: "tokenPassword",
                        },
                    },
                ],
            });
            const result = service.parseContent(json);
            expect(result.detectedProvider).toBe("bitwarden_json");
            expect(result.credentials.length).toBe(1);
            expect(result.credentials[0].title).toBe("GitLab");
            expect(result.credentials[0].website).toBe("https://gitlab.com");
            expect(result.credentials[0].username).toBe("dev@verifik.co");
            expect(result.credentials[0].password).toBe("tokenPassword");
            expect(result.credentials[0].folder).toBe("Engineering");
        });

        it("parses KeePassXC CSV properly and strips Root/ prefix from folder", () => {
            const csv = '"Group","Title","Username","Password","URL","Notes"\n"Root/Development","Stripe","admin@corp.com","stripePass","https://dashboard.stripe.com","api key notes"';
            const result = service.parseContent(csv);
            expect(result.detectedProvider).toBe("keepassxc");
            expect(result.credentials.length).toBe(1);
            expect(result.credentials[0].title).toBe("Stripe");
            expect(result.credentials[0].folder).toBe("Development");
            expect(result.credentials[0].username).toBe("admin@corp.com");
        });
    });

    describe("QA sample exports", () => {
        it("parses LastPass QA sample CSV", () => {
            const result = service.parseContent(LASTPASS_SAMPLE_CSV);
            expect(result.detectedProvider).toBe("lastpass");
            expect(result.credentials.length).toBe(5);
            expect(result.credentials[0].title).toBe("Example Mail");
            expect(result.credentials[0].website).toBe("https://mail.example.com/");
            expect(result.credentials[0].username).toBe("qa.mail@example.com");
            expect(result.credentials[0].password).toBe("TestPass_Mail_9x!");
            expect(result.credentials[0].folder).toBe("Personal");
            expect(result.credentials[3].password).toBe('Pass"Quote"99');
        });

        it("parses 1Password QA sample CSV (full export)", () => {
            const result = service.parseContent(ONEPASSWORD_SAMPLE_CSV);
            expect(result.detectedProvider).toBe("1password");
            expect(result.credentials.length).toBe(5);
            expect(result.credentials[0].title).toBe("Example Mail");
            expect(result.credentials[0].website).toBe("https://mail.example.com/");
            expect(result.credentials[0].username).toBe("qa.mail@example.com");
            expect(result.credentials[0].password).toBe("TestPass_Mail_9x!");
        });

        it("parses 1Password minimal QA sample CSV", () => {
            const result = service.parseContent(ONEPASSWORD_MINIMAL_SAMPLE_CSV);
            expect(result.detectedProvider).toBe("1password");
            expect(result.credentials.length).toBe(5);
            expect(result.credentials[4].title).toBe("Zelf Staging");
            expect(result.credentials[4].password).toBe("ZelfKeys_Import_Only_1!");
        });

        it("parses Chrome QA sample CSV", () => {
            const result = service.parseContent(CHROME_SAMPLE_CSV);
            expect(result.detectedProvider).toBe("chrome");
            expect(result.credentials.length).toBe(5);
            expect(result.credentials[1].title).toBe("GitHub QA");
            expect(result.credentials[1].username).toBe("qa-github-user");
        });

        it("parses Bitwarden QA sample CSV", () => {
            const result = service.parseContent(BITWARDEN_SAMPLE_CSV);
            expect(result.detectedProvider).toBe("bitwarden_csv");
            expect(result.credentials.length).toBe(5);
            expect(result.credentials[0].folder).toBe("Personal");
            expect(result.credentials[3].password).toBe('Pass"Quote"99');
        });

        it("parses KeePassXC QA sample CSV", () => {
            const result = service.parseContent(KEEPASSXC_SAMPLE_CSV);
            expect(result.detectedProvider).toBe("keepassxc");
            expect(result.credentials.length).toBe(5);
            expect(result.credentials[0].folder).toBe("Personal");
            expect(result.credentials[3].folder).toBe("");
        });

        it("parses Apple QA sample CSV", () => {
            const result = service.parseContent(APPLE_SAMPLE_CSV);
            expect(result.detectedProvider).toBe("apple");
            expect(result.credentials.length).toBe(5);
            expect(result.credentials[0].title).toBe("Example Mail");
            expect(result.credentials[0].notes).toBe("Note with comma");
        });
    });

    describe("importBatchOneByOne", () => {
        const credentials: ImportableCredential[] = [
            {
                id: "1",
                title: "GitHub",
                website: "https://github.com",
                username: "user@test.com",
                password: "secret123",
                selected: true,
            },
            {
                id: "2",
                title: "GitLab",
                website: "https://gitlab.com",
                username: "dev@test.com",
                password: "token456",
                selected: true,
            },
        ];

        it("encrypts each credential password before storePasswordWithAuth", async () => {
            const faceBase64 = "encrypted-face";
            const result = await service.importBatchOneByOne(credentials, faceBase64);

            expect(mockHttpWrapperService.encryptMessage).toHaveBeenCalledTimes(2);
            expect(mockHttpWrapperService.encryptMessage).toHaveBeenCalledWith("secret123");
            expect(mockHttpWrapperService.encryptMessage).toHaveBeenCalledWith("token456");
            expect(mockZelfKeysService.storePasswordWithAuth).toHaveBeenCalledTimes(2);
            expect(mockZelfKeysService.storePasswordWithAuth).toHaveBeenCalledWith(
                jasmine.objectContaining({
                    password: "encrypted:secret123",
                    faceBase64,
                })
            );
            expect(mockZelfKeysService.storePasswordsBulkWithAuth).not.toHaveBeenCalled();
            expect(result.succeeded).toBe(2);
            expect(result.failed).toEqual([]);
        });

        it("passes through already-encrypted faceBase64 and masterPassword", async () => {
            const faceBase64 = "encrypted-face";
            const masterPassword = "encrypted-master";

            mockWalletService.getCurrentWallet.and.returnValue(
                Promise.resolve({
                    name: "test-wallet",
                    zelfProof: "test-proof",
                    hasPassword: true,
                })
            );

            await service.importBatchOneByOne(credentials, faceBase64, masterPassword);

            expect(mockZelfKeysService.storePasswordWithAuth).toHaveBeenCalledWith(
                jasmine.objectContaining({
                    faceBase64,
                    masterPassword,
                })
            );
        });

        it("routes importBatch to one-by-one mode by default", async () => {
            await service.importBatch(credentials, "encrypted-face");

            expect(mockZelfKeysService.storePasswordWithAuth).toHaveBeenCalledTimes(2);
            expect(mockZelfKeysService.storePasswordsBulkWithAuth).not.toHaveBeenCalled();
        });
    });

    describe("importBatchBulk", () => {
        const credentials: ImportableCredential[] = [
            {
                id: "1",
                title: "GitHub",
                website: "https://github.com",
                username: "user@test.com",
                password: "secret123",
                selected: true,
            },
            {
                id: "2",
                title: "GitLab",
                website: "https://gitlab.com",
                username: "dev@test.com",
                password: "token456",
                selected: false,
            },
        ];

        it("encrypts selected passwords and sends one bulk request", async () => {
            const faceBase64 = "encrypted-face";
            const result = await service.importBatchBulk(credentials, faceBase64);

            expect(mockHttpWrapperService.encryptMessage).toHaveBeenCalledTimes(1);
            expect(mockHttpWrapperService.encryptMessage).toHaveBeenCalledWith("secret123");
            expect(mockZelfKeysService.storePasswordWithAuth).not.toHaveBeenCalled();
            expect(mockZelfKeysService.storePasswordsBulkWithAuth).toHaveBeenCalledTimes(1);
            expect(mockZelfKeysService.storePasswordsBulkWithAuth).toHaveBeenCalledWith(
                jasmine.objectContaining({
                    faceBase64,
                    passwords: [
                        jasmine.objectContaining({
                            website: "https://github.com",
                            username: "user@test.com",
                            password: "encrypted:secret123",
                            alias: "GitHub",
                        }),
                    ],
                })
            );
            const bulkRequest = mockZelfKeysService.storePasswordsBulkWithAuth.calls.mostRecent().args[0];
            expect(bulkRequest.zelfProof).toBeUndefined();
            expect(result.succeeded).toBe(1);
            expect(result.failed).toEqual([]);
        });

        it("maps per-row bulk failures from API failed[]", async () => {
            mockZelfKeysService.storePasswordsBulkWithAuth.and.returnValue(
                Promise.resolve({
                    data: {
                        success: [{ index: 0 }],
                        failed: [{ index: 1, message: "Duplicate entry", code: "Conflict" }],
                        total: 2,
                        successCount: 1,
                        failedCount: 1,
                        maxBatchSize: 100,
                    },
                })
            );

            const twoSelected: ImportableCredential[] = [
                { ...credentials[0], selected: true },
                {
                    id: "3",
                    title: "Stripe",
                    website: "https://stripe.com",
                    username: "admin",
                    password: "pw",
                    selected: true,
                },
            ];

            const result = await service.importBatchBulk(twoSelected, "encrypted-face");

            expect(result.succeeded).toBe(1);
            expect(result.failed.length).toBe(1);
            expect(result.failed[0].credential.title).toBe("Stripe");
            expect(result.failed[0].error).toBe("Duplicate entry");
        });

        it("rethrows whole-request bulk failures (e.g. face/master 412)", async () => {
            mockZelfKeysService.storePasswordsBulkWithAuth.and.returnValue(
                Promise.reject({ status: 412, error: { message: "encryption_key_didnt_match" } })
            );

            await expectAsync(service.importBatchBulk(credentials, "encrypted-face")).toBeRejected();
        });

        it("chunks bulk imports into batches of 100", async () => {
            const manyCredentials: ImportableCredential[] = Array.from({ length: 101 }, (_, i) => ({
                id: `${i + 1}`,
                title: `Site ${i + 1}`,
                website: `https://example-${i + 1}.com`,
                username: `user${i + 1}@example.com`,
                password: `pass-${i + 1}`,
                selected: true,
            }));

            await service.importBatchBulk(manyCredentials, "encrypted-face");

            expect(mockZelfKeysService.storePasswordsBulkWithAuth).toHaveBeenCalledTimes(2);
            expect(mockZelfKeysService.storePasswordsBulkWithAuth.calls.argsFor(0)[0].passwords.length).toBe(100);
            expect(mockZelfKeysService.storePasswordsBulkWithAuth.calls.argsFor(1)[0].passwords.length).toBe(1);
        });

        it("routes importBatch to bulk mode when requested", async () => {
            await service.importBatch(credentials, "encrypted-face", undefined, undefined, "bulk");

            expect(mockZelfKeysService.storePasswordsBulkWithAuth).toHaveBeenCalledTimes(1);
            expect(mockZelfKeysService.storePasswordWithAuth).not.toHaveBeenCalled();
        });
    });
});
