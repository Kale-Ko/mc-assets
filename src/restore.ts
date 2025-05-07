import * as fs from "fs";
import * as path from "path";

const CACHE_DIRECTORY: string = path.resolve("cache/");

const OUTPUT_DIRECTORY: string = path.resolve("out/");

const RESTORE_DIRECTORY: string = path.join(CACHE_DIRECTORY, "restore/");

fs.mkdirSync(CACHE_DIRECTORY, { recursive: true });
fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

interface TaskInfo {
    taskDone: number,
    taskTotal: number,
    subTaskDone: number,
    subTaskTotal: number,
    currentTask: string | null
}

let lastPrint = 0;

function print(version: string, taskInfo: TaskInfo, forcePrint?: boolean): void {
    if (process.stdout.isTTY) {
        if (taskInfo.subTaskTotal !== -1) {
            process.stdout.write(`\x1b[2K\x1b[1G${version} - ${taskInfo.taskDone}/${taskInfo.taskTotal} (${Math.round((taskInfo.taskDone / taskInfo.taskTotal) * 10000) / 100}%) - ${taskInfo.currentTask} - ${taskInfo.subTaskDone}/${taskInfo.subTaskTotal} (${Math.round((taskInfo.subTaskDone / taskInfo.subTaskTotal) * 10000) / 100}%)`);
        } else {
            process.stdout.write(`\x1b[2K\x1b[1G${version} - ${taskInfo.taskDone}/${taskInfo.taskTotal} (${Math.round((taskInfo.taskDone / taskInfo.taskTotal) * 10000) / 100}%) - ${taskInfo.currentTask}`);
        }
    } else {
        if (Date.now() - lastPrint >= 1000 || forcePrint) {
            lastPrint = Date.now();

            if (taskInfo.subTaskTotal !== -1) {
                process.stdout.write(`${version} - ${taskInfo.taskDone}/${taskInfo.taskTotal} (${Math.round((taskInfo.taskDone / taskInfo.taskTotal) * 10000) / 100}%) - ${taskInfo.currentTask} - ${taskInfo.subTaskDone}/${taskInfo.subTaskTotal} (${Math.round((taskInfo.subTaskDone / taskInfo.subTaskTotal) * 10000) / 100}%)\n`);
            } else {
                process.stdout.write(`${version} - ${taskInfo.taskDone}/${taskInfo.taskTotal} (${Math.round((taskInfo.taskDone / taskInfo.taskTotal) * 10000) / 100}%) - ${taskInfo.currentTask}\n`);
            }
        }
    }
}

(async (): Promise<void> => {
    if (!fs.existsSync(RESTORE_DIRECTORY)) {
        return;
    }
    let restoreFiles = fs.readdirSync(RESTORE_DIRECTORY);

    for (let restoreFile of restoreFiles) {
        let restorePath: string = path.join(RESTORE_DIRECTORY, restoreFile);

        process.stdout.write(`Starting ${restoreFile}\n`);

        let taskInfo: TaskInfo = {
            taskDone: 0,
            taskTotal: 2,
            subTaskDone: 0,
            subTaskTotal: -1,
            currentTask: null
        };

        let interval: NodeJS.Timeout | undefined = undefined;
        if (process.stdout.isTTY) {
            interval = setInterval((): void => {
                print(restoreFile, taskInfo);
            }, 500);
        }

        taskInfo.currentTask = "reading restore file";
        print(restoreFile, taskInfo, true);

        let compressedRestoreList: Uint8Array = fs.readFileSync(restorePath);
        let decompressedRestoreList: Uint8Array = Bun.gunzipSync(compressedRestoreList, { library: "zlib" });
        let restoreList: string = new TextDecoder().decode(decompressedRestoreList);

        let restoreElements = restoreList.split("\n");

        taskInfo.taskDone++;
        taskInfo.currentTask = "restoring files";
        print(restoreFile, taskInfo, true);

        {
            taskInfo.subTaskDone = 0;
            taskInfo.subTaskTotal = restoreElements.length;
            print(restoreFile, taskInfo);

            for (let restoreElement of restoreElements) {
                if (restoreElement === "") {
                    taskInfo.subTaskDone++;
                    continue;
                }

                let tmp: string[] = restoreElement.split("\u0000", 2);
                let assetPath: string = path.join(CACHE_DIRECTORY, tmp[0]!);
                let outputPath: string = path.join(OUTPUT_DIRECTORY, restoreFile, tmp[1]!);

                fs.mkdirSync(path.dirname(outputPath), { recursive: true });
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
                fs.linkSync(assetPath, outputPath);

                taskInfo.subTaskDone++;
                if (taskInfo.subTaskDone % 200 === 0) {
                    print(restoreFile, taskInfo);
                }
            }

            print(restoreFile, taskInfo, true);
            taskInfo.subTaskDone = 0;
            taskInfo.subTaskTotal = -1;
        }

        taskInfo.taskDone++;
        taskInfo.currentTask = "finished";
        print(restoreFile, taskInfo, true);

        if (interval != undefined) {
            clearInterval(interval);
        }

        process.stdout.write(`\n\n`);
    }
})();