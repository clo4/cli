import packageJson from "../../../package.json";

export const appName = "@clo4/cli";
export const base = "/cli";
export const site = "https://clo4.net";
export const version = packageJson.version;

export const gitConfig = {
  user: "clo4",
  repo: "cli",
  branch: "main",
};
export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

export const href = (path = "") => `${base}${path ? `/${path.replace(/^\//, "")}` : ""}`;
