import { TestBed } from "@angular/core/testing";
import { HttpWrapperService } from "../http-wrapper.service";
import { WalletService } from "../wallet.service";
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
    };

    const mockHttpWrapperService = {
        encryptMessage: jasmine.createSpy("encryptMessage").and.callFake((data: string) => Promise.resolve(`encrypted:${data}`)),
    };

    beforeEach(() => {
        mockZelfKeysService.storePasswordWithAuth.calls.reset();
        mockHttpWrapperService.encryptMessage.calls.reset();

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

    describe("importBatch", () => {
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
            const result = await service.importBatch(credentials, faceBase64);

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

            await service.importBatch(credentials, faceBase64, masterPassword);

            expect(mockZelfKeysService.storePasswordWithAuth).toHaveBeenCalledWith(
                jasmine.objectContaining({
                    faceBase64,
                    masterPassword,
                })
            );
        });
    });
});
