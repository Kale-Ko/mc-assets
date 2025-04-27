import * as fs from "fs";
import * as path from "path";

const VERSION = "1.0.0";
const USER_AGENT: string = `Bun/${Bun.version} ms-asset-downloader/${VERSION}`;
const HOME_URL: string = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const ASSET_URL: string = "https://resources.download.minecraft.net";

const CACHE_DIRECTORY = path.resolve("cache/");
const PISTON_CACHE_DIRECTORY = path.join(CACHE_DIRECTORY, "piston/");
const ASSETS_CACHE_DIRECTORY = path.join(CACHE_DIRECTORY, "assets/");

fs.mkdirSync(CACHE_DIRECTORY, { recursive: true });
fs.mkdirSync(PISTON_CACHE_DIRECTORY, { recursive: true });
fs.mkdirSync(ASSETS_CACHE_DIRECTORY, { recursive: true });

interface CachedResponse<T> {
    cached: boolean
    cachedTime: number
    cachedPath: string
    value: T
}

interface VersionList {
    latest: {
        release: string
        snapshot: string
    }
    versions: {
        id: string
        type: "release" | "snapshot" | "old_snapshot" | "old_beta" | "old_alpha" | "experiment"
        url: string
        time: string
        releaseTime: string
        sha1: string
        complianceLevel?: 0 | 1
    }[]
}

interface Version {
    id: string
    type: "release" | "snapshot" | "old_snapshot" | "old_beta" | "old_alpha" | "experiment"
    time: string
    releaseTime: string
    /**
     * Present on all versions except 13w24a-13w38c (1.6-1.6.3)
    */
    complianceLevel?: 0 | 1
    mainClass: string
    minimumLauncherVersion: number
    /**
     * Present on all versions except 13w24a-13w38c (1.6-1.6.3)
    */
    javaVersion?: {
        component: string
        majorVersion: number
    }
    arguments?: {
        [key: string]: (string | {
            value: string | string[]
            rules?: any[] // TODO
        })[]
    }
    minecraftArguments?: string
    downloads: {
        [key: string]: {
            sha1: string
            size: number
            url: string
        }
    }
    libraries: {
        name: string
        downloads: {
            classifiers?: {
                [key: string]: {
                    path: string
                    sha1: string
                    size: number
                    url: string
                }
            }
        } & {
            [key: string]: {
                path: string
                sha1: string
                size: number
                url: string
            }
        }
        extract?: any // TODO
        natives?: {
            [key: string]: string
        }
        rules?: any[] // TODO
    }[]
    logging?: {
        [key: string]: {
            type: string
            argument: string
            file: {
                id: string
                sha1: string
                size: number
                url: string
            }
        }
    }
    assets: string
    assetIndex: {
        id: string
        sha1: string
        size: number
        totalSize: number
        url: string
    }
}

interface AssetIndex {
    /**
     * Only present on 13w23b and below. I have no idea what this means.
     */
    map_to_resources?: boolean
    /**
     * Only present on 13w24a-13w48b. I have no idea what this means.
     */
    virtual?: boolean
    objects: {
        [key: string]: {
            hash: string
            size: number
        }
    }
}

let versionListCache: CachedResponse<VersionList> | undefined = undefined;
let versionCache: {
    [key: string]: CachedResponse<Version>
} = {};
let assetIndexCache: {
    [key: string]: CachedResponse<AssetIndex>
} = {};
let downloadableCache: {
    [key: string]: CachedResponse<Uint8Array>
} = {};

async function downloadVersionList(): Promise<CachedResponse<VersionList>> {
    if (versionListCache !== undefined && Date.now() - versionListCache.cachedTime < 1000 * 60 * 1) {
        return versionListCache;
    }

    let filePath = path.join(PISTON_CACHE_DIRECTORY, "version_manifest_v2.json");
    if (fs.existsSync(filePath) && Date.now() - fs.statSync(filePath).mtime.getTime() < 1000 * 60 * 30) {
        let data = fs.readFileSync(filePath, { encoding: "utf8" });

        return versionListCache = { cached: true, cachedTime: Date.now(), cachedPath: filePath, value: JSON.parse(data) as VersionList };
    } else {
        let response = await Bun.fetch(HOME_URL, {
            headers: {
                "Accept": "application/json",
                "User-Agent": USER_AGENT
            }
        });

        if (response.ok) {
            let data = await response.text();

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, data, { encoding: "utf8" });

            return versionListCache = { cached: false, cachedTime: Date.now(), cachedPath: filePath, value: JSON.parse(data) as VersionList };
        } else {
            throw Error(`Response from "${HOME_URL}" was "${response.status} ${response.statusText}"!`);
        }
    }
}

