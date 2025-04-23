import * as main from "./main.ts"
import * as fs from "fs";
import * as path from "path";

const CACHE_DIRECTORY = path.resolve("cache/");
const COMPLETION_CACHE_DIRECTORY = path.join(CACHE_DIRECTORY, "completion/");

const OUTPUT_DIRECTORY = path.resolve("out/");

fs.mkdirSync(CACHE_DIRECTORY, { recursive: true });
fs.mkdirSync(COMPLETION_CACHE_DIRECTORY, { recursive: true });
fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

(async () => {
    let versionList = (await main.downloadVersionList()).value;

    for (let versionInfo of versionList.versions) {
        let completionPath = path.join(COMPLETION_CACHE_DIRECTORY, versionInfo.sha1);
        if (fs.existsSync(completionPath)) {
            continue;
        }

        process.stdout.write(`Starting ${versionInfo.id}\n`);

        let assetIndex = (await main.downloadAssetIndex(versionInfo.id)).value;

        let done = 0;
        let total = Object.keys(assetIndex.objects).length;

        let interval = setInterval(() => {
            process.stdout.write(`\x1b[2K\x1b[1G${versionInfo.id} - ${done}/${total} (${Math.round((done / total) * 10000) / 100}%)`)
        }, 1000);

        for (let assetPath in assetIndex.objects) {
            let outputPath = path.join(OUTPUT_DIRECTORY, versionInfo.id, assetPath);

            let asset = (await main.downloadAsset(versionInfo.id, assetPath));

            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
            fs.linkSync(asset.cachedPath, outputPath);

            done++;
        }

        fs.writeFileSync(completionPath, "100\n", { encoding: "utf8" });

        clearInterval(interval);

        process.stdout.write(`\x1b[2K\x1b[1G${versionInfo.id} - ${done}/${total} (${Math.round((done / total) * 10000) / 100}%)`)
        process.stdout.write(`\n\n`);
    }
})();