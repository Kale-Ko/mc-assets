import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";

const VERSION: string = "1.0.0";
const USER_AGENT: string = `Bun/${Bun.version} ms-asset-downloader/${VERSION}`;
const HOME_URL: string = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const ASSET_URL: string = "https://resources.download.minecraft.net";

const PATCHES_DIRECTORY: string = path.resolve("patches/");

const CACHE_DIRECTORY: string = path.resolve("cache/");
const PISTON_CACHE_DIRECTORY: string = path.join(CACHE_DIRECTORY, "piston/");
const ASSETS_CACHE_DIRECTORY: string = path.join(CACHE_DIRECTORY, "assets/");

fs.mkdirSync(PATCHES_DIRECTORY, { recursive: true });
fs.mkdirSync(CACHE_DIRECTORY, { recursive: true });
fs.mkdirSync(PISTON_CACHE_DIRECTORY, { recursive: true });
fs.mkdirSync(ASSETS_CACHE_DIRECTORY, { recursive: true });

const argv = Bun.argv.map(arg => arg.toLowerCase().trim());
const force: boolean = argv.includes("--force") || argv.includes("-f");
const cacheJars: boolean = argv.includes("--cache-jars") || argv.includes("-j");

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
        /**
         * Is altered for pre releases for 1.14 - 1.14.2 to conform to the standard format
         */
        id: string
        type: "release" | "snapshot" | "old_snapshot" | "old_beta" | "old_alpha" | "experiment"
        url: string
        time: string
        releaseTime: string
        sha1: string
        complianceLevel?: 0 | 1
    }[]
}

function processVersionList(versionList: VersionList, patchVersionList?: VersionList): VersionList {
    if (patchVersionList != undefined) {
        versionList = patch(versionList, patchVersionList) as VersionList;
    }

    for (let i: number = 0; i < versionList.versions.length; i++) {
        let version: VersionList["versions"][0] = versionList.versions[i]!;
        version.id = version.id.replace(" Pre-Release ", "-pre");
        if (/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/g.test(version.id)) {
            version.type = "release";
        }
        else if (/^[0-9]+w[0-9]+[a-z]$/g.test(version.id)
            || /^[0-9]+\.[0-9]+(?:\.[0-9]+)?-(?:pre|rc)[0-9]+$/g.test(version.id)) {
            version.type = "snapshot";
        }
        versionList.versions[i] = version;
    }

    return versionList;
}

