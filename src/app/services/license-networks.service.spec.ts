import { DomainService } from "app/domain.service";
import { WalletService } from "app/wallet.service";

import { LicenseNetworksService } from "./license-networks.service";

describe("LicenseNetworksService", () => {
    const zelfLicense = (networks: Record<string, { enabled: boolean }>) => ({ name: "zelf", tags: { wallet: { networks } } }) as any;

    function setup(opts: { cached?: any; cacheValid?: boolean; fresh?: any; fetchFails?: boolean; walletDomain?: string }) {
        let configs: Record<string, any> = opts.cached ? { zelf: opts.cached } : {};
        const domainService = {
            loadDomainsFromStorage: jasmine.createSpy("loadDomainsFromStorage").and.resolveTo([]),
            getDomainLicense: (d: string) => configs[d],
            isCacheValid: jasmine.createSpy("isCacheValid").and.resolveTo(!!opts.cacheValid),
            getDomains: jasmine.createSpy("getDomains").and.callFake(async () => {
                if (opts.fetchFails) throw new Error("offline");
                configs = { ...configs, ...(opts.fresh ? { zelf: opts.fresh } : {}) };
                return { success: true, data: configs };
            }),
        };
        const walletService = {
            getCurrentWallet: async () => ({ domain: opts.walletDomain || "zelf", publicData: {} }),
        };

        const service = new LicenseNetworksService(domainService as unknown as DomainService, walletService as unknown as WalletService);

        return { service, domainService };
    }

    it("returns the networks the license admin enabled, from a fresh license fetch", async () => {
        const { service, domainService } = setup({
            fresh: zelfLicense({ ethereum: { enabled: true }, optimism: { enabled: true }, arbitrum: { enabled: true }, base: { enabled: false } }),
        });

        expect(await service.ensureLoaded()).toEqual(["ethereum", "optimism", "arbitrum"]);
        expect(service.allowedNetworkIds).toEqual(["ethereum", "optimism", "arbitrum"]);
        expect(domainService.getDomains).toHaveBeenCalledTimes(1);
    });

    it("uses the cached license without a network call while the cache is fresh", async () => {
        const { service, domainService } = setup({ cached: zelfLicense({ solana: { enabled: true } }), cacheValid: true });

        expect(await service.ensureLoaded()).toEqual(["solana"]);
        expect(domainService.getDomains).not.toHaveBeenCalled();
    });

    it("falls back to the cached license when the API fails", async () => {
        const { service } = setup({ cached: zelfLicense({ ethereum: { enabled: true } }), fetchFails: true });

        expect(await service.ensureLoaded()).toEqual(["ethereum"]);
    });

    it("refetches when forced (license admin just changed it)", async () => {
        const { service, domainService } = setup({ cached: zelfLicense({ ethereum: { enabled: true } }), cacheValid: true, fresh: zelfLicense({ ethereum: { enabled: true }, arbitrum: { enabled: true } }) });

        expect(await service.ensureLoaded()).toEqual(["ethereum"]);
        expect(await service.ensureLoaded(true)).toEqual(["ethereum", "arbitrum"]);
        expect(domainService.getDomains).toHaveBeenCalledTimes(1);
    });

    it("returns null when no license config exists for the wallet's domain", async () => {
        const { service } = setup({ walletDomain: "other", fresh: zelfLicense({ ethereum: { enabled: true } }) });

        expect(await service.ensureLoaded()).toBeNull();
    });
});
