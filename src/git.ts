import * as main from "./main.ts"
import * as fs from "fs";
import * as path from "path";

const GIT_URL: string = "https://github.com/Kale-Ko/mc-assets";
const INITIAL_GIT_MESSAGE: string = "Initial upload of version: {versionSha}\nAsset index: {assetIndexSha}";
const GIT_MESSAGE: string = "Upload of version: {versionSha}\nAsset index: {assetIndexSha}";

const CACHE_DIRECTORY: string = path.resolve("cache/");
const COMPLETION_CACHE_DIRECTORY: string = path.join(CACHE_DIRECTORY, "completion/");
const GIT_COMPLETION_CACHE_DIRECTORY: string = path.join(CACHE_DIRECTORY, "git-completion/");

const OUTPUT_DIRECTORY: string = path.resolve("out/");

const GIT_DIRECTORY: string = path.resolve("git/");

fs.mkdirSync(CACHE_DIRECTORY, { recursive: true });
fs.mkdirSync(COMPLETION_CACHE_DIRECTORY, { recursive: true });
fs.mkdirSync(GIT_COMPLETION_CACHE_DIRECTORY, { recursive: true });
fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
fs.mkdirSync(GIT_DIRECTORY, { recursive: true });

const argv = Bun.argv.map(arg => arg.toLowerCase().trim());
const force: boolean = argv.includes("--force") || argv.includes("-f");

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

function versionToGitTag(version: string): string {
    return version.replaceAll(/[^a-zA-Z0-9-_]/g, "_").toLowerCase();
}