async function downloadVersion(versionId: string): Promise<CachedResponse<Version>> {
    if (versionCache[versionId] !== undefined && Date.now() - versionCache[versionId].cachedTime < 1000 * 60 * 1) {
        return versionCache[versionId];
    }

    let versionList = (await downloadVersionList()).value;

    let versionInfo = versionList.versions.find(version => version.id === versionId);
    if (versionInfo === undefined) {
        throw Error(`Could not find version "${versionId}"!`);
    }

    let filePath = path.join(PISTON_CACHE_DIRECTORY, versionInfo.sha1.substring(0, 2), versionInfo.sha1.substring(2));
    if (fs.existsSync(filePath)) {
        let data = fs.readFileSync(filePath, { encoding: "utf8" });

        return versionCache[versionId] = { cached: true, cachedTime: Date.now(), cachedPath: filePath, value: JSON.parse(data) as Version };
    } else {
        let response = await Bun.fetch(versionInfo.url, {
            headers: {
                "Accept": "application/json",
                "User-Agent": USER_AGENT
            }
        });

        if (response.ok) {
            let data = await response.text();

            let hash = new Bun.CryptoHasher("sha1").update(data).digest("hex");
            if (hash !== versionInfo.sha1) {
                throw Error(`Hash of version "${versionInfo.url}" does not match! Expected "${versionInfo.sha1}" but got "${hash}".`);
            }

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, data, { encoding: "utf8" });

            return versionCache[versionId] = { cached: false, cachedTime: Date.now(), cachedPath: filePath, value: JSON.parse(data) as Version };
        } else {
            throw Error(`Response from "${versionInfo.url}" was "${response.status} ${response.statusText}"!`);
        }
    }
}

async function downloadAssetIndex(versionId: string): Promise<CachedResponse<AssetIndex>> {
    if (assetIndexCache[versionId] !== undefined && Date.now() - assetIndexCache[versionId].cachedTime < 1000 * 60 * 1) {
        return assetIndexCache[versionId];
    }

    let version = (await downloadVersion(versionId)).value;

    let assetIndex = version.assetIndex;

    let filePath = path.join(PISTON_CACHE_DIRECTORY, assetIndex.sha1.substring(0, 2), assetIndex.sha1.substring(2));
    if (fs.existsSync(filePath)) {
        let data = fs.readFileSync(filePath, { encoding: "utf8" });

        return assetIndexCache[versionId] = { cached: true, cachedTime: Date.now(), cachedPath: filePath, value: JSON.parse(data) as AssetIndex };
    } else {
        let response = await Bun.fetch(assetIndex.url, {
            headers: {
                "Accept": "application/json",
                "User-Agent": USER_AGENT
            }
        });

        if (response.ok) {
            let data = await response.text();

            let hash = new Bun.CryptoHasher("sha1").update(data).digest("hex");
            if (hash !== assetIndex.sha1) {
                throw Error(`Hash of asset index "${assetIndex.url}" does not match! Expected "${assetIndex.sha1}" but got "${hash}".`);
            }

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, data, { encoding: "utf8" });

            return assetIndexCache[versionId] = { cached: false, cachedTime: Date.now(), cachedPath: filePath, value: JSON.parse(data) as AssetIndex };
        } else {
            throw Error(`Response from "${assetIndex.url}" was "${response.status} ${response.statusText}"!`);
        }
    }
}

async function downloadAsset(versionId: string, assetPath: string): Promise<CachedResponse<Uint8Array>> {
    let assetIndex = (await downloadAssetIndex(versionId)).value;
    let asset = assetIndex.objects[assetPath];
    if (asset === undefined) {
        throw Error(`Asset "${assetPath}" does not exist on version ${versionId}!`)
    }

    let assetUrl = `${ASSET_URL}/${asset.hash.substring(0, 2)}/${asset.hash}`

    let filePath = path.join(ASSETS_CACHE_DIRECTORY, asset.hash.substring(0, 2), asset.hash.substring(2));
    if (fs.existsSync(filePath)) {
        let data = fs.readFileSync(filePath);

        return { cached: true, cachedTime: Date.now(), cachedPath: filePath, value: data };
    } else {
        let response = await Bun.fetch(assetUrl, {
            headers: {
                "User-Agent": USER_AGENT
            }
        });

        if (response.ok) {
            let data = await response.bytes();

            let hash = new Bun.CryptoHasher("sha1").update(data).digest("hex");
            if (hash !== asset.hash) {
                throw Error(`Hash of asset "${assetPath}" does not match! Expected "${asset.hash}" but got "${hash}".`);
            }

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, data);

            return { cached: false, cachedTime: Date.now(), cachedPath: filePath, value: data };
        } else {
            throw Error(`Response from "${assetUrl}" was "${response.status} ${response.statusText}"!`);
        }
    }
}

