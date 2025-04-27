import * as main from "./main.ts"
import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";

const CACHE_DIRECTORY = path.resolve("cache/");
const COMPLETION_CACHE_DIRECTORY = path.join(CACHE_DIRECTORY, "completion/");

const OUTPUT_DIRECTORY = path.resolve("out/");

fs.mkdirSync(CACHE_DIRECTORY, { recursive: true });
fs.mkdirSync(COMPLETION_CACHE_DIRECTORY, { recursive: true });
fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

interface TaskInfo {
    taskDone: number,
    taskTotal: number,
    subTaskDone: number,
    subTaskTotal: number,
    currentTask: string | null
}

function print(versionInfo: main.VersionList["versions"][0], taskInfo: TaskInfo) {
    if (taskInfo.subTaskTotal != -1) {
        process.stdout.write(`\x1b[2K\x1b[1G${versionInfo.id} - ${taskInfo.taskDone}/${taskInfo.taskTotal} (${Math.round((taskInfo.taskDone / taskInfo.taskTotal) * 10000) / 100}%) - ${taskInfo.currentTask} - ${taskInfo.subTaskDone}/${taskInfo.subTaskTotal} (${Math.round((taskInfo.subTaskDone / taskInfo.subTaskTotal) * 10000) / 100}%)`);
    } else {
        process.stdout.write(`\x1b[2K\x1b[1G${versionInfo.id} - ${taskInfo.taskDone}/${taskInfo.taskTotal} (${Math.round((taskInfo.taskDone / taskInfo.taskTotal) * 10000) / 100}%) - ${taskInfo.currentTask}`);
    }
}

(async () => {
    let versionList = (await main.downloadVersionList()).value;

    for (let versionInfo of versionList.versions) {
        let completionPath = path.join(COMPLETION_CACHE_DIRECTORY, versionInfo.sha1);
        if (fs.existsSync(completionPath) && Date.now() - fs.statSync(completionPath).mtime.getTime() < 1000 * 60 * 30) {
            continue;
        }

        process.stdout.write(`Starting ${versionInfo.id}\n`);

        let taskInfo: TaskInfo = {
            taskDone: 0,
            taskTotal: 4,
            subTaskDone: 0,
            subTaskTotal: -1,
            currentTask: null
        };

        let interval = setInterval(() => {
            print(versionInfo, taskInfo);
        }, 500);

        taskInfo.currentTask = "downloading client jar";
        print(versionInfo, taskInfo);

        let clientJar = (await main.downloadDownloadable(versionInfo.id, "client")).value;

        taskInfo.taskDone++;
        taskInfo.currentTask = "extracting client jar";
        print(versionInfo, taskInfo);

        {
            let zip = new AdmZip(Buffer.from(clientJar));

            taskInfo.subTaskDone = 0;
            taskInfo.subTaskTotal = zip.getEntryCount();
            print(versionInfo, taskInfo);

            zip.forEach(entry => {
                let entryPath = entry.entryName;
                if (!entryPath.startsWith("assets/") && !entryPath.startsWith("data/")) {
                    return;
                }

                let outputPath = path.join(OUTPUT_DIRECTORY, versionInfo.id, entryPath);

                fs.mkdirSync(path.dirname(outputPath), { recursive: true });
                if (entry.isDirectory) {
                    fs.mkdirSync(outputPath, { recursive: true });
                } else {
                    if (fs.existsSync(outputPath)) {
                        fs.unlinkSync(outputPath);
                    }
                    fs.writeFileSync(outputPath, entry.getData());
                }

                taskInfo.subTaskDone++;
                if (taskInfo.subTaskDone % 100 === 0) {
                    print(versionInfo, taskInfo);
                }
            });

            print(versionInfo, taskInfo);
            taskInfo.subTaskDone = 0;
            taskInfo.subTaskTotal = -1;
        }

        taskInfo.taskDone++;
        taskInfo.currentTask = "downloading asset index";
        print(versionInfo, taskInfo);

        let assetIndex = (await main.downloadAssetIndex(versionInfo.id)).value;

        taskInfo.taskDone++;
        taskInfo.currentTask = "downloading assets";
        print(versionInfo, taskInfo);

        {
            taskInfo.subTaskDone = 0;
            taskInfo.subTaskTotal = Object.keys(assetIndex.objects).length;
            print(versionInfo, taskInfo);

            for (let assetPath in assetIndex.objects) {
                let outputPath = path.join(OUTPUT_DIRECTORY, versionInfo.id, "assets", assetPath);

                let asset = (await main.getAsset(versionInfo.id, assetPath));

                fs.mkdirSync(path.dirname(outputPath), { recursive: true });
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
                fs.linkSync(asset.cachedPath, outputPath);

                taskInfo.subTaskDone++;
                if (taskInfo.subTaskDone % 100 === 0) {
                    print(versionInfo, taskInfo);
                }
            }

            print(versionInfo, taskInfo);
            taskInfo.subTaskDone = 0;
            taskInfo.subTaskTotal = -1;
        }

        taskInfo.taskDone++;
        taskInfo.currentTask = "finished";
        print(versionInfo, taskInfo);

        fs.writeFileSync(completionPath, "100\n", { encoding: "utf8" });

        clearInterval(interval);

        process.stdout.write(`\n\n`);
    }
})();