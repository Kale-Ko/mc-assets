import * as main from "./main.ts"
import * as fs from "fs";
import * as path from "path";

const GIT_URL: string = "https://github.com/Kale-Ko/mc-assets";

const README_FILE: string = path.resolve("README.md");

function versionToGitTag(version: string): string {
    return version.replaceAll(/[^a-zA-Z0-9-_]/g, "_").toLowerCase();
}

(async (): Promise<void> => {
    let README: string = "";

    README += `# mc-assets

A repository containing every single asset from ever version present in the launcher that updates every 30 minutes.
Updates started on May 1, 2025 so the history starts from there.

`

    {
        let versionList: main.VersionList = (await main.downloadVersionList()).value;

        README += `## Latest

### Release

[${versionList.latest.release}](${GIT_URL}/tree/${versionToGitTag(versionList.latest.release)})

### Snapshot

[${versionList.latest.snapshot}](${GIT_URL}/tree/${versionToGitTag(versionList.latest.snapshot)})

`

        README += `## Version List

`

        let versionGroups: { [group: string]: main.VersionList["versions"][0][] } = {};

        let lastRelease: string | undefined = undefined;

        function getGroup(version: main.VersionList["versions"][0]): string | undefined {
            switch (version.type) {
                case "release": {
                    return lastRelease = version.id;
                }
                case "snapshot":
                case "old_snapshot": {
                    return lastRelease;
                }
                case "old_beta": {
                    return "Beta";
                }
                case "old_alpha": {
                    return "Alpha";
                }
                case "experiment": {
                    return "Experiments";
                }
            }

            return undefined;
        }

        for (let version of versionList.versions) {
            let group: string | undefined = getGroup(version);
            if (group == undefined) {
                continue;
            }

            if (!(group in versionGroups)) {
                versionGroups[group] = [];
            }
            versionGroups[group]?.push(version);
        }

        for (let i in versionGroups) {
            let versionGroup: main.VersionList["versions"][0][] = versionGroups[i]!;

            README += `<details>
  <summary><b id="${versionToGitTag(i)}">${i}</b></summary>

`;

            for (let j in versionGroup) {
                let version: main.VersionList["versions"][0] = versionGroup[j]!;

                README += `  [${version.id}](${GIT_URL}/tree/${versionToGitTag(version.id)})`

                if (j != versionGroup.length - 1) {
                    README += `\\
`;
                } else {
                    README += `
`;
                }
            }

            README += `</details>
`;
        }
    }

    fs.writeFileSync(README_FILE, README, { encoding: "utf8" });
})();