interface Version {
    /**
     * Is altered for pre releases for 1.14 - 1.14.2 to conform to the standard format
     */
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

function processVersion(version: Version): Version {
    version.id = version.id.replace(" Pre-Release ", "-pre");
    if (/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/g.test(version.id)) {
        version.type = "release";
    }
    else if (/^[0-9]+w[0-9]+[a-z]$/g.test(version.id)
        || /^[0-9]+\.[0-9]+(?:\.[0-9]+)?-(?:pre|rc)[0-9]+$/g.test(version.id)) {
        version.type = "snapshot";
    }
    return version;
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

async function downloadVersionList(): Promise<CachedResponse<VersionList>> {
    if (versionListCache !== undefined && Date.now() - versionListCache.cachedTime < 1000 * 60 * 1) {
        return versionListCache;
    }

    let filePath: string = path.join(PISTON_CACHE_DIRECTORY, "version_manifest_v2.json");
    if (fs.existsSync(filePath) && Date.now() - fs.statSync(filePath).mtime.getTime() < 1000 * 60 * 30) {
        let data: string = fs.readFileSync(filePath, { encoding: "utf8" });

        let patchPath = path.join(PATCHES_DIRECTORY, "version_manifest_v2.json");
        let patches: VersionList | undefined = undefined;
        if (fs.existsSync(patchPath)) {
            let patchData: string = fs.readFileSync(patchPath, { encoding: "utf8" });
            patches = JSON.parse(patchData) as VersionList;
        }

        return versionListCache = { cached: true, cachedTime: Date.now(), cachedPath: filePath, value: processVersionList(JSON.parse(data) as VersionList, patches) };
    } else {
        let response: Response = await Bun.fetch(HOME_URL, {
            headers: {
                "Accept": "application/json",
                "User-Agent": USER_AGENT
            }
        });

        if (response.ok) {
            let data: string = await response.text();

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, data, { encoding: "utf8" });

            let patchPath = path.join(PATCHES_DIRECTORY, "version_manifest_v2.json");
            let patches: VersionList | undefined = undefined;
            if (fs.existsSync(patchPath)) {
                let patchData: string = fs.readFileSync(patchPath, { encoding: "utf8" });
                patches = JSON.parse(patchData) as VersionList;
            }

            return versionListCache = { cached: false, cachedTime: Date.now(), cachedPath: filePath, value: processVersionList(JSON.parse(data) as VersionList, patches) };
        } else {
            throw Error(`Response from "${HOME_URL}" was "${response.status} ${response.statusText}"!`);
        }
    }
}

async function downloadVersion(versionId: string): Promise<CachedResponse<Version>> {
    if (versionCache[versionId] !== undefined && Date.now() - versionCache[versionId].cachedTime < 1000 * 60 * 1) {
        return versionCache[versionId];
    }

    let versionList: VersionList = (await downloadVersionList()).value;

    let versionInfo: VersionList["versions"][0] | undefined = versionList.versions.find((version: VersionList["versions"][0]): boolean => version.id === versionId);
    if (versionInfo === undefined) {
        throw Error(`Could not find version "${versionId}"!`);
    }

    let filePath: string = path.join(PISTON_CACHE_DIRECTORY, versionInfo.sha1.substring(0, 2), versionInfo.sha1.substring(2));
    if (fs.existsSync(filePath)) {
        let data: string = fs.readFileSync(filePath, { encoding: "utf8" });

        return versionCache[versionId] = { cached: true, cachedTime: Date.now(), cachedPath: filePath, value: processVersion(JSON.parse(data) as Version) };
    } else {
        let response: Response = await Bun.fetch(versionInfo.url, {
            headers: {
                "Accept": "application/json",
                "User-Agent": USER_AGENT
            }
        });

        if (response.ok) {
            let data: string = await response.text();

            let hash: string = new Bun.CryptoHasher("sha1").update(data).digest("hex");
            if (hash !== versionInfo.sha1) {
                throw Error(`Hash of version "${versionInfo.url}" does not match! Expected "${versionInfo.sha1}" but got "${hash}".`);
            }

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, data, { encoding: "utf8" });

            return versionCache[versionId] = { cached: false, cachedTime: Date.now(), cachedPath: filePath, value: processVersion(JSON.parse(data) as Version) };
        } else {
            throw Error(`Response from "${versionInfo.url}" was "${response.status} ${response.statusText}"!`);
        }
    }
}

