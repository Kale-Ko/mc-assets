import * as main from "./main.ts"
import { z } from "zod";

const VersionListSchema = z.strictObject({
    latest: z.object({
        release: z.string(),
        snapshot: z.string(),
    }),
    versions: z.array(z.object({
        id: z.string(),
        type: z.enum(["release", "snapshot", "old_snapshot", "old_beta", "old_alpha", "experiment"]),
        url: z.string().url(),
        time: z.string(),
        releaseTime: z.string(),
        sha1: z.string(),
        complianceLevel: z.optional(z.union([z.literal(0), z.literal(1)])),
    })),
});

const VersionSchema = z.strictObject({
    id: z.string(),
    type: z.enum(["release", "snapshot", "old_snapshot", "old_beta", "old_alpha", "experiment"]),
    time: z.string(),
    releaseTime: z.string(),
    complianceLevel: z.optional(z.union([z.literal(0), z.literal(1)])),
    mainClass: z.string(),
    minimumLauncherVersion: z.number().int().positive(),
    javaVersion: z.optional(z.object({
        component: z.string(),
        majorVersion: z.number().int().positive(),
    })),
    arguments: z.optional(z.record(
        z.array(z.union([
            z.string(),
            z.object({
                value: z.union([z.string(), z.array(z.string())]),
                rules: z.optional(z.array(z.any())),
            })
        ]))
    )),
    minecraftArguments: z.optional(z.string()),
    downloads: z.record(z.object({
        sha1: z.string(),
        size: z.number().int().positive(),
        url: z.string().url(),
    })),
    libraries: z.array(z.object({
        name: z.string(),
        downloads: z.record(z.object({
            path: z.string(),
            sha1: z.string(),
            size: z.number().int().positive(),
            url: z.string().url(),
        })).or(z.object({
            classifiers: z.optional(z.record(z.object({
                path: z.string(),
                sha1: z.string(),
                size: z.number().int().positive(),
                url: z.string().url(),
            })))
        })),
        extract: z.optional(z.any()),
        natives: z.optional(z.record(z.string())),
        rules: z.optional(z.array(z.any())),
    })),
    logging: z.optional(z.record(z.object({
        type: z.string(),
        argument: z.string(),
        file: z.object({
            id: z.string(),
            sha1: z.string(),
            size: z.number().int().positive(),
            url: z.string().url(),
        }),
    }))),
    assets: z.string(),
    assetIndex: z.object({
        id: z.string(),
        sha1: z.string(),
        size: z.number().int().positive(),
        totalSize: z.number().int().positive(),
        url: z.string().url(),
    }),
});

const AssetIndexSchema = z.strictObject({
    map_to_resources: z.optional(z.boolean()),
    virtual: z.optional(z.boolean()),
    objects: z.record(z.object({
        hash: z.string(),
        size: z.number().int().positive()
    })),
});

function tryValidate(object: any, schema: z.ZodObject<any>, info: any) {
    try {
        schema.parse(object);
    } catch (e: any) {
        if (e instanceof z.ZodError) {
            for (let issue of e.issues) {
                if ("unionErrors" in issue) {
                    for (let e2 of issue.unionErrors) {
                        for (let subIssue of e2.issues) {
                            console.warn({ ...info, ...subIssue });

                            let p: any = object;
                            for (let path of subIssue.path) {
                                p = p[path];
                            }
                            console.log(p);
                        }
                    }
                } else {
                    console.warn({ ...info, ...issue });

                    let p: any = object;
                    for (let path of issue.path) {
                        p = p[path];
                    }
                    console.log(p);
                }
            }
        }
    }
}

(async () => {
    let versionList = (await main.downloadVersionList()).value;

    tryValidate(versionList, VersionListSchema, { "_file": "version_manifest_v2.json" });

    for (let versionInfo of versionList.versions) {
        let version = (await main.downloadVersion(versionInfo.id)).value;

        tryValidate(version, VersionSchema, { "_version": versionInfo.id, "_file": versionInfo.sha1 });

        {
            let assetIndex = (await main.downloadAssetIndex(versionInfo.id)).value;

            tryValidate(assetIndex, AssetIndexSchema, { "_version": versionInfo.id, "_assetIndex": version.assetIndex.id, "_file": version.assetIndex.sha1 });
        }
    }
})();