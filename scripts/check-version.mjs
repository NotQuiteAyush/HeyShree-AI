import fs from "node:fs";

const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
const lock=JSON.parse(fs.readFileSync("package-lock.json","utf8"));
const pyproject=fs.readFileSync("backend/pyproject.toml","utf8");
const pythonInit=fs.readFileSync("backend/shree/__init__.py","utf8");
const expected=pkg.version;
const checks=[
  ["package-lock root",lock.version],
  ["package-lock application",lock.packages?.[""]?.version],
  ["Python project",pyproject.match(/^version\s*=\s*"([^"]+)"/m)?.[1]],
  ["Python runtime",pythonInit.match(/__version__\s*=\s*"([^"]+)"/)?.[1]],
];
const failures=checks.filter(([,actual])=>actual!==expected);
if (process.env.GITHUB_REF_TYPE==="tag"&&process.env.GITHUB_REF_NAME!==`v${expected}`) failures.push(["Git tag",process.env.GITHUB_REF_NAME]);
if(failures.length){for(const [name,actual] of failures)console.error(`${name}: expected ${expected}, received ${actual||"missing"}`);process.exit(1);}
console.log(`All release versions match ${expected}.`);