async function downloadAssetIndex(versionId: string): Promise<CachedResponse<AssetIndex>> {
    if (assetIndexCache[versionId] !== undefined && Date.now() - assetIndexCache[versionId].cachedTime < 1000 * 60 * 1) {
        return assetIndexCache[versionId];
    }

    let version: Version = (await downloadVersion(versionId)).value;

    let assetIndex: Version["assetIndex"] = version.assetIndex;

    let filePath: string = path.join(PISTON_CACHE_DIRECTORY, assetIndex.sha1.substring(0, 2), assetIndex.sha1.substring(2));
    if (fs.existsSync(filePath)) {
        let data: string = fs.readFileSync(filePath, { encoding: "utf8" });

        return assetIndexCache[versionId] = { cached: true, cachedTime: Date.now(), cachedPath: filePath, value: JSON.parse(data) as AssetIndex };
    } else {
        let response: Response = await Bun.fetch(assetIndex.url, {
            headers: {
                "Accept": "application/json",
                "User-Agent": USER_AGENT
            }
        });

        if (response.ok) {
            let data: string = await response.text();

            let hash: string = new Bun.CryptoHasher("sha1").update(data).digest("hex");
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
    let assetIndex: AssetIndex = (await downloadAssetIndex(versionId)).value;
    let asset: AssetIndex["objects"][0] | undefined = assetIndex.objects[assetPath];
    if (asset === undefined) {
        throw Error(`Asset "${assetPath}" does not exist on version ${versionId}!`)
    }

    let assetUrl: string = `${ASSET_URL}/${asset.hash.substring(0, 2)}/${asset.hash}`

    let filePath: string = path.join(ASSETS_CACHE_DIRECTORY, asset.hash.substring(0, 2), asset.hash.substring(2));
    if (fs.existsSync(filePath)) {
        let data: Uint8Array = fs.readFileSync(filePath);

        return { cached: true, cachedTime: Date.now(), cachedPath: filePath, value: data };
    } else {
        let response: Response = await Bun.fetch(assetUrl, {
            headers: {
                "User-Agent": USER_AGENT
            }
        });

        if (response.ok) {
            let data: Uint8Array = await response.bytes();

            let hash: string = new Bun.CryptoHasher("sha1").update(data).digest("hex");
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
    let assetIndex: AssetIndex = (await downloadAssetIndex(versionId)).value;
    let asset: AssetIndex["objects"][0] | undefined = assetIndex.objects[assetPath];
    if (asset === undefined) {
        throw Error(`Asset "${assetPath}" does not exist on version ${versionId}!`)
    }

    let assetUrl: string = `${ASSET_URL}/${asset.hash.substring(0, 2)}/${asset.hash}`

    let filePath: string = path.join(ASSETS_CACHE_DIRECTORY, asset.hash.substring(0, 2), asset.hash.substring(2));
    if (fs.existsSync(filePath)) {
        return { cached: true, cachedTime: Date.now(), cachedPath: filePath, value: undefined };
    } else {
        let response: Response = await Bun.fetch(assetUrl, {
            headers: {
                "User-Agent": USER_AGENT
            }
        });

        if (response.ok) {
            let data: Uint8Array = await response.bytes();

            let hash: string = new Bun.CryptoHasher("sha1").update(data).digest("hex");
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

async function downloadJar(versionId: string, jarId: string, jarCallback: (entry: CachedResponse<Jar>) => void, entryCallback: (entry?: CachedResponse<JarEntry & JarDataEntry>) => void): Promise<void> {
    let version: Version = (await downloadVersion(versionId)).value;

    let jar: Version["downloads"][0] | undefined = version.downloads[jarId];
    if (jar === undefined) {
        throw Error(`Jar "${jarId}" does not exist on version ${versionId}!`)
    }

    let filePath: string = path.join(PISTON_CACHE_DIRECTORY, jar.sha1.substring(0, 2), jar.sha1.substring(2));
    if (fs.existsSync(filePath)) {
        let data: Uint8Array = fs.readFileSync(filePath);

        extractJarAndData(data, { cached: false, cachedTime: Date.now(), cachedPath: filePath, value: { size: data.length, sha1: jar.sha1, entryCount: -1 } }, jarCallback, entryCallback);
    } else {
        let response: Response = await Bun.fetch(jar.url, {
            headers: {
                "User-Agent": USER_AGENT
            }
        });

        if (response.ok) {
            let data: Uint8Array = await response.bytes();

            let hash: string = new Bun.CryptoHasher("sha1").update(data).digest("hex");
            if (hash !== jar.sha1) {
                throw Error(`Hash of jar "${jar.url}" does not match! Expected "${jar.sha1}" but got "${hash}".`);
            }

            if (cacheJars) {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, data);
            }

            extractJarAndData(data, { cached: false, cachedTime: Date.now(), cachedPath: filePath, value: { size: data.length, sha1: jar.sha1, entryCount: -1 } }, jarCallback, entryCallback);
        } else {
            throw Error(`Response from "${jar.url}" was "${response.status} ${response.statusText}"!`);
        }
    }
}

async function getJar(versionId: string, jarId: string, jarCallback: (entry: CachedResponse<Jar>) => void, entryCallback: (entry?: CachedResponse<JarEntry>) => void): Promise<void> {
    let version: Version = (await downloadVersion(versionId)).value;

    let jar: Version["downloads"][0] | undefined = version.downloads[jarId];
    if (jar === undefined) {
        throw Error(`Jar "${jarId}" does not exist on version ${versionId}!`)
    }

    let filePath: string = path.join(PISTON_CACHE_DIRECTORY, jar.sha1.substring(0, 2), jar.sha1.substring(2));
    if (fs.existsSync(filePath)) {
        let data: Uint8Array = fs.readFileSync(filePath);

        extractJar(data, { cached: true, cachedTime: Date.now(), cachedPath: filePath, value: { size: data.length, sha1: jar.sha1, entryCount: -1 } }, jarCallback, entryCallback);
    } else {
        let response: Response = await Bun.fetch(jar.url, {
            headers: {
                "User-Agent": USER_AGENT
            }
        });

        if (response.ok) {
            let data: Uint8Array = await response.bytes();

            let hash: string = new Bun.CryptoHasher("sha1").update(data).digest("hex");
            if (hash !== jar.sha1) {
                throw Error(`Hash of jar "${jar.url}" does not match! Expected "${jar.sha1}" but got "${hash}".`);
            }

            if (cacheJars) {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, data);
            }

            extractJar(data, { cached: false, cachedTime: Date.now(), cachedPath: filePath, value: { size: data.length, sha1: jar.sha1, entryCount: -1 } }, jarCallback, entryCallback);
        } else {
            throw Error(`Response from "${jar.url}" was "${response.status} ${response.statusText}"!`);
        }
    }
}

function extractJarAndData(data: Uint8Array, response: CachedResponse<Jar>, jarCallback: (entry: CachedResponse<Jar>) => void, entryCallback: (entry?: CachedResponse<JarEntry & JarDataEntry>) => void): void {
    let zip: AdmZip = new AdmZip(Buffer.from(data));

    jarCallback({ ...response, value: { ...response.value, entryCount: zip.getEntries().length } });

    zip.forEach((entry: AdmZip.IZipEntry): void => {
        if (!(entry.entryName.startsWith("assets/") || entry.entryName.startsWith("data/") || (!entry.entryName.startsWith("META-INF/") && !entry.entryName.endsWith(".class")))) {
            entryCallback(undefined);
            return;
        }

        let hash: string = new Bun.CryptoHasher("sha1").update(entry.getData()).digest("hex");

        let filePath: string = path.join(ASSETS_CACHE_DIRECTORY, hash.substring(0, 2), hash.substring(2));
        if (!fs.existsSync(filePath)) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, entry.getData());

            entryCallback({ cached: false, cachedTime: Date.now(), cachedPath: filePath, value: { path: entry.entryName, isDirectory: entry.isDirectory, size: entry.header.size, sha1: hash, data: entry.getData() } });
        } else {
            entryCallback({ cached: true, cachedTime: Date.now(), cachedPath: filePath, value: { path: entry.entryName, isDirectory: entry.isDirectory, size: entry.header.size, sha1: hash, data: entry.getData() } });
        }
    });
}

function extractJar(data: Uint8Array, response: CachedResponse<Jar>, jarCallback: (entry: CachedResponse<Jar>) => void, entryCallback: (entry?: CachedResponse<JarEntry>) => void): void {
    let zip: AdmZip = new AdmZip(Buffer.from(data));

    jarCallback({ ...response, value: { ...response.value, entryCount: zip.getEntries().length } });

    zip.forEach((entry: AdmZip.IZipEntry): void => {
        if (!(entry.entryName.startsWith("assets/") || entry.entryName.startsWith("data/") || (!entry.entryName.startsWith("META-INF/") && !entry.entryName.endsWith(".class")))) {
            entryCallback(undefined);
            return;
        }

        let hash: string = new Bun.CryptoHasher("sha1").update(entry.getData()).digest("hex");

        let filePath: string = path.join(ASSETS_CACHE_DIRECTORY, hash.substring(0, 2), hash.substring(2));
        if (!fs.existsSync(filePath)) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, entry.getData());

            entryCallback({ cached: false, cachedTime: Date.now(), cachedPath: filePath, value: { path: entry.entryName, isDirectory: entry.isDirectory, size: entry.header.size, sha1: hash } });
        } else {
            entryCallback({ cached: true, cachedTime: Date.now(), cachedPath: filePath, value: { path: entry.entryName, isDirectory: entry.isDirectory, size: entry.header.size, sha1: hash } });
        }
    });
}

export { VERSION, CachedResponse, VersionList, Version, AssetIndex, downloadVersionList, downloadVersion, downloadAssetIndex, downloadAsset, getAsset, Jar, JarEntry, JarDataEntry, downloadJar, getJar };