async function getAsset(versionId: string, assetPath: string): Promise<CachedResponse<undefined>> {
    let assetIndex = (await downloadAssetIndex(versionId)).value;
    let asset = assetIndex.objects[assetPath];
    if (asset === undefined) {
        throw Error(`Asset "${assetPath}" does not exist on version ${versionId}!`)
    }

    let assetUrl = `${ASSET_URL}/${asset.hash.substring(0, 2)}/${asset.hash}`

    let filePath = path.join(ASSETS_CACHE_DIRECTORY, asset.hash.substring(0, 2), asset.hash.substring(2));
    if (fs.existsSync(filePath)) {
        return { cached: true, cachedTime: Date.now(), cachedPath: filePath, value: undefined };
    } else {
        let response = await Bun.fetch(assetUrl, {
            headers: {
                "User-Agent": USER_AGENT
            }
        });

        if (response.ok) {
            let data = await response.bytes();

            let hash = new Bun.CryptoHasher("sha1").update(data).digest("hex");
            if (hash !== asset.hash) {
                throw Error(`Hash of asset "${assetPath}" does not match! Expected "${asset.hash}" but got "${hash}".`);
            }

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, data);

            return { cached: false, cachedTime: Date.now(), cachedPath: filePath, value: undefined };
        } else {
            throw Error(`Response from "${assetUrl}" was "${response.status} ${response.statusText}"!`);
        }
    }
}

interface Jar {
    size: number
    sha1: string
    entryCount: number
}

interface JarEntry {
    path: string
    isDirectory: boolean
    size: number
    sha1: string
}

interface JarDataEntry {
    data: Uint8Array
}

async function downloadJar(versionId: string, jarId: string, jarCallback: (entry: CachedResponse<Jar>) => void, entryCallback: (entry: CachedResponse<JarEntry & JarDataEntry>) => void): Promise<void> {
    let version = (await downloadVersion(versionId)).value;

    let jar = version.downloads[jarId];
    if (jar === undefined) {
        throw Error(`Jar "${jarId}" does not exist on version ${versionId}!`)
    }

    let filePath = path.join(PISTON_CACHE_DIRECTORY, jar.sha1.substring(0, 2), jar.sha1.substring(2));
    if (fs.existsSync(filePath)) {
        let data = fs.readFileSync(filePath);

        extractJarAndData(data, { cached: false, cachedTime: Date.now(), cachedPath: filePath, value: { size: data.length, sha1: jar.sha1, entryCount: -1 } }, jarCallback, entryCallback);
    } else {
        let response = await Bun.fetch(jar.url, {
            headers: {
                "User-Agent": USER_AGENT
            }
        });

        if (response.ok) {
            let data = await response.bytes();

            let hash = new Bun.CryptoHasher("sha1").update(data).digest("hex");
            if (hash !== jar.sha1) {
                throw Error(`Hash of jar "${jar.url}" does not match! Expected "${jar.sha1}" but got "${hash}".`);
            }

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, data);

            extractJarAndData(data, { cached: false, cachedTime: Date.now(), cachedPath: filePath, value: { size: data.length, sha1: jar.sha1, entryCount: -1 } }, jarCallback, entryCallback);
        } else {
            throw Error(`Response from "${jar.url}" was "${response.status} ${response.statusText}"!`);
        }
    }
}

async function getJar(versionId: string, jarId: string, jarCallback: (entry: CachedResponse<Jar>) => void, entryCallback: (entry: CachedResponse<JarEntry>) => void): Promise<void> {
    let version = (await downloadVersion(versionId)).value;

    let jar = version.downloads[jarId];
    if (jar === undefined) {
        throw Error(`Jar "${jarId}" does not exist on version ${versionId}!`)
    }

    let filePath = path.join(PISTON_CACHE_DIRECTORY, jar.sha1.substring(0, 2), jar.sha1.substring(2));
    if (fs.existsSync(filePath)) {
        let data = fs.readFileSync(filePath);

        extractJar(data, { cached: true, cachedTime: Date.now(), cachedPath: filePath, value: { size: data.length, sha1: jar.sha1, entryCount: -1 } }, jarCallback, entryCallback);
    } else {
        let response = await Bun.fetch(jar.url, {
            headers: {
                "User-Agent": USER_AGENT
            }
        });

        if (response.ok) {
            let data = await response.bytes();

            let hash = new Bun.CryptoHasher("sha1").update(data).digest("hex");
            if (hash !== jar.sha1) {
                throw Error(`Hash of jar "${jar.url}" does not match! Expected "${jar.sha1}" but got "${hash}".`);
            }

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, data);

            extractJar(data, { cached: false, cachedTime: Date.now(), cachedPath: filePath, value: { size: data.length, sha1: jar.sha1, entryCount: -1 } }, jarCallback, entryCallback);
        } else {
            throw Error(`Response from "${jar.url}" was "${response.status} ${response.statusText}"!`);
        }
    }
}

export { VERSION, CachedResponse, VersionList, Version, AssetIndex, downloadVersionList, downloadVersion, downloadAssetIndex, downloadAsset, getAsset, Jar, JarEntry, JarDataEntry, downloadJar, getJar };