(async (): Promise<void> => {
    const mainDirectory: string = path.join(GIT_DIRECTORY, "main");
    if (!fs.existsSync(mainDirectory)) {
        await Bun.$`git clone --origin origin --branch main --single-branch '${GIT_URL}' '${mainDirectory}'`.cwd(GIT_DIRECTORY).quiet();
    } else {
        await Bun.$`git fetch origin`.cwd(mainDirectory).quiet();
    }

    let versionList: main.VersionList = (await main.downloadVersionList()).value;

    for (let versionInfo of versionList.versions) {
        let completionPath: string = path.join(COMPLETION_CACHE_DIRECTORY, versionInfo.sha1);
        let gitCompletionPath: string = path.join(GIT_COMPLETION_CACHE_DIRECTORY, versionInfo.sha1);
        if (!fs.existsSync(completionPath)) {
            throw Error(`${versionInfo.id} has not been output!`);
        }
        if (fs.existsSync(gitCompletionPath) && fs.statSync(completionPath).mtime.getTime() <= fs.statSync(gitCompletionPath).mtime.getTime()) {
            continue;
        }

        process.stdout.write(`Starting ${versionInfo.id} \n`);

        let taskInfo: TaskInfo = {
            taskDone: 0,
            taskTotal: 7,
            subTaskDone: 0,
            subTaskTotal: -1,
            currentTask: null
        };

        let interval: NodeJS.Timeout | undefined = undefined;
        if (process.stdout.isTTY) {
            interval = setInterval((): void => {
                print(versionInfo, taskInfo);
            }, 500);
        }

        taskInfo.currentTask = "creating branch";
        print(versionInfo, taskInfo, true);

        let tag: string = versionToGitTag(versionInfo.id);

        let branchesRaw: string = await Bun.$`git ls-remote --branches --quiet | awk '{print $2}'`.cwd(mainDirectory).text();
        let branches: string[] = branchesRaw.toLowerCase().trim().split("\n");
        if (!branches.includes("refs/heads/" + tag.toLowerCase())) {
            // Create completely empty new branch
            await Bun.$`git switch --orphan '${tag}'`.cwd(mainDirectory).quiet();
            await Bun.$`git commit --allow-empty --message 'Init'`.cwd(mainDirectory).quiet();
            await Bun.$`git push --set-upstream origin '${tag}'`.cwd(mainDirectory).quiet();

            // Delete the branch in the local repo
            await Bun.$`git switch 'main'`.cwd(mainDirectory).quiet();
            await Bun.$`git branch --delete --force '${tag}'`.cwd(mainDirectory).quiet();
        }

        taskInfo.taskDone++;
        taskInfo.currentTask = "cloning repository";
        print(versionInfo, taskInfo, true);

        let outPath: string = path.join(OUTPUT_DIRECTORY, versionInfo.id);
        let repoPath: string = path.join(GIT_DIRECTORY, versionInfo.id);

        if (fs.existsSync(repoPath)) {
            let mounted: string = await Bun.$`mount | grep '${repoPath}' | awk '{ print $3 }'`.text();
            for (let mount of mounted.trim().split("\n")) {
                if (mount.trim() === "") {
                    continue;
                }
                await Bun.$`fusermount -u '${mount.trim()}'`;
            }

            fs.rmSync(repoPath, { recursive: true });
        }
        await Bun.$`git clone --origin origin --branch '${tag}' --single-branch '${GIT_URL}' '${repoPath}'`.cwd(GIT_DIRECTORY).quiet();

        taskInfo.taskDone++;
        taskInfo.currentTask = "copying files";
        print(versionInfo, taskInfo, true);

        {
            async function mount(dir: string): Promise<void> {
                let files: string[] = fs.readdirSync(path.join(outPath, dir));
                for (let file of files) {
                    let fromPath: string = path.join(outPath, dir, file);
                    let fromStat: fs.Stats = fs.statSync(fromPath);
                    let toPath: string = path.join(repoPath, dir, file);
                    if (fromStat.isDirectory()) {
                        fs.mkdirSync(toPath, { recursive: true });
                        // await Bun.$`mount --bind '${fromPath}' '${toPath}'`;
                        await Bun.$`bindfs -o nonempty --no-allow-other '${fromPath}' '${toPath}'`;
                    } else if (fromStat.isFile()) {
                        fs.mkdirSync(path.dirname(toPath), { recursive: true });
                        if (fs.existsSync(toPath)) {
                            fs.unlinkSync(toPath);
                        }
                        fs.linkSync(fromPath, toPath);
                    }
                }
            }

            async function unmount(dir: string): Promise<void> {
                let files: string[] = fs.readdirSync(path.join(outPath, dir));
                for (let file of files) {
                    if (fs.statSync(path.join(outPath, dir, file)).isDirectory()) {
                        // await Bun.$`umount '${path.join(repoPath, dir, file)}'`;
                        await Bun.$`fusermount -u '${path.join(repoPath, dir, file)}'`;
                    }
                }
            }

            // function copy(dir: string): void {
            //     let files: string[] = fs.readdirSync(path.join(outPath, dir));
            //     for (let file of files) {
            //         let fromPath: string = path.join(outPath, dir, file);
            //         let fromStat: fs.Stats = fs.statSync(fromPath);
            //         if (fromStat.isFile()) {
            //             let toPath: string = path.join(repoPath, dir, file);

            //             fs.mkdirSync(path.dirname(toPath), { recursive: true });
            //             if (fs.existsSync(toPath)) {
            //                 fs.unlinkSync(toPath);
            //             }
            //             fs.linkSync(fromPath, toPath);
            //         } else if (fromStat.isDirectory()) {
            //             copy(path.join(dir, file));
            //         }
            //     }
            // }

            function rmdir(dir: string): void {
                let files: string[] = fs.readdirSync(dir);
                for (let file of files) {
                    if (file === '.git') {
                        continue;
                    }
                    let fromPath: string = path.join(dir, file);
                    fs.rmSync(fromPath, { recursive: true });
                }
            }

            rmdir(repoPath);

            await mount(".");

            taskInfo.taskDone++;
            taskInfo.currentTask = "adding files";
            print(versionInfo, taskInfo, true);

            let amend: boolean = (await Bun.$`git log --max-count 1 --pretty='%s'`.cwd(repoPath).text()).trim() === "Init";

            let message: string = amend ? INITIAL_GIT_MESSAGE : GIT_MESSAGE;
            message = message.replace("{versionId}", versionInfo.id);
            message = message.replace("{versionSha}", versionInfo.sha1);
            if (message.includes("{assetIndexSha}")) {
                message = message.replace("{assetIndexSha}", (await main.downloadVersion(versionInfo.id)).value.assetIndex.sha1);
            }

            await Bun.$`git add .`.cwd(repoPath).quiet();

            taskInfo.taskDone++;
            taskInfo.currentTask = "committing files";
            print(versionInfo, taskInfo, true);

            async function tryCommit(count?: number): Promise<void> {
                let commit: Bun.$.ShellOutput = await Bun.$`git commit ${amend ? "--amend" : ""} --all --message '${message}'`.cwd(repoPath).quiet().nothrow();
                let output: string = await commit.text();
                if (commit.exitCode !== 0 && !output.match(/^nothing to commit, working tree clean$/im) !== null) {
                    if (count != undefined && count >= 3) {
                        throw Error(`Failed to commit:\n${output}`);
                    }

                    tryCommit(count != undefined ? count + 1 : 1);
                }
            }

            await tryCommit();

            taskInfo.taskDone++;
            taskInfo.currentTask = "pushing files";
            print(versionInfo, taskInfo, true);

            async function tryPush(count?: number): Promise<void> {
                let push: Bun.$.ShellOutput = await Bun.$`git push ${amend ? "--force-with-lease" : ""} origin ${tag}`.cwd(repoPath).quiet().nothrow();
                let output: string = await push.text();
                if (push.exitCode !== 0 && !output.match(/^Everything up-to-date$/im) !== null) {
                    if (count != undefined && count >= 3) {
                        throw Error(`Failed to push:\n${output}`);
                    }

                    tryPush(count != undefined ? count + 1 : 1);
                }
            }

            await tryPush();

            taskInfo.taskDone++;
            taskInfo.currentTask = "cleaning up";
            print(versionInfo, taskInfo, true);

            await unmount(".");
        }

        fs.rmSync(repoPath, { recursive: true });

        taskInfo.taskDone++;
        taskInfo.currentTask = "finished";
        print(versionInfo, taskInfo, true);

        fs.writeFileSync(gitCompletionPath, "100\n", { encoding: "utf8" });

        if (interval != undefined) {
            clearInterval(interval);
        }

        process.stdout.write(`\n\n`);
    }
})();