import * as main from "./main.ts"
import * as fs from "fs";
import * as path from "path";

const CACHE_DIRECTORY: string = path.resolve("cache/");
const COMPLETION_CACHE_DIRECTORY: string = path.join(CACHE_DIRECTORY, "completion/");

const OUTPUT_DIRECTORY: string = path.resolve("out/");

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

let lastPrint = 0;

function print(versionInfo: main.VersionList["versions"][0], taskInfo: TaskInfo, forcePrint?: boolean): void {
    if (process.stdout.isTTY) {
        if (taskInfo.subTaskTotal !== -1) {
            process.stdout.write(`\x1b[2K\x1b[1G${versionInfo.id} - ${taskInfo.taskDone}/${taskInfo.taskTotal} (${Math.round((taskInfo.taskDone / taskInfo.taskTotal) * 10000) / 100}%) - ${taskInfo.currentTask} - ${taskInfo.subTaskDone}/${taskInfo.subTaskTotal} (${Math.round((taskInfo.subTaskDone / taskInfo.subTaskTotal) * 10000) / 100}%)`);
        } else {
            process.stdout.write(`\x1b[2K\x1b[1G${versionInfo.id} - ${taskInfo.taskDone}/${taskInfo.taskTotal} (${Math.round((taskInfo.taskDone / taskInfo.taskTotal) * 10000) / 100}%) - ${taskInfo.currentTask}`);
        }
    } else {
        if (Date.now() - lastPrint >= 1000 || forcePrint) {
            lastPrint = Date.now();

            if (taskInfo.subTaskTotal !== -1) {
                process.stdout.write(`${versionInfo.id} - ${taskInfo.taskDone}/${taskInfo.taskTotal} (${Math.round((taskInfo.taskDone / taskInfo.taskTotal) * 10000) / 100}%) - ${taskInfo.currentTask} - ${taskInfo.subTaskDone}/${taskInfo.subTaskTotal} (${Math.round((taskInfo.subTaskDone / taskInfo.subTaskTotal) * 10000) / 100}%)\n`);
            } else {
                process.stdout.write(`${versionInfo.id} - ${taskInfo.taskDone}/${taskInfo.taskTotal} (${Math.round((taskInfo.taskDone / taskInfo.taskTotal) * 10000) / 100}%) - ${taskInfo.currentTask}\n`);
            }
        }
    }
}

const argv = Bun.argv.map(arg => arg.toLowerCase().trim());
const force: boolean = argv.includes("--force") || argv.includes("-f");

(async (): Promise<void> => {
    let versionList: main.VersionList = (await main.downloadVersionList()).value;

    for (let versionInfo of versionList.versions) {
        let completionPath: string = path.join(COMPLETION_CACHE_DIRECTORY, versionInfo.sha1);
        if ((!force && fs.existsSync(completionPath)) || (fs.existsSync(completionPath) && Date.now() - fs.statSync(completionPath).mtime.getTime() < 1000 * 60 * 30)) {
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

        taskInfo.currentTask = "downloading client jar";
        print(versionInfo, taskInfo, true);

        {
            await main.downloadJar(versionInfo.id, "client", (jar: main.CachedResponse<main.Jar>): void => {
                taskInfo.taskDone++;
                taskInfo.currentTask = "extracting client jar";
                print(versionInfo, taskInfo, true);

                taskInfo.subTaskDone = 0;
                taskInfo.subTaskTotal = jar.value.entryCount;
                print(versionInfo, taskInfo);
            }, (entry?: main.CachedResponse<main.JarEntry>): void => {
                if (entry !== undefined) {
                    let entryPath: string = entry.value.path;
                    let outputPath: string = path.join(OUTPUT_DIRECTORY, versionInfo.id, entryPath);

                    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
                    if (entry.value.isDirectory) {
                        fs.mkdirSync(outputPath, { recursive: true });
                    } else {
                        if (fs.existsSync(outputPath)) {
                            fs.unlinkSync(outputPath);
                        }
                        fs.linkSync(entry.cachedPath, outputPath);
                    }
                }

                taskInfo.subTaskDone++;
                if (taskInfo.subTaskDone % 200 === 0) {
                    print(versionInfo, taskInfo);
                }
            });

            print(versionInfo, taskInfo, true);
            taskInfo.subTaskDone = 0;
            taskInfo.subTaskTotal = -1;
        }

        taskInfo.taskDone++;
        taskInfo.currentTask = "downloading asset index";
        print(versionInfo, taskInfo, true);

        let assetIndex: main.AssetIndex = (await main.downloadAssetIndex(versionInfo.id)).value;

        taskInfo.taskDone++;
        taskInfo.currentTask = "downloading assets";
        print(versionInfo, taskInfo, true);

        {
            taskInfo.subTaskDone = 0;
            taskInfo.subTaskTotal = Object.keys(assetIndex.objects).length;
            print(versionInfo, taskInfo);

            for (let assetPath in assetIndex.objects) {
                let outputPath: string = path.join(OUTPUT_DIRECTORY, versionInfo.id, "assets", assetPath);

                let asset: main.CachedResponse<undefined> = (await main.getAsset(versionInfo.id, assetPath));

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

            print(versionInfo, taskInfo, true);
            taskInfo.subTaskDone = 0;
            taskInfo.subTaskTotal = -1;
        }

        taskInfo.taskDone++;
        taskInfo.currentTask = "finished";
        print(versionInfo, taskInfo, true);

        fs.writeFileSync(completionPath, "100\n", { encoding: "utf8" });

        process.stdout.write(`\n\n`);
    }
})();