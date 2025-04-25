import * as main from "./main.ts"
import * as fs from "fs";
import * as path from "path";

const GIT_URL = "https://github.com/Kale-Ko/mc-assets.git";
const GIT_MESSAGE = "Initial upload of asset index: {assetIndexSha}";
// const GIT_MESSAGE = "Upload of version: {versionSha}\nAsset index: {assetIndexSha}";

const OUTPUT_DIRECTORY = path.resolve("out/");
const GIT_DIRECTORY = path.resolve("git/");

fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
fs.mkdirSync(GIT_DIRECTORY, { recursive: true });

function versionToGitTag(version: string): string {
    return version.replaceAll(/[^a-zA-Z0-9-_]/g, "_");
}

(async () => {
    const mainPath = path.join(GIT_DIRECTORY, "main");
    if (!fs.existsSync(mainPath)) {
        await Bun.$`git clone --origin origin --branch main --single-branch '${GIT_URL}' '${mainPath}'`.cwd(GIT_DIRECTORY).quiet();
    } else {
        await Bun.$`git fetch origin`.cwd(mainPath).quiet();
    }

    let versionList = (await main.downloadVersionList()).value;

    for (let versionInfo of versionList.versions) {
        process.stdout.write(`Starting ${versionInfo.id} \n`);

        let task: string | null = null;
        let done = 0;
        let total = 6;

        let interval = setInterval(() => {
            process.stdout.write(`\x1b[2K\x1b[1G${versionInfo.id} - ${task} - ${Math.round((done / total) * 10000) / 100}%`);
        }, 500);

        task = "creating branch";

        let tag = versionToGitTag(versionInfo.id);

        let output = await Bun.$`git ls-remote --branches --quiet | awk '{print $2}'`.cwd(mainPath).text();
        let branches = output.toLowerCase().trim().split("\n");
        if (!(branches.includes(tag.toLowerCase()) || branches.includes("refs/heads/" + tag.toLowerCase()))) {
            // Create completely empty new branch
            await Bun.$`git switch --orphan '${tag}'`.cwd(mainPath).quiet();
            await Bun.$`git commit --allow-empty --message 'Init'`.cwd(mainPath).quiet();
            await Bun.$`git push --set-upstream origin '${tag}'`.cwd(mainPath).quiet();

            // Delete the branch in the local repo
            await Bun.$`git switch 'main'`.cwd(mainPath).quiet();
            await Bun.$`git branch --delete --force '${tag}'`.cwd(mainPath).quiet();
        }

        done += 0.5;
        task = "cloning repository";

        let outPath = path.join(OUTPUT_DIRECTORY, versionInfo.id);
        let repoPath = path.join(GIT_DIRECTORY, versionInfo.id);

        if (fs.existsSync(repoPath)) {
            let mounted = await Bun.$`mount | grep '${repoPath}' | awk '{ print $3 }'`.text();
            for (let mount of mounted.trim().split("\n")) {
                if (mount.trim() == "") {
                    continue;
                }
                await Bun.$`fusermount -u '${mount.trim()}'`;
            }

            fs.rmSync(repoPath, { recursive: true });
        }
        await Bun.$`git clone --origin origin --branch '${tag}' --single-branch '${GIT_URL}' '${repoPath}'`.cwd(GIT_DIRECTORY).quiet();

        done++;
        task = "copying files";

        {
            async function mount(dir: string) {
                let files = fs.readdirSync(path.join(outPath, dir));
                for (let file of files) {
                    let fromPath = path.join(outPath, dir, file);
                    let fromStat = fs.statSync(fromPath);
                    let toPath = path.join(repoPath, dir, file);
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

            async function unmount(dir: string) {
                let files = fs.readdirSync(path.join(outPath, dir));
                for (let file of files) {
                    if (fs.statSync(path.join(outPath, dir, file)).isDirectory()) {
                        // await Bun.$`umount '${path.join(repoPath, dir, file)}'`;
                        await Bun.$`fusermount -u '${path.join(repoPath, dir, file)}'`;
                    }
                }
            }

            // function copy(dir: string) {
            //     let files = fs.readdirSync(path.join(outPath, dir));
            //     for (let file of files) {
            //         let fromPath = path.join(outPath, dir, file);
            //         let fromStat = fs.statSync(fromPath);
            //         if (fromStat.isFile()) {
            //             let toPath = path.join(repoPath, dir, file);

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

            await mount(".");

            done++;
            task = "adding files";

            let message = GIT_MESSAGE;
            message = message.replace("{versionId}", versionInfo.id);
            message = message.replace("{versionSha}", versionInfo.sha1);
            if (message.includes("{assetIndexSha}")) {
                message = message.replace("{assetIndexSha}", (await main.downloadVersion(versionInfo.id)).value.assetIndex.sha1);
            }

            let amend = (await Bun.$`git log --max-count 1 --pretty='%s'`.cwd(repoPath).text()).trim() == "Init";

            await Bun.$`git add .`.cwd(repoPath).quiet();

            done++;
            task = "committing files";

            let commit = await Bun.$`git commit ${amend ? "--amend" : ""} --all --message '${message}'`.cwd(repoPath).quiet().nothrow();
            if (commit.exitCode == 0 || (await commit.text()).match(/^nothing to commit, working tree clean$/im) != null) {
                done++;
                task = "pushing files";

                let push = await Bun.$`git push ${amend ? "--force-with-lease" : ""} origin ${tag}`.cwd(repoPath).quiet().nothrow();
                if (push.exitCode == 0 || (await push.text()).match(/^Everything up-to-date$/im) != null) {
                    done++;
                    task = "cleaning up";
                } else {
                    throw Error(`Failed to push:\n${await push.text()}`);
                }
            } else {
                throw Error(`Failed to commit:\n${await commit.text()}`);
            }

            await unmount(".");
        }

        fs.rmSync(repoPath, { recursive: true });

        done += 0.5;

        clearInterval(interval);

        process.stdout.write(`\x1b[2K\x1b[1G${versionInfo.id} - finished - 100%`);
        process.stdout.write(`\n\n`);
    }
})();