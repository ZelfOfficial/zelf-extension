import { TestBed } from "@angular/core/testing";
import { VaultService } from "../vault.service";
import { ExportableCredential, VaultExportService } from "./vault-export.service";
import { ZelfKeysProofService } from "./zelf-keys-proof.service";
import { ZelfKeysService } from "./zelf-keys.service";

describe("VaultExportService", () => {
    let service: VaultExportService;

    const mockVaultService = {
        generateEphemeralKeyPair: jasmine.createSpy("generateEphemeralKeyPair"),
        decryptWithPrivateKey: jasmine.createSpy("decryptWithPrivateKey"),
    };

    const mockZelfKeysService = {
        retrieve: jasmine.createSpy("retrieve"),
    };

    const sampleCredentials: ExportableCredential[] = [
        {
            title: "GitHub",
            website: "https://github.com",
            username: "miguel@verifik.co",
            password: "super,secret\"password",
            notes: "My notes with\nnewline",
            folder: "Work",
            favorite: true,
        },
        {
            title: "Google",
            website: "google.com",
            username: "user@gmail.com",
            password: "simplePassword123",
            notes: "Personal account",
            folder: "Personal",
            favorite: false,
        },
    ];

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                VaultExportService,
                { provide: VaultService, useValue: mockVaultService },
                { provide: ZelfKeysService, useValue: mockZelfKeysService },
                { provide: ZelfKeysProofService, useValue: {} },
            ],
        });
        service = TestBed.inject(VaultExportService);
    });

    it("should be created", () => {
        expect(service).toBeTruthy();
    });

    describe("RFC 4180 Escaping and BOM", () => {
        it("prepends UTF-8 BOM to CSV exports", () => {
            const csv = service.exportToString("lastpass", sampleCredentials);
            expect(csv.startsWith("\uFEFF")).toBeTrue();
        });

        it("escapes fields containing commas, quotes, and newlines properly", () => {
            const csv = service.exportToString("lastpass", sampleCredentials);
            // Quotes inside values must be doubled: ""
            expect(csv).toContain('"super,secret""password"');
            // Multiline notes must be enclosed in quotes
            expect(csv).toContain('"My notes with\nnewline"');
        });
    });

    describe("LastPass format", () => {
        it("exports exact LastPass CSV headers and rows", () => {
            const csv = service.exportToString("lastpass", sampleCredentials);
            const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
            expect(lines[0]).toBe("url,username,password,extra,name,grouping,fav");
            expect(lines[1]).toContain("https://github.com");
            expect(lines[1]).toContain("miguel@verifik.co");
            expect(lines[1]).toContain("Work");
            expect(lines[1].endsWith(",1")).toBeTrue(); // favorite
        });
    });

    describe("Bitwarden formats", () => {
        it("exports exact Bitwarden CSV headers and rows", () => {
            const csv = service.exportToString("bitwarden_csv", sampleCredentials);
            const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
            expect(lines[0]).toBe(
                "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp"
            );
            expect(lines[1]).toContain("Work,1,login,GitHub");
            expect(lines[1]).toContain("https://github.com");
        });

        it("exports valid unencrypted Bitwarden JSON", () => {
            const jsonStr = service.exportToString("bitwarden_json", sampleCredentials);
            const parsed = JSON.parse(jsonStr);
            expect(parsed.encrypted).toBeFalse();
            expect(parsed.folders.length).toBe(2);
            expect(parsed.folders.map((f: any) => f.name)).toEqual(["Work", "Personal"]);
            expect(parsed.items.length).toBe(2);
            expect(parsed.items[0].type).toBe(1);
            expect(parsed.items[0].name).toBe("GitHub");
            expect(parsed.items[0].login.username).toBe("miguel@verifik.co");
            expect(parsed.items[0].login.password).toBe("super,secret\"password");
            expect(parsed.items[0].login.uris[0].uri).toBe("https://github.com");
            expect(parsed.items[0].favorite).toBeTrue();
        });
    });

    describe("1Password format", () => {
        it("exports exact 1Password CSV headers", () => {
            const csv = service.exportToString("1password", sampleCredentials);
            const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
            expect(lines[0]).toBe("Title,URL,Username,Password,Notes");
            expect(lines[1]).toContain("GitHub");
            expect(lines[1]).toContain("https://github.com");
            expect(lines[1]).toContain("miguel@verifik.co");
        });
    });

    describe("Google Chrome format", () => {
        it("exports exact Chrome CSV headers", () => {
            const csv = service.exportToString("chrome", sampleCredentials);
            const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
            expect(lines[0]).toBe("name,url,username,password,note");
            expect(lines[1]).toContain("GitHub,https://github.com");
        });
    });

    describe("Apple Passwords format", () => {
        it("exports exact Apple Passwords CSV headers", () => {
            const csv = service.exportToString("apple", sampleCredentials);
            const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
            expect(lines[0]).toBe("Title,URL,Username,Password,Notes,OTPAuth");
            expect(lines[1]).toContain("GitHub");
            expect(lines[1]).toContain("https://github.com");
        });
    });

    describe("KeePassXC format", () => {
        it("exports exact KeePassXC CSV headers", () => {
            const csv = service.exportToString("keepassxc", sampleCredentials);
            const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
            expect(lines[0]).toBe("Group,Title,Username,Password,URL,Notes");
            expect(lines[1]).toContain("Root/Work,GitHub");
        });
    });